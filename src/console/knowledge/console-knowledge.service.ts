import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { KnowledgeService } from '../../knowledge/knowledge.service';
import { KnowledgeIndexJobService } from '../../knowledge/knowledge-index-job.service';
import { UpdateKnowledgeFilePolicyDto } from '../../knowledge/dto/knowledge-policy.dto';
import { removeStagedFile } from '../../storage/staged-upload';
import { PrismaService } from '../../prisma/prisma.service';
import { SecurityAuditService } from '../../security/security-audit.service';
import type { ConsoleIdentityContext } from '../security/console-identity-context';
import type { KnowledgeIndexJob } from '@prisma/client';

type KnowledgeFile = Awaited<ReturnType<KnowledgeService['getKnowledgeFile']>>;

@Injectable()
export class ConsoleKnowledgeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly knowledge: KnowledgeService,
    private readonly indexJobs: KnowledgeIndexJobService,
    private readonly audit: SecurityAuditService,
  ) {}

  async listFiles(
    appId: string,
    identity: ConsoleIdentityContext,
    includeArchived = false,
  ) {
    const appcode = await this.ownedAppcode(appId, identity);
    const files = await this.knowledge.listKnowledgeFiles(appcode, {
      includeArchived,
    });
    return files.map((file) => this.fileSummary(file));
  }

  async uploadFile(
    appId: string,
    file: Express.Multer.File,
    identity: ConsoleIdentityContext,
    abortSignal?: AbortSignal,
  ) {
    try {
      const app = await this.ownedApp(appId, identity);
      const created = await this.knowledge.uploadKnowledgeFile(
        file,
        app,
        abortSignal,
      );
      return this.fileSummary(created);
    } finally {
      await removeStagedFile(file);
    }
  }

  async getFile(
    appId: string,
    fileId: string,
    identity: ConsoleIdentityContext,
  ) {
    const appcode = await this.ownedAppcode(appId, identity);
    return this.fileSummary(
      await this.knowledge.getKnowledgeFile(fileId, appcode),
    );
  }

  async updatePolicy(
    appId: string,
    fileId: string,
    dto: UpdateKnowledgeFilePolicyDto,
    identity: ConsoleIdentityContext,
    requestId?: string,
  ) {
    const appcode = await this.ownedAppcode(appId, identity);
    const previous = await this.knowledge.getKnowledgeFile(fileId, appcode);
    if (previous.status === 'archived') {
      throw new BadRequestException('보관된 파일의 정책은 변경할 수 없습니다.');
    }
    if (!this.policyChanged(previous, dto)) return this.fileSummary(previous);
    const updated = await this.knowledge.updateKnowledgeFilePolicy(
      fileId,
      appcode,
      dto,
    );
    await this.audit.recordConsole({
      eventType: 'CONSOLE_KNOWLEDGE_POLICY_UPDATED',
      identity,
      appId,
      appcode,
      requestId,
      metadata: {
        fileId,
        previousState: previous.businessStatus,
        businessStatus: updated.businessStatus,
        changedFields: Object.keys(dto).sort().join(','),
      },
    });
    return this.fileSummary(updated);
  }

  async archiveFile(
    appId: string,
    fileId: string,
    identity: ConsoleIdentityContext,
    deleteObject: boolean,
    requestId?: string,
    abortSignal?: AbortSignal,
  ) {
    const appcode = await this.ownedAppcode(appId, identity);
    const previous = await this.knowledge.getKnowledgeFile(fileId, appcode);
    const previousCleanup = this.cleanupState(previous.metadata);
    if (
      previous.status === 'archived' &&
      (!deleteObject || previousCleanup.deletedObject)
    ) {
      return this.fileSummary(previous);
    }
    if (previous.status !== 'archived') {
      const active = await this.prisma.knowledgeIndexJob.findFirst({
        where: { appcode, fileId, status: { in: ['queued', 'processing'] } },
        select: { id: true },
      });
      if (active) {
        throw new ConflictException(
          '진행 중인 색인 작업이 완료된 뒤 보관할 수 있습니다.',
        );
      }
    }
    try {
      const archived = await this.knowledge.deleteKnowledgeFile(
        fileId,
        appcode,
        { deleteObject },
        abortSignal,
      );
      await this.audit.recordConsole({
        eventType:
          previous.status === 'archived'
            ? 'CONSOLE_KNOWLEDGE_OBJECT_CLEANUP_COMPLETED'
            : 'CONSOLE_KNOWLEDGE_ARCHIVED',
        identity,
        appId,
        appcode,
        requestId,
        metadata: {
          fileId,
          previousState: previous.status,
          businessStatus: archived.businessStatus,
          deleteObject,
          cleanupStatus: this.cleanupState(archived.metadata).status,
        },
      });
      return this.fileSummary(archived);
    } catch (error) {
      if (deleteObject) {
        const current = await this.knowledge.getKnowledgeFile(fileId, appcode);
        if (current.status === 'archived') {
          await this.audit.recordConsole({
            eventType: 'CONSOLE_KNOWLEDGE_OBJECT_CLEANUP_FAILED',
            identity,
            appId,
            appcode,
            requestId,
            metadata: {
              fileId,
              deleteObject: true,
              cleanupStatus: this.cleanupState(current.metadata).status,
            },
          });
        }
      }
      throw error;
    }
  }

  async retryObjectCleanup(
    appId: string,
    fileId: string,
    identity: ConsoleIdentityContext,
    requestId?: string,
    abortSignal?: AbortSignal,
  ) {
    const appcode = await this.ownedAppcode(appId, identity);
    const file = await this.knowledge.getKnowledgeFile(fileId, appcode);
    const cleanup = this.cleanupState(file.metadata);
    if (
      file.status !== 'archived' ||
      !cleanup.requested ||
      cleanup.deletedObject
    ) {
      throw new BadRequestException('복구할 원본 삭제 작업이 없습니다.');
    }
    return this.archiveFile(
      appId,
      fileId,
      identity,
      true,
      requestId,
      abortSignal,
    );
  }

  async submitIndexJob(
    appId: string,
    fileId: string,
    identity: ConsoleIdentityContext,
    idempotencyKey?: string,
  ) {
    const appcode = await this.ownedAppcode(appId, identity);
    return this.jobSummary(
      await this.indexJobs.submit(fileId, appcode, 'index', idempotencyKey),
    );
  }

  async submitReindexJob(
    appId: string,
    fileId: string,
    identity: ConsoleIdentityContext,
    idempotencyKey?: string,
  ) {
    const appcode = await this.ownedAppcode(appId, identity);
    return this.jobSummary(
      await this.indexJobs.submit(fileId, appcode, 'reindex', idempotencyKey),
    );
  }

  async listIndexJobs(
    appId: string,
    fileId: string,
    identity: ConsoleIdentityContext,
  ) {
    const appcode = await this.ownedAppcode(appId, identity);
    await this.knowledge.getKnowledgeFile(fileId, appcode);
    const jobs = await this.prisma.knowledgeIndexJob.findMany({
      where: { appcode, fileId },
      orderBy: { requestedAt: 'desc' },
      take: 20,
    });
    return jobs.map((job) => this.jobSummary(job));
  }

  async getIndexJob(
    appId: string,
    jobId: string,
    identity: ConsoleIdentityContext,
  ) {
    const appcode = await this.ownedAppcode(appId, identity);
    return this.jobSummary(await this.indexJobs.get(jobId, appcode));
  }

  async retryIndexJob(
    appId: string,
    jobId: string,
    identity: ConsoleIdentityContext,
  ) {
    const appcode = await this.ownedAppcode(appId, identity);
    return this.jobSummary(await this.indexJobs.retry(jobId, appcode));
  }

  async indexFailures(identity: ConsoleIdentityContext) {
    const ownerships = await this.prisma.consoleAppOwnership.findMany({
      where: { organizationId: identity.organizationId },
      select: { appInfo: { select: { appcode: true } } },
    });
    const appcodes = ownerships.map(({ appInfo }) => appInfo.appcode);
    if (!appcodes.length) {
      return { failedJobs: 0, lastFailureAt: null, affectedApps: 0 };
    }
    const failures = await this.prisma.knowledgeIndexJob.groupBy({
      by: ['appcode'],
      where: { appcode: { in: appcodes }, status: 'failed' },
      _count: { _all: true },
      _max: { completedAt: true },
    });
    return {
      failedJobs: failures.reduce((sum, row) => sum + row._count._all, 0),
      lastFailureAt: failures.reduce<Date | null>((latest, row) => {
        const completedAt = row._max.completedAt;
        return completedAt && (!latest || completedAt > latest)
          ? completedAt
          : latest;
      }, null),
      affectedApps: failures.length,
    };
  }

  private async ownedAppcode(appId: string, identity: ConsoleIdentityContext) {
    return (await this.ownedApp(appId, identity)).appcode;
  }

  private async ownedApp(appId: string, identity: ConsoleIdentityContext) {
    const ownership = await this.prisma.consoleAppOwnership.findFirst({
      where: { appInfoId: appId, organizationId: identity.organizationId },
      select: {
        appInfo: { select: { appcode: true, maxStorageMb: true } },
      },
    });
    if (!ownership) {
      throw new NotFoundException('요청한 앱을 찾을 수 없습니다.');
    }
    return ownership.appInfo;
  }

  private fileSummary(file: KnowledgeFile) {
    const cleanup = this.cleanupState(file.metadata);
    return {
      id: file.id,
      originalName: file.originalName,
      mimetype: file.mimetype,
      size: file.size,
      status: file.status,
      accessLevel: file.accessLevel,
      businessStatus: file.businessStatus,
      productCodes: file.productCodes,
      effectiveFrom: file.effectiveFrom,
      effectiveTo: file.effectiveTo,
      indexedAt: file.indexedAt,
      createdAt: file.createdAt,
      updatedAt: file.updatedAt,
      chunkCount: file._count.chunks,
      objectCleanupStatus: file.status === 'archived' ? cleanup.status : null,
      deleteObjectRequested:
        file.status === 'archived' ? cleanup.requested : false,
      deletedObject: file.status === 'archived' ? cleanup.deletedObject : false,
    };
  }

  private cleanupState(metadata: unknown) {
    const values =
      metadata && typeof metadata === 'object' && !Array.isArray(metadata)
        ? (metadata as Record<string, unknown>)
        : {};
    return {
      status:
        typeof values.objectCleanupStatus === 'string'
          ? values.objectCleanupStatus
          : 'not_requested',
      requested: values.deleteObjectRequested === true,
      deletedObject: values.deletedObject === true,
    };
  }

  private policyChanged(
    file: KnowledgeFile,
    dto: UpdateKnowledgeFilePolicyDto,
  ) {
    if (dto.accessLevel !== undefined && dto.accessLevel !== file.accessLevel)
      return true;
    if (
      dto.businessStatus !== undefined &&
      dto.businessStatus !== file.businessStatus
    )
      return true;
    if (dto.productCodes !== undefined) {
      const normalized = [
        ...new Set(dto.productCodes.map((code) => code.trim()).filter(Boolean)),
      ];
      if (JSON.stringify(normalized) !== JSON.stringify(file.productCodes))
        return true;
    }
    if (
      dto.effectiveFrom !== undefined &&
      (dto.effectiveFrom ? new Date(dto.effectiveFrom).toISOString() : null) !==
        file.effectiveFrom?.toISOString() &&
      !(dto.effectiveFrom === null && file.effectiveFrom === null)
    )
      return true;
    if (
      dto.effectiveTo !== undefined &&
      (dto.effectiveTo ? new Date(dto.effectiveTo).toISOString() : null) !==
        file.effectiveTo?.toISOString() &&
      !(dto.effectiveTo === null && file.effectiveTo === null)
    )
      return true;
    return false;
  }

  private jobSummary(job: KnowledgeIndexJob) {
    return {
      id: job.id,
      fileId: job.fileId,
      operation: job.operation,
      status: job.status,
      attempt: job.attempt,
      maxAttempts: job.maxAttempts,
      errorCode: job.errorCode,
      errorMessage: job.errorMessage,
      retryable: job.retryable,
      nextAttemptAt: job.nextAttemptAt,
      requestedAt: job.requestedAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
    };
  }
}
