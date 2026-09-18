import { usageOperationHash } from './usage-quota-policy';
import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { lockUsageQuota } from './usage-quota.service';
import {
  ReconcileUsageReservationDto,
  UsageReservationQueryDto,
} from './usage-quota-recovery.dto';

export const USAGE_RECOVERY_MIN_AGE_MS = 15 * 60 * 1000;

@Injectable()
export class UsageQuotaRecoveryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: UsageReservationQueryDto) {
    const limit = query.limit ?? 50;
    const rows = await this.prisma.consoleUsageReservation.findMany({
      where: {
        appcode: query.appcode,
        organizationId: query.organizationId,
        periodKey: query.periodKey,
        state: query.state ?? { in: ['RESERVED', 'UNCERTAIN'] },
        updatedAt: {
          lte: query.updatedBefore
            ? new Date(query.updatedBefore)
            : new Date(Date.now() - USAGE_RECOVERY_MIN_AGE_MS),
        },
        id: query.after ? { gt: query.after } : undefined,
      },
      orderBy: { id: 'asc' },
      take: limit + 1,
    });
    return {
      items: rows.slice(0, limit),
      nextCursor: rows.length > limit ? rows[limit - 1].id : null,
    };
  }

  async get(id: string) {
    const row = await this.prisma.consoleUsageReservation.findUnique({
      where: { id },
    });
    if (!row) throw new NotFoundException('USAGE_QUOTA_RESERVATION_NOT_FOUND');
    return row;
  }

  async reconcile(
    id: string,
    input: ReconcileUsageReservationDto,
    actor: { credentialSlot: 'primary' | 'previous'; requestId?: string },
  ) {
    const hash = createHash('sha256')
      .update(
        JSON.stringify([
          id,
          input.action,
          input.expectedUpdatedAt,
          input.executorStopped,
          input.evidenceRef,
          input.logSource ?? null,
          input.logId ?? null,
          input.actualTokens ?? null,
        ]),
      )
      .digest('hex');
    try {
      return await this.prisma.$transaction(async (tx) => {
        const initial = await tx.consoleUsageReservation.findUnique({
          where: { id },
        });
        if (!initial)
          throw new NotFoundException('USAGE_QUOTA_RESERVATION_NOT_FOUND');
        await lockUsageQuota(tx, initial.appcode, initial.organizationId);
        const row = await tx.consoleUsageReservation.findUniqueOrThrow({
          where: { id },
        });
        if (row.recoveryKey === input.recoveryKey && row.recoveryHash === hash)
          return row;
        if (row.recoveryKey || row.state === 'SETTLED') {
          throw new ConflictException('USAGE_QUOTA_RECOVERY_CONFLICT');
        }
        if (row.updatedAt.getTime() !== Date.parse(input.expectedUpdatedAt)) {
          throw new ConflictException('USAGE_QUOTA_RESERVATION_CHANGED');
        }
        if (
          !input.executorStopped ||
          row.updatedAt.getTime() > Date.now() - USAGE_RECOVERY_MIN_AGE_MS
        ) {
          throw new ConflictException('USAGE_QUOTA_EXECUTOR_NOT_QUIESCED');
        }

        let source = row.usageLogSource;
        let logId = row.usageLogId;
        let tokens = 0;
        let recoveryRequests = 0;
        let recoveryTokens = 0;
        if (input.action === 'SETTLE_LOG') {
          if ((input.logSource === undefined) !== (input.logId === undefined)) {
            throw new BadRequestException('USAGE_QUOTA_LOG_REFERENCE_REQUIRED');
          }
          if (
            (source && input.logSource && source !== input.logSource) ||
            (logId && input.logId && logId !== input.logId)
          ) {
            throw new ConflictException('USAGE_QUOTA_LOG_REFERENCE_MISMATCH');
          }
          source ??= input.logSource ?? null;
          logId ??= input.logId ?? null;
          if (!source || !logId)
            throw new BadRequestException('USAGE_QUOTA_LOG_REFERENCE_REQUIRED');
          const log = await this.readLog(tx, source, logId);
          if (
            !log ||
            log.appcode !== row.appcode ||
            (!row.usageLogId &&
              log.at.toISOString().slice(0, 7) !== row.periodKey)
          ) {
            throw new ConflictException('USAGE_QUOTA_LOG_SCOPE_MISMATCH');
          }
          // For legacy rows, matching request IDs strengthen the operator's evidence.
          if (
            log.requestId &&
            usageOperationHash(
              row.appcode,
              row.periodKey,
              log.requestId,
              row.operationScope,
            ) !== row.operationKeyHash
          ) {
            throw new ConflictException('USAGE_QUOTA_LOG_OPERATION_MISMATCH');
          }
          if (log.tokens === null && input.actualTokens === undefined) {
            throw new ConflictException('USAGE_QUOTA_USAGE_UNMEASURED');
          }
          if (
            log.tokens !== null &&
            input.actualTokens !== undefined &&
            input.actualTokens !== log.tokens
          ) {
            throw new ConflictException('USAGE_QUOTA_ACTUAL_TOKENS_MISMATCH');
          }
          tokens = log.tokens ?? input.actualTokens!;
          // Only missing measurements are added to the quota ledger; a logged
          // request and measured tokens must not be counted again.
          recoveryTokens = log.tokens === null ? tokens : 0;
        } else {
          if (
            source ||
            logId ||
            row.reservedRequests !== 1 ||
            input.logSource ||
            input.logId
          ) {
            throw new ConflictException(
              'USAGE_QUOTA_LOG_RECONCILIATION_REQUIRED',
            );
          }
          if (input.action === 'CONFIRM_USAGE') {
            if (input.actualTokens === undefined)
              throw new BadRequestException(
                'USAGE_QUOTA_ACTUAL_TOKENS_REQUIRED',
              );
            tokens = input.actualTokens;
            recoveryRequests = 1;
            recoveryTokens = tokens;
          } else if (input.actualTokens !== undefined) {
            throw new BadRequestException('USAGE_QUOTA_RELEASE_HAS_USAGE');
          }
        }
        if (!Number.isInteger(tokens) || tokens < 0 || tokens > 2147483647) {
          throw new BadRequestException('USAGE_QUOTA_INVALID_ACTUAL_TOKENS');
        }
        const updated = await tx.consoleUsageReservation.updateMany({
          where: { id, state: row.state, updatedAt: row.updatedAt },
          data: {
            state: 'SETTLED',
            actualTokens: tokens,
            completedAt: new Date(),
            reservedRequests: 0,
            reservedTokens: 0,
            usageLogSource: source,
            usageLogId: logId,
            recoveryRequests,
            recoveryTokens,
            recoveryKey: input.recoveryKey,
            recoveryHash: hash,
          },
        });
        if (updated.count !== 1)
          throw new ConflictException('USAGE_QUOTA_RESERVATION_CHANGED');
        // Unlike the best-effort access audit, recovery must roll back if its
        // durable decision record cannot be stored.
        await tx.securityAuditEvent.create({
          data: {
            eventType: 'USAGE_QUOTA_RESERVATION_RECOVERED',
            actorType: 'platform-admin',
            actorId: 'platform-admin',
            credentialSlot: actor.credentialSlot,
            appcode: row.appcode,
            requestId: actor.requestId,
            metadata: {
              reservationId: id,
              recoveryKey: input.recoveryKey,
              action: input.action,
              evidenceRef: input.evidenceRef,
              previousState: row.state,
              previousReservedRequests: row.reservedRequests,
              previousReservedTokens: row.reservedTokens,
              actualTokens: tokens,
              recoveryRequests,
              recoveryTokens,
              usageLogSource: source,
              usageLogId: logId,
            },
          },
        });
        return tx.consoleUsageReservation.findUniqueOrThrow({ where: { id } });
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'USAGE_QUOTA_RECOVERY_REFERENCE_ALREADY_USED',
        );
      }
      throw error;
    }
  }

  private async readLog(
    tx: Prisma.TransactionClient,
    source: string,
    id: string,
  ) {
    if (source === 'bedrock') {
      const log = await tx.bedrockSearchLog.findUnique({
        where: { id },
        select: { appcode: true, searchat: true, totaltokens: true },
      });
      return (
        log && {
          appcode: log.appcode,
          at: log.searchat,
          tokens: log.totaltokens,
          requestId: null,
        }
      );
    }
    if (source === 'knowledge') {
      const log = await tx.knowledgeQueryLog.findUnique({
        where: { id },
        select: {
          appcode: true,
          createdAt: true,
          totaltokens: true,
          requestId: true,
        },
      });
      return (
        log && {
          appcode: log.appcode,
          at: log.createdAt,
          tokens: log.totaltokens,
          requestId: log.requestId,
        }
      );
    }
    if (source === 'conversation') {
      const log = await tx.familyConversationMetric.findUnique({
        where: { id },
        select: {
          appcode: true,
          createdAt: true,
          totalTokens: true,
          requestId: true,
        },
      });
      return (
        log && {
          appcode: log.appcode,
          at: log.createdAt,
          tokens: log.totalTokens,
          requestId: log.requestId,
        }
      );
    }
    throw new BadRequestException('USAGE_QUOTA_LOG_SOURCE_INVALID');
  }
}
