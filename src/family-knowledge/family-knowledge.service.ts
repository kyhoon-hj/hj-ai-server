import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FamilyKnowledgeEvent, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  FamilyKnowledgeEventDto,
  FamilyKnowledgeEventResponseDto,
} from './dto/family-knowledge-event.dto';

@Injectable()
export class FamilyKnowledgeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async receiveEvent(
    dto: FamilyKnowledgeEventDto,
    appcode: string,
  ): Promise<FamilyKnowledgeEventResponseDto> {
    this.validateScopeAndOperation(dto);
    const payloadHash = this.hashPayload(dto);

    return this.prisma.$transaction(async (transaction) => {
      await this.lockSource(transaction, appcode, dto.sourceId);

      const eventIdentity = {
        appcode,
        sourceId: dto.sourceId,
        sourceVersion: dto.sourceVersion,
        operation: dto.operation,
      };
      const existingEvent = await transaction.familyKnowledgeEvent.findUnique({
        where: { appcode_sourceId_sourceVersion_operation: eventIdentity },
      });
      if (existingEvent) {
        if (existingEvent.payloadHash !== payloadHash) {
          throw new ConflictException('FAMILY_EVENT_PAYLOAD_CONFLICT');
        }
        return this.toResponse(existingEvent, true);
      }

      const document = await transaction.familyKnowledgeDocument.findUnique({
        where: { appcode_sourceId: { appcode, sourceId: dto.sourceId } },
      });
      if (document && document.sourceVersion === dto.sourceVersion) {
        throw new ConflictException('FAMILY_EVENT_VERSION_CONFLICT');
      }

      if (document && document.sourceVersion > dto.sourceVersion) {
        const stale = await transaction.familyKnowledgeEvent.create({
          data: {
            ...eventIdentity,
            payloadHash,
            status: 'SUCCEEDED',
            resultCode: 'STALE',
            maxAttempts: this.maxAttempts(),
            completedAt: new Date(),
          },
        });
        return this.toResponse(stale, false);
      }

      if (dto.operation === 'DELETE') {
        await this.applyDelete(transaction, dto, appcode, document?.id);
        const deleted = await transaction.familyKnowledgeEvent.create({
          data: {
            ...eventIdentity,
            payloadHash,
            status: 'SUCCEEDED',
            resultCode: 'DELETED',
            maxAttempts: this.maxAttempts(),
            completedAt: new Date(),
          },
        });
        return this.toResponse(deleted, false);
      }

      await this.applyUpsert(transaction, dto, appcode, document?.id);
      const queued = await transaction.familyKnowledgeEvent.create({
        data: {
          ...eventIdentity,
          payloadHash,
          status: 'QUEUED',
          resultCode: 'QUEUED',
          maxAttempts: this.maxAttempts(),
        },
      });
      return this.toResponse(queued, false);
    });
  }

  private validateScopeAndOperation(dto: FamilyKnowledgeEventDto) {
    if (dto.audience === 'FAMILY' && dto.memberRef !== undefined) {
      throw new BadRequestException('FAMILY_SCOPE_MEMBER_REF_FORBIDDEN');
    }
    if (dto.audience === 'MEMBER' && !dto.memberRef) {
      throw new BadRequestException('MEMBER_SCOPE_MEMBER_REF_REQUIRED');
    }
    if (
      dto.operation === 'DELETE' &&
      (dto.content !== undefined || dto.title !== undefined)
    ) {
      throw new BadRequestException('DELETE_CONTENT_FORBIDDEN');
    }
  }

  private async applyUpsert(
    transaction: Prisma.TransactionClient,
    dto: FamilyKnowledgeEventDto,
    appcode: string,
    documentId?: string,
  ) {
    const data = {
      appcode,
      tenantRef: dto.tenantRef,
      memberRef: dto.memberRef ?? null,
      audience: dto.audience,
      sourceId: dto.sourceId,
      sourceVersion: dto.sourceVersion,
      sourceType: dto.sourceType,
      sensitivity: dto.sensitivity,
      status: 'ACTIVE' as const,
      title: dto.title ?? null,
      content: dto.content!,
      publishedAt: new Date(dto.publishedAt),
      indexedAt: null,
      embeddingModel: null,
      deletedAt: null,
    };
    if (documentId) {
      await transaction.familyKnowledgeDocument.update({
        where: { id: documentId },
        data,
      });
      return;
    }
    await transaction.familyKnowledgeDocument.create({ data });
  }

  private async applyDelete(
    transaction: Prisma.TransactionClient,
    dto: FamilyKnowledgeEventDto,
    appcode: string,
    documentId?: string,
  ) {
    const now = new Date();
    const data = {
      appcode,
      tenantRef: dto.tenantRef,
      memberRef: dto.memberRef ?? null,
      audience: dto.audience,
      sourceId: dto.sourceId,
      sourceVersion: dto.sourceVersion,
      sourceType: dto.sourceType,
      sensitivity: dto.sensitivity,
      status: 'DELETED' as const,
      title: null,
      content: null,
      publishedAt: new Date(dto.publishedAt),
      indexedAt: null,
      embeddingModel: null,
      deletedAt: now,
    };
    const id = documentId
      ? (
          await transaction.familyKnowledgeDocument.update({
            where: { id: documentId },
            data,
            select: { id: true },
          })
        ).id
      : (
          await transaction.familyKnowledgeDocument.create({
            data,
            select: { id: true },
          })
        ).id;
    await transaction.familyKnowledgeChunk.deleteMany({
      where: { documentId: id },
    });
  }

  private async lockSource(
    transaction: Prisma.TransactionClient,
    appcode: string,
    sourceId: string,
  ) {
    const lockKey = `${appcode}\u0000${sourceId}`;
    await transaction.$queryRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))
    `;
  }

  private hashPayload(dto: FamilyKnowledgeEventDto) {
    const canonical = JSON.stringify({
      sourceId: dto.sourceId,
      sourceVersion: dto.sourceVersion,
      operation: dto.operation,
      tenantRef: dto.tenantRef,
      audience: dto.audience,
      memberRef: dto.memberRef ?? null,
      sourceType: dto.sourceType,
      sensitivity: dto.sensitivity,
      title: dto.title ?? null,
      content: dto.content ?? null,
      publishedAt: new Date(dto.publishedAt).toISOString(),
    });
    return createHash('sha256').update(canonical, 'utf8').digest('hex');
  }

  private maxAttempts() {
    const value = Number(
      this.config.get<string>('KNOWLEDGE_INDEX_MAX_ATTEMPTS') ?? 3,
    );
    return Number.isInteger(value) && value >= 1 && value <= 10 ? value : 3;
  }

  private toResponse(
    event: FamilyKnowledgeEvent,
    replayed: boolean,
  ): FamilyKnowledgeEventResponseDto {
    return {
      eventId: event.id,
      sourceId: event.sourceId,
      sourceVersion: event.sourceVersion,
      operation: event.operation,
      status: event.status,
      resultCode: event.resultCode,
      replayed,
    };
  }
}
