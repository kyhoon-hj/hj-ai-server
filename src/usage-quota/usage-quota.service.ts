import { measuredTokenCount, usageOperationHash } from './usage-quota-policy';
import {
  ConflictException,
  HttpException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type UsageTotals = {
  requests: number;
  tokens: number;
  unmeasuredRequests: number;
};
type ReservationTotals = {
  _sum: { reservedRequests: number | null; reservedTokens: number | null };
};

export type UsageQuotaReservation = {
  id: string;
  appcode: string;
  organizationId: string | null;
  periodKey: string;
};

@Injectable()
export class UsageQuotaService {
  constructor(private readonly prisma: PrismaService) {}

  async begin(input: {
    appcode: string;
    operationKey: string;
    operationScope?: string;
  }): Promise<UsageQuotaReservation | null> {
    return this.prisma.$transaction(async (transaction) => {
      const policy = await this.policy(transaction, input.appcode);
      if (!this.hasLimit(policy)) return null;
      await lockUsageQuota(transaction, input.appcode, policy.organizationId);
      // Capture the admission month after waiting for the scope locks.
      const periodKey = this.periodKey();
      const operationScope = input.operationScope ?? 'legacy';
      const operationKeyHash = usageOperationHash(
        input.appcode,
        periodKey,
        input.operationKey,
        operationScope,
      );

      const existing = await transaction.consoleUsageReservation.findUnique({
        where: { operationKeyHash },
        select: { id: true },
      });
      const legacy =
        !existing && operationScope !== 'legacy'
          ? await transaction.consoleUsageReservation.findUnique({
              where: {
                operationKeyHash: usageOperationHash(
                  input.appcode,
                  periodKey,
                  input.operationKey,
                ),
              },
              select: { id: true },
            })
          : null;
      if (existing || legacy) {
        throw new ConflictException('USAGE_QUOTA_OPERATION_ALREADY_RESERVED');
      }

      if (policy.organizationId && policy.organizationRequestLimit !== null) {
        const [measured, active] = await Promise.all([
          this.measuredUsage(transaction, {
            organizationId: policy.organizationId,
            periodKey,
          }),
          this.activeReservations(transaction, {
            organizationId: policy.organizationId,
            periodKey,
          }),
        ]);
        if (
          measured.requests + Number(active._sum.reservedRequests ?? 0) + 1 >
          policy.organizationRequestLimit
        ) {
          throw this.limitExceeded(
            'MONTHLY_REQUEST_LIMIT_EXCEEDED',
            policy.organizationRequestLimit,
          );
        }
      }

      const created = await transaction.consoleUsageReservation.create({
        data: {
          organizationId: policy.organizationId,
          appcode: input.appcode,
          periodKey,
          operationKeyHash,
          operationScope,
        },
        select: {
          id: true,
          appcode: true,
          organizationId: true,
          periodKey: true,
        },
      });
      return created;
    });
  }

  async reserveTokens(
    reservation: UsageQuotaReservation | null,
    requestedTokens: number,
  ) {
    if (!reservation) return;
    if (measuredTokenCount(requestedTokens) === undefined) {
      throw new ServiceUnavailableException(
        'USAGE_QUOTA_INVALID_TOKEN_RESERVATION',
      );
    }
    await this.prisma.$transaction(async (transaction) => {
      await lockUsageQuota(
        transaction,
        reservation.appcode,
        reservation.organizationId,
      );
      const policy = await this.policy(transaction, reservation.appcode);
      if (policy.organizationId !== reservation.organizationId) {
        throw new ConflictException('USAGE_QUOTA_ORGANIZATION_CHANGED');
      }
      const current = await transaction.consoleUsageReservation.findUnique({
        where: { id: reservation.id },
        select: { state: true, reservedTokens: true, tokensReservedAt: true },
      });
      if (!current || current.state !== 'RESERVED') {
        throw new ConflictException('USAGE_QUOTA_RESERVATION_NOT_ACTIVE');
      }
      if (current.tokensReservedAt || current.reservedTokens !== 0) {
        throw new ConflictException('USAGE_QUOTA_TOKENS_ALREADY_RESERVED');
      }

      await this.assertTokenLimit(transaction, {
        scope: {
          appcode: reservation.appcode,
          periodKey: reservation.periodKey,
        },
        limit: policy.appTokenLimit,
        requestedTokens,
        code: 'APP_MONTHLY_TOKEN_LIMIT_EXCEEDED',
      });
      if (reservation.organizationId) {
        await this.assertTokenLimit(transaction, {
          scope: {
            organizationId: reservation.organizationId,
            periodKey: reservation.periodKey,
          },
          limit: policy.organizationTokenLimit,
          requestedTokens,
          code: 'ORGANIZATION_MONTHLY_TOKEN_LIMIT_EXCEEDED',
        });
      }
      await transaction.consoleUsageReservation.update({
        where: { id: reservation.id },
        data: { reservedTokens: requestedTokens, tokensReservedAt: new Date() },
      });
    });
  }

  // Transfer request accounting to the durable log atomically. Token uncertainty
  // is independent: retain its estimate until measured usage or recovery exists.
  async recordUsage<T>(
    reservation: UsageQuotaReservation | null,
    write: (transaction: Prisma.TransactionClient) => Promise<T>,
    source?: 'bedrock' | 'knowledge' | 'conversation',
  ): Promise<T> {
    if (!reservation) return write(this.prisma);
    return this.prisma.$transaction(async (transaction) => {
      await lockUsageQuota(
        transaction,
        reservation.appcode,
        reservation.organizationId,
      );
      const transferred = await transaction.consoleUsageReservation.updateMany({
        where: {
          id: reservation.id,
          state: { in: ['RESERVED', 'UNCERTAIN'] },
          reservedRequests: 1,
        },
        data: { reservedRequests: 0 },
      });
      if (transferred.count !== 1) {
        throw new ConflictException('USAGE_QUOTA_REQUEST_ALREADY_RECORDED');
      }
      // A failed write rolls back the request transfer as well.
      const result = await write(transaction);
      if (source) {
        const id = (result as { id?: unknown } | null)?.id;
        if (typeof id !== 'string') {
          throw new ServiceUnavailableException('USAGE_QUOTA_LOG_ID_MISSING');
        }
        const log = result as { totaltokens?: unknown; totalTokens?: unknown };
        const actualTokens = measuredTokenCount(
          source === 'conversation' ? log.totalTokens : log.totaltokens,
        );
        await transaction.consoleUsageReservation.update({
          where: { id: reservation.id },
          data: {
            usageLogSource: source,
            usageLogId: id,
            // Once durable measured tokens exist, count them instead of holding
            // the estimate as well, even if the following settlement fails.
            ...(actualTokens !== undefined
              ? { reservedTokens: 0, actualTokens }
              : {}),
          },
        });
      }
      return result;
    });
  }

  async settle(
    reservation: UsageQuotaReservation | null,
    actualTokens: number,
  ) {
    if (!reservation) return;
    if (measuredTokenCount(actualTokens) === undefined) {
      throw new ServiceUnavailableException(
        'USAGE_QUOTA_INVALID_ACTUAL_TOKENS',
      );
    }
    await this.finish(reservation, 'SETTLED', actualTokens);
  }

  async markUncertain(reservation: UsageQuotaReservation | null) {
    if (!reservation) return;
    await this.finish(reservation, 'UNCERTAIN');
  }

  private async assertTokenLimit(
    transaction: Prisma.TransactionClient,
    input: {
      scope:
        | { appcode: string; periodKey: string }
        | { organizationId: string; periodKey: string };
      limit: number | null;
      requestedTokens: number;
      code: string;
    },
  ) {
    if (input.limit === null) return;
    const [measured, active] = await Promise.all([
      this.measuredUsage(transaction, input.scope),
      this.activeReservations(transaction, input.scope),
    ]);
    if (measured.unmeasuredRequests > 0) {
      throw new ServiceUnavailableException('USAGE_QUOTA_USAGE_UNMEASURED');
    }
    if (
      measured.tokens +
        Number(active._sum.reservedTokens ?? 0) +
        input.requestedTokens >
      input.limit
    ) {
      throw this.limitExceeded(input.code, input.limit);
    }
  }

  private async finish(
    reservation: UsageQuotaReservation,
    state: 'SETTLED' | 'UNCERTAIN',
    actualTokens?: number,
  ) {
    await this.prisma.$transaction(async (transaction) => {
      await lockUsageQuota(
        transaction,
        reservation.appcode,
        reservation.organizationId,
      );
      const result = await transaction.consoleUsageReservation.updateMany({
        where: { id: reservation.id, state: 'RESERVED' },
        data: { state, actualTokens, completedAt: new Date() },
      });
      if (result.count === 0) {
        const existing = await transaction.consoleUsageReservation.findUnique({
          where: { id: reservation.id },
          select: { state: true, actualTokens: true },
        });
        if (
          existing?.state !== state ||
          (state === 'SETTLED' && existing.actualTokens !== actualTokens)
        ) {
          throw new ConflictException('USAGE_QUOTA_RESERVATION_NOT_ACTIVE');
        }
      }
    });
  }

  private async policy(transaction: Prisma.TransactionClient, appcode: string) {
    const app = await transaction.appInfo.findUnique({
      where: { appcode },
      select: {
        monthlyTokenLimit: true,
        consoleOwnership: {
          select: {
            organizationId: true,
            organization: {
              select: { monthlyRequestLimit: true, monthlyTokenLimit: true },
            },
          },
        },
      },
    });
    if (!app) {
      throw new ServiceUnavailableException('USAGE_QUOTA_APP_NOT_FOUND');
    }
    return {
      appTokenLimit: app.monthlyTokenLimit,
      organizationId: app.consoleOwnership?.organizationId ?? null,
      organizationRequestLimit:
        app.consoleOwnership?.organization.monthlyRequestLimit ?? null,
      organizationTokenLimit:
        app.consoleOwnership?.organization.monthlyTokenLimit ?? null,
    };
  }

  private hasLimit(policy: Awaited<ReturnType<UsageQuotaService['policy']>>) {
    return (
      policy.appTokenLimit !== null ||
      policy.organizationRequestLimit !== null ||
      policy.organizationTokenLimit !== null
    );
  }

  private measuredUsage(
    transaction: Prisma.TransactionClient,
    scope:
      | { appcode: string; periodKey: string }
      | { organizationId: string; periodKey: string },
  ) {
    const from = new Date(`${scope.periodKey}-01T00:00:00.000Z`);
    const to = new Date(from);
    to.setUTCMonth(to.getUTCMonth() + 1);
    const condition =
      'appcode' in scope
        ? Prisma.sql`source.appcode = ${scope.appcode}`
        : Prisma.sql`source.organization_id = ${scope.organizationId}`;
    return transaction
      .$queryRaw<UsageTotals[]>(
        Prisma.sql`
      WITH raw_logs AS (
        SELECT log.id, 'bedrock' AS source_type, log.appcode, log.searchat AS occurred_at, log.totaltokens AS tokens
        FROM bedrock_search_log log
        UNION ALL
        SELECT log.id, 'knowledge', log.appcode, log.created_at, log.totaltokens
        FROM knowledge_query_log log
        UNION ALL
        SELECT metric.id, 'conversation', metric.appcode, metric.created_at, metric.total_tokens
        FROM family_conversation_metric metric
      ), usage_events AS (
        SELECT log.appcode,
          CASE WHEN reservation.id IS NULL THEN log.occurred_at
               ELSE (reservation.period_key || '-01')::timestamp END AS occurred_at,
          CASE WHEN reservation.id IS NULL THEN ownership.organization_id
               ELSE reservation.organization_id END AS organization_id,
          COALESCE(log.tokens, CASE WHEN reservation.state = 'SETTLED' AND reservation.recovery_key IS NULL
                                   THEN reservation.actual_tokens END, 0) AS tokens,
          1 AS requests,
          CASE WHEN log.tokens IS NULL AND (reservation.id IS NULL OR
             (reservation.state = 'SETTLED' AND reservation.actual_tokens IS NULL)) THEN 1 ELSE 0 END AS unmeasured
        FROM raw_logs log
        LEFT JOIN console_usage_reservation reservation
          ON reservation.usage_log_source = log.source_type AND reservation.usage_log_id = log.id
        LEFT JOIN appinfo app ON app.appcode = log.appcode
        LEFT JOIN console_app_ownership ownership ON ownership.app_info_id = app.id
        UNION ALL
        SELECT reservation.appcode, (reservation.period_key || '-01')::timestamp,
          reservation.organization_id, reservation.recovery_tokens AS tokens,
          reservation.recovery_requests AS requests, 0 AS unmeasured
        FROM console_usage_reservation reservation
        WHERE reservation.state = 'SETTLED' AND reservation.recovery_key IS NOT NULL
      )
      SELECT COALESCE(SUM(source.requests), 0)::int AS requests,
             COALESCE(SUM(source.tokens), 0)::float8 AS tokens,
             COALESCE(SUM(source.unmeasured), 0)::int AS "unmeasuredRequests"
      FROM usage_events source
      WHERE source.occurred_at >= ${from} AND source.occurred_at < ${to}
        AND ${condition}
    `,
      )
      .then(
        (rows) => rows[0] ?? { requests: 0, tokens: 0, unmeasuredRequests: 0 },
      );
  }

  private activeReservations(
    transaction: Prisma.TransactionClient,
    scope:
      | { appcode: string; periodKey: string }
      | { organizationId: string; periodKey: string },
  ): Promise<ReservationTotals> {
    return transaction.consoleUsageReservation.aggregate({
      where: {
        ...('appcode' in scope
          ? { appcode: scope.appcode }
          : { organizationId: scope.organizationId }),
        periodKey: scope.periodKey,
        state: { in: ['RESERVED', 'UNCERTAIN'] },
      },
      _sum: { reservedRequests: true, reservedTokens: true },
    });
  }

  private periodKey(at = new Date()) {
    return at.toISOString().slice(0, 7);
  }

  private limitExceeded(code: string, limit: number) {
    return new HttpException(
      { code, message: '월 사용 한도를 초과했습니다.', limit },
      429,
    );
  }
}

export async function lockUsageQuota(
  transaction: Prisma.TransactionClient,
  appcode: string,
  organizationId: string | null,
) {
  if (organizationId) {
    await transaction.$queryRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify(
        ['console-usage-organization', organizationId],
      )}, 0))::text AS "locked"`,
    );
  }
  await transaction.$queryRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([
      'console-usage-app',
      appcode,
    ])}, 0))::text AS "locked"`,
  );
}
