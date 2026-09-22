import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  consoleUsageEvents,
  ConsoleUsageFilters,
} from './console-usage-events';
import { PrismaService } from '../../prisma/prisma.service';
import type { ConsoleIdentityContext } from '../security/console-identity-context';

type UsageAggregateRow = {
  requestCount: number;
  inputTokens: number;
  inputMeasuredRequests: number;
  outputTokens: number;
  outputMeasuredRequests: number;
  totalTokens: number;
  tokenMeasuredRequests: number;
  averageLatencyMs: number | null;
  maximumLatencyMs: number | null;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
  latencyMeasuredRequests: number;
  successfulRequests: number;
  failedRequests: number;
  outcomeMeasuredRequests: number;
  embeddingOperations: number;
  embeddingIndexOperations: number;
  embeddingSearchOperations: number;
  embeddingReservedOperations: number;
  embeddingSucceededOperations: number;
  embeddingUncertainOperations: number;
};

type UsageSeriesRow = {
  date: string;
  requestCount: number;
  totalTokens: number;
  tokenMeasuredRequests: number;
  averageLatencyMs: number | null;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
  latencyMeasuredRequests: number;
  successfulRequests: number;
  failedRequests: number;
  outcomeMeasuredRequests: number;
  embeddingOperations: number;
  embeddingIndexOperations: number;
  embeddingSearchOperations: number;
  embeddingReservedOperations: number;
  embeddingSucceededOperations: number;
  embeddingUncertainOperations: number;
};

type UsageBreakdownRow = UsageAggregateRow & { appcode: string };
type EmbeddingMetrics = {
  operations: number;
  indexOperations: number;
  searchOperations: number;
  states: { reserved: number; succeeded: number; uncertain: number };
};
type UsageSeriesPoint = {
  date: string;
  requestCount: number;
  tokens: { value: number | null; measuredRequests: number };
  latency: {
    averageMs: number | null;
    p50Ms: number | null;
    p95Ms: number | null;
    measuredRequests: number;
  };
  outcome: {
    successfulRequests: number;
    failedRequests: number;
    measuredRequests: number;
    successRate: number | null;
  };
  embeddings: EmbeddingMetrics;
};

@Injectable()
export class ConsoleUsageService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(
    identity: ConsoleIdentityContext,
    days: number,
    filters: ConsoleUsageFilters = {},
  ) {
    const scope = await this.scope(identity, days);
    const row = (
      await this.prisma.$queryRaw<UsageAggregateRow[]>(
        this.summaryQuery(
          identity.organizationId,
          scope.from,
          scope.to,
          filters,
        ),
      )
    )[0];
    return {
      period: this.period(scope.from, scope.to, days),
      embeddingScope: this.embeddingScope(filters),
      appCount: scope.apps.length,
      ...this.metrics(row),
    };
  }

  async timeseries(
    identity: ConsoleIdentityContext,
    days: number,
    filters: ConsoleUsageFilters = {},
  ) {
    const scope = await this.scope(identity, days);
    const rows = await this.prisma.$queryRaw<UsageSeriesRow[]>(
      this.timeseriesQuery(
        identity.organizationId,
        scope.from,
        scope.to,
        filters,
      ),
    );
    const byDate = new Map(rows.map((row) => [row.date, row]));
    const points: UsageSeriesPoint[] = [];
    for (
      let cursor = new Date(scope.from);
      cursor < scope.to;
      cursor.setUTCDate(cursor.getUTCDate() + 1)
    ) {
      const date = cursor.toISOString().slice(0, 10);
      const row = byDate.get(date);
      points.push({
        date,
        requestCount: Number(row?.requestCount ?? 0),
        tokens: this.measurement(row?.totalTokens, row?.tokenMeasuredRequests),
        latency: {
          averageMs:
            row?.latencyMeasuredRequests && row.averageLatencyMs !== null
              ? Math.round(Number(row.averageLatencyMs))
              : null,
          p50Ms: row?.p50LatencyMs == null ? null : Number(row.p50LatencyMs),
          p95Ms: row?.p95LatencyMs == null ? null : Number(row.p95LatencyMs),
          measuredRequests: Number(row?.latencyMeasuredRequests ?? 0),
        },
        outcome: this.outcome(row),
        embeddings: this.embeddingMetrics(row),
      });
    }
    return {
      period: this.period(scope.from, scope.to, days),
      embeddingScope: this.embeddingScope(filters),
      points,
    };
  }

  async breakdown(
    identity: ConsoleIdentityContext,
    days: number,
    filters: ConsoleUsageFilters = {},
  ) {
    const scope = await this.scope(identity, days);
    const rows = await this.prisma.$queryRaw<UsageBreakdownRow[]>(
      this.breakdownQuery(
        identity.organizationId,
        scope.from,
        scope.to,
        filters,
      ),
    );
    const byAppcode = new Map(rows.map((row) => [row.appcode, row]));
    const historical = rows
      .filter((row) => !scope.apps.some((app) => app.appcode === row.appcode))
      .map((row) => ({ id: null, appname: row.appcode, appcode: row.appcode }));
    const dimensions = await this.prisma.$queryRaw<
      Array<UsageAggregateRow & { dimension: string; value: string }>
    >(
      this.dimensionsQuery(
        identity.organizationId,
        scope.from,
        scope.to,
        filters,
      ),
    );
    return {
      period: this.period(scope.from, scope.to, days),
      embeddingScope: this.embeddingScope(filters),
      dimensions: dimensions.map((row) => ({
        dimension: row.dimension,
        value: row.value,
        ...this.metrics(row),
      })),
      apps: [...scope.apps, ...historical]
        .filter((app) => !filters.appcode || app.appcode === filters.appcode)
        .map((app) => ({
          id: app.id,
          appname: app.appname,
          appcode: app.appcode,
          ...this.metrics(byAppcode.get(app.appcode)),
        })),
    };
  }

  private async scope(identity: ConsoleIdentityContext, days: number) {
    const ownerships = await this.prisma.consoleAppOwnership.findMany({
      where: { organizationId: identity.organizationId },
      select: {
        appInfo: { select: { id: true, appname: true, appcode: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    const to = new Date();
    const from = new Date(
      Date.UTC(
        to.getUTCFullYear(),
        to.getUTCMonth(),
        to.getUTCDate() - days + 1,
      ),
    );
    const apps = ownerships.map((ownership) => ownership.appInfo);
    return { apps, appcodes: apps.map((app) => app.appcode), from, to };
  }

  private events(
    organizationId: string,
    from: Date,
    to: Date,
    filters: ConsoleUsageFilters = {},
  ) {
    // Embeddings are a separate Family operation ledger, not generation requests/tokens.
    const embeddingFilter =
      filters.endpoint || filters.modelId || filters.status
        ? Prisma.sql`AND false`
        : Prisma.empty;
    const appFilter = filters.appcode
      ? Prisma.sql`AND usage.appcode = ${filters.appcode}`
      : Prisma.empty;
    return Prisma.sql`${consoleUsageEvents(organizationId, from, to, filters)},
      usage_events AS (SELECT *, CASE WHEN status = 'unknown' THEN NULL ELSE status END AS outcome_status FROM request_events),
      embedding_events AS (
        SELECT usage.appcode, usage.created_at AS occurred_at,
               usage.kind::text AS kind, usage.state::text AS state
        FROM family_embedding_usage usage
        JOIN appinfo app ON app.appcode = usage.appcode
        JOIN console_app_ownership ownership ON ownership.app_info_id = app.id
        WHERE ownership.organization_id = ${organizationId}::uuid
          AND usage.created_at >= ${from} AND usage.created_at < ${to}
          ${embeddingFilter} ${appFilter}
      )`;
  }

  private summaryQuery(
    organizationId: string,
    from: Date,
    to: Date,
    filters: ConsoleUsageFilters = {},
  ) {
    return Prisma.sql`${this.events(organizationId, from, to, filters)}
      SELECT COUNT(*)::int AS "requestCount",
             COALESCE(SUM(inputtokens), 0)::float8 AS "inputTokens",
             COUNT(inputtokens)::int AS "inputMeasuredRequests",
             COALESCE(SUM(outputtokens), 0)::float8 AS "outputTokens",
             COUNT(outputtokens)::int AS "outputMeasuredRequests",
             COALESCE(SUM(totaltokens), 0)::float8 AS "totalTokens",
             COUNT(totaltokens)::int AS "tokenMeasuredRequests",
             AVG(responsetime)::float8 AS "averageLatencyMs",
             MAX(responsetime)::float8 AS "maximumLatencyMs",
             percentile_cont(0.5) WITHIN GROUP (ORDER BY responsetime)::float8 AS "p50LatencyMs",
             percentile_cont(0.95) WITHIN GROUP (ORDER BY responsetime)::float8 AS "p95LatencyMs",
             COUNT(responsetime)::int AS "latencyMeasuredRequests",
             COUNT(*) FILTER (WHERE outcome_status = 'success')::int AS "successfulRequests",
             COUNT(*) FILTER (WHERE outcome_status = 'failed')::int AS "failedRequests",
             COUNT(outcome_status)::int AS "outcomeMeasuredRequests",
             (SELECT COUNT(*)::int FROM embedding_events) AS "embeddingOperations",
             (SELECT COUNT(*) FILTER (WHERE kind = 'INDEX')::int FROM embedding_events) AS "embeddingIndexOperations",
             (SELECT COUNT(*) FILTER (WHERE kind = 'SEARCH')::int FROM embedding_events) AS "embeddingSearchOperations",
             (SELECT COUNT(*) FILTER (WHERE state = 'RESERVED')::int FROM embedding_events) AS "embeddingReservedOperations",
             (SELECT COUNT(*) FILTER (WHERE state = 'SUCCEEDED')::int FROM embedding_events) AS "embeddingSucceededOperations",
             (SELECT COUNT(*) FILTER (WHERE state = 'UNCERTAIN')::int FROM embedding_events) AS "embeddingUncertainOperations"
      FROM usage_events`;
  }

  private timeseriesQuery(
    organizationId: string,
    from: Date,
    to: Date,
    filters: ConsoleUsageFilters = {},
  ) {
    return Prisma.sql`${this.events(organizationId, from, to, filters)},
      request_days AS (
        SELECT TO_CHAR(occurred_at, 'YYYY-MM-DD') AS date,
               COUNT(*)::int AS request_count,
               COALESCE(SUM(totaltokens), 0)::float8 AS total_tokens,
               COUNT(totaltokens)::int AS token_measured_requests,
               AVG(responsetime)::float8 AS average_latency_ms,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY responsetime)::float8 AS p50_latency_ms,
               percentile_cont(0.95) WITHIN GROUP (ORDER BY responsetime)::float8 AS p95_latency_ms,
               COUNT(responsetime)::int AS latency_measured_requests,
               COUNT(*) FILTER (WHERE outcome_status = 'success')::int AS successful_requests,
               COUNT(*) FILTER (WHERE outcome_status = 'failed')::int AS failed_requests,
               COUNT(outcome_status)::int AS outcome_measured_requests
        FROM usage_events GROUP BY date
      ),
      embedding_days AS (
        SELECT TO_CHAR(occurred_at, 'YYYY-MM-DD') AS date,
               COUNT(*)::int AS operations,
               COUNT(*) FILTER (WHERE kind = 'INDEX')::int AS index_operations,
               COUNT(*) FILTER (WHERE kind = 'SEARCH')::int AS search_operations,
               COUNT(*) FILTER (WHERE state = 'RESERVED')::int AS reserved_operations,
               COUNT(*) FILTER (WHERE state = 'SUCCEEDED')::int AS succeeded_operations,
               COUNT(*) FILTER (WHERE state = 'UNCERTAIN')::int AS uncertain_operations
        FROM embedding_events GROUP BY date
      ),
      activity_days AS (
        SELECT date FROM request_days UNION SELECT date FROM embedding_days
      )
      SELECT days.date,
             COALESCE(requests.request_count, 0)::int AS "requestCount",
             COALESCE(requests.total_tokens, 0)::float8 AS "totalTokens",
             COALESCE(requests.token_measured_requests, 0)::int AS "tokenMeasuredRequests",
             requests.average_latency_ms::float8 AS "averageLatencyMs",
             requests.p50_latency_ms AS "p50LatencyMs", requests.p95_latency_ms AS "p95LatencyMs",
             COALESCE(requests.latency_measured_requests, 0)::int AS "latencyMeasuredRequests",
             COALESCE(requests.successful_requests, 0)::int AS "successfulRequests",
             COALESCE(requests.failed_requests, 0)::int AS "failedRequests",
             COALESCE(requests.outcome_measured_requests, 0)::int AS "outcomeMeasuredRequests",
             COALESCE(embeddings.operations, 0)::int AS "embeddingOperations",
             COALESCE(embeddings.index_operations, 0)::int AS "embeddingIndexOperations",
             COALESCE(embeddings.search_operations, 0)::int AS "embeddingSearchOperations",
             COALESCE(embeddings.reserved_operations, 0)::int AS "embeddingReservedOperations",
             COALESCE(embeddings.succeeded_operations, 0)::int AS "embeddingSucceededOperations",
             COALESCE(embeddings.uncertain_operations, 0)::int AS "embeddingUncertainOperations"
      FROM activity_days days
      LEFT JOIN request_days requests USING (date)
      LEFT JOIN embedding_days embeddings USING (date)
      ORDER BY days.date`;
  }

  private breakdownQuery(
    organizationId: string,
    from: Date,
    to: Date,
    filters: ConsoleUsageFilters = {},
  ) {
    return Prisma.sql`${this.events(organizationId, from, to, filters)},
      request_apps AS (
      SELECT appcode, COUNT(*)::int AS "requestCount",
             COALESCE(SUM(inputtokens), 0)::float8 AS "inputTokens",
             COUNT(inputtokens)::int AS "inputMeasuredRequests",
             COALESCE(SUM(outputtokens), 0)::float8 AS "outputTokens",
             COUNT(outputtokens)::int AS "outputMeasuredRequests",
             COALESCE(SUM(totaltokens), 0)::float8 AS "totalTokens",
             COUNT(totaltokens)::int AS "tokenMeasuredRequests",
             AVG(responsetime)::float8 AS "averageLatencyMs",
             MAX(responsetime)::float8 AS "maximumLatencyMs",
             percentile_cont(0.5) WITHIN GROUP (ORDER BY responsetime)::float8 AS "p50LatencyMs",
             percentile_cont(0.95) WITHIN GROUP (ORDER BY responsetime)::float8 AS "p95LatencyMs",
             COUNT(responsetime)::int AS "latencyMeasuredRequests",
             COUNT(*) FILTER (WHERE outcome_status = 'success')::int AS "successfulRequests",
             COUNT(*) FILTER (WHERE outcome_status = 'failed')::int AS "failedRequests",
             COUNT(outcome_status)::int AS "outcomeMeasuredRequests"
      FROM usage_events
      GROUP BY appcode),
      embedding_apps AS (
        SELECT appcode, COUNT(*)::int AS "embeddingOperations",
               COUNT(*) FILTER (WHERE kind = 'INDEX')::int AS "embeddingIndexOperations",
               COUNT(*) FILTER (WHERE kind = 'SEARCH')::int AS "embeddingSearchOperations",
               COUNT(*) FILTER (WHERE state = 'RESERVED')::int AS "embeddingReservedOperations",
               COUNT(*) FILTER (WHERE state = 'SUCCEEDED')::int AS "embeddingSucceededOperations",
               COUNT(*) FILTER (WHERE state = 'UNCERTAIN')::int AS "embeddingUncertainOperations"
        FROM embedding_events GROUP BY appcode
      )
      SELECT COALESCE(requests.appcode, embeddings.appcode) AS appcode,
             COALESCE(requests."requestCount", 0)::int AS "requestCount",
             COALESCE(requests."inputTokens", 0)::float8 AS "inputTokens",
             COALESCE(requests."inputMeasuredRequests", 0)::int AS "inputMeasuredRequests",
             COALESCE(requests."outputTokens", 0)::float8 AS "outputTokens",
             COALESCE(requests."outputMeasuredRequests", 0)::int AS "outputMeasuredRequests",
             COALESCE(requests."totalTokens", 0)::float8 AS "totalTokens",
             COALESCE(requests."tokenMeasuredRequests", 0)::int AS "tokenMeasuredRequests",
             requests."averageLatencyMs", requests."maximumLatencyMs", requests."p50LatencyMs", requests."p95LatencyMs",
             COALESCE(requests."latencyMeasuredRequests", 0)::int AS "latencyMeasuredRequests",
             COALESCE(requests."successfulRequests", 0)::int AS "successfulRequests",
             COALESCE(requests."failedRequests", 0)::int AS "failedRequests",
             COALESCE(requests."outcomeMeasuredRequests", 0)::int AS "outcomeMeasuredRequests",
             COALESCE(embeddings."embeddingOperations", 0)::int AS "embeddingOperations",
             COALESCE(embeddings."embeddingIndexOperations", 0)::int AS "embeddingIndexOperations",
             COALESCE(embeddings."embeddingSearchOperations", 0)::int AS "embeddingSearchOperations",
             COALESCE(embeddings."embeddingReservedOperations", 0)::int AS "embeddingReservedOperations",
             COALESCE(embeddings."embeddingSucceededOperations", 0)::int AS "embeddingSucceededOperations",
             COALESCE(embeddings."embeddingUncertainOperations", 0)::int AS "embeddingUncertainOperations"
      FROM request_apps requests FULL JOIN embedding_apps embeddings USING (appcode)
      ORDER BY appcode`;
  }

  private dimensionsQuery(
    organizationId: string,
    from: Date,
    to: Date,
    filters: ConsoleUsageFilters,
  ) {
    return Prisma.sql`${this.events(organizationId, from, to, filters)}
      SELECT CASE WHEN GROUPING(endpoint) = 0 THEN 'endpoint'
                  WHEN GROUPING(model_id) = 0 THEN 'model' ELSE 'status' END AS dimension,
             CASE WHEN GROUPING(endpoint) = 0 THEN endpoint
                  WHEN GROUPING(model_id) = 0 THEN COALESCE(model_id, 'unknown') ELSE status END AS value,
             COUNT(*)::int AS "requestCount",
             COALESCE(SUM(inputtokens), 0)::float8 AS "inputTokens",
             COUNT(inputtokens)::int AS "inputMeasuredRequests",
             COALESCE(SUM(outputtokens), 0)::float8 AS "outputTokens",
             COUNT(outputtokens)::int AS "outputMeasuredRequests",
             COALESCE(SUM(totaltokens), 0)::float8 AS "totalTokens",
             COUNT(totaltokens)::int AS "tokenMeasuredRequests",
             AVG(responsetime)::float8 AS "averageLatencyMs",
             MAX(responsetime)::float8 AS "maximumLatencyMs",
             percentile_cont(0.5) WITHIN GROUP (ORDER BY responsetime)::float8 AS "p50LatencyMs",
             percentile_cont(0.95) WITHIN GROUP (ORDER BY responsetime)::float8 AS "p95LatencyMs",
             COUNT(responsetime)::int AS "latencyMeasuredRequests",
             COUNT(*) FILTER (WHERE status = 'success')::int AS "successfulRequests",
             COUNT(*) FILTER (WHERE status = 'failed')::int AS "failedRequests",
             COUNT(*) FILTER (WHERE status <> 'unknown')::int AS "outcomeMeasuredRequests"
      FROM usage_events
      GROUP BY GROUPING SETS ((endpoint), (model_id), (status))
      ORDER BY dimension, value`;
  }

  async monthly(identity: ConsoleIdentityContext) {
    const now = new Date();
    const periodKey = now.toISOString().slice(0, 7);
    const from = new Date(`${periodKey}-01T00:00:00.000Z`);
    const end = new Date(from);
    end.setUTCMonth(end.getUTCMonth() + 1);
    return this.prisma.$transaction(
      async (tx) => {
        const organization = await tx.consoleOrganization.findUniqueOrThrow({
          where: { id: identity.organizationId },
        });
        const [rows, pending, ownerships] = await Promise.all([
          tx.$queryRaw<UsageAggregateRow[]>(
            this.summaryQuery(identity.organizationId, from, end),
          ),
          tx.consoleUsageReservation.findMany({
            where: {
              organizationId: identity.organizationId,
              periodKey,
              state: { in: ['RESERVED', 'UNCERTAIN'] },
            },
            select: {
              appcode: true,
              reservedRequests: true,
              reservedTokens: true,
            },
          }),
          tx.consoleAppOwnership.findMany({
            where: { organizationId: identity.organizationId },
            select: {
              appInfo: {
                select: {
                  id: true,
                  appcode: true,
                  appname: true,
                  monthlyTokenLimit: true,
                },
              },
            },
          }),
        ]);
        const row = rows[0];
        const reservedRequests = pending.reduce(
          (sum, item) => sum + item.reservedRequests,
          0,
        );
        const reservedTokens = pending.reduce(
          (sum, item) => sum + item.reservedTokens,
          0,
        );
        const appRows = await tx.$queryRaw<UsageBreakdownRow[]>(
          this.breakdownQuery(identity.organizationId, from, end),
        );
        // App quotas span organization transfers. Do not expose another
        // organization's usage or claim that this organization's subtotal is
        // the app's complete remaining allowance.
        const otherOrganizationReservations =
          await tx.consoleUsageReservation.findMany({
            where: {
              appcode: { in: ownerships.map(({ appInfo }) => appInfo.appcode) },
              periodKey,
              OR: [
                { organizationId: { not: identity.organizationId } },
                { organizationId: null },
              ],
            },
            select: { appcode: true },
            distinct: ['appcode'],
          });
        return {
          period: {
            key: periodKey,
            from: from.toISOString(),
            to: end.toISOString(),
            asOf: now.toISOString(),
            timezone: 'UTC',
          },
          embeddingScope: this.embeddingScope({}),
          ...this.metrics(row),
          limits: {
            requests: this.limitMetric(
              organization.monthlyRequestLimit,
              Number(row?.requestCount ?? 0),
              reservedRequests,
              0,
            ),
            tokens: this.limitMetric(
              organization.monthlyTokenLimit,
              Number(row?.totalTokens ?? 0),
              reservedTokens,
              Number(row?.requestCount ?? 0) -
                Number(row?.tokenMeasuredRequests ?? 0),
            ),
          },
          apps: ownerships.map(({ appInfo: app }) => {
            const appRow = appRows.find((item) => item.appcode === app.appcode);
            const organizationChanged = otherOrganizationReservations.some(
              (item) => item.appcode === app.appcode,
            );
            return {
              id: app.id,
              appcode: app.appcode,
              appname: app.appname,
              tokens: this.limitMetric(
                app.monthlyTokenLimit,
                Number(appRow?.totalTokens ?? 0),
                pending
                  .filter((item) => item.appcode === app.appcode)
                  .reduce((sum, item) => sum + item.reservedTokens, 0),
                Number(appRow?.requestCount ?? 0) -
                  Number(appRow?.tokenMeasuredRequests ?? 0),
                organizationChanged,
              ),
            };
          }),
          management: {
            organization:
              'platform-admin: console_organization (approved configuration procedure; no Console edit API)',
            app: 'platform-admin: PATCH /app-info/:id monthlyTokenLimit',
          },
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  private limitMetric(
    limit: number | null,
    used: number,
    reserved: number,
    unmeasuredRequests: number,
    organizationChanged = false,
  ) {
    const committed = used + reserved;
    return {
      limit,
      used,
      reserved,
      committed,
      unmeasuredRequests,
      remaining:
        limit === null || unmeasuredRequests > 0 || organizationChanged
          ? null
          : Math.max(0, limit - committed),
      utilizationPercent:
        limit === null ||
        limit === 0 ||
        unmeasuredRequests > 0 ||
        organizationChanged
          ? null
          : Math.round((committed / limit) * 10_000) / 100,
      state:
        limit === null
          ? 'unlimited'
          : organizationChanged
            ? 'organization-changed'
            : unmeasuredRequests > 0
              ? 'unmeasured'
              : committed >= limit
                ? 'exhausted'
                : 'available',
    };
  }

  private metrics(row?: UsageAggregateRow) {
    return {
      requestCount: Number(row?.requestCount ?? 0),
      tokens: {
        input: this.measurement(row?.inputTokens, row?.inputMeasuredRequests),
        output: this.measurement(
          row?.outputTokens,
          row?.outputMeasuredRequests,
        ),
        total: this.measurement(row?.totalTokens, row?.tokenMeasuredRequests),
      },
      latency: {
        averageMs:
          row?.latencyMeasuredRequests && row.averageLatencyMs !== null
            ? Math.round(Number(row.averageLatencyMs))
            : null,
        maximumMs:
          row?.latencyMeasuredRequests && row.maximumLatencyMs !== null
            ? Number(row.maximumLatencyMs)
            : null,
        p50Ms: row?.p50LatencyMs == null ? null : Number(row.p50LatencyMs),
        p95Ms: row?.p95LatencyMs == null ? null : Number(row.p95LatencyMs),
        measuredRequests: Number(row?.latencyMeasuredRequests ?? 0),
      },
      measurement: {
        tokenUnmeasuredRequests:
          Number(row?.requestCount ?? 0) -
          Number(row?.tokenMeasuredRequests ?? 0),
        outcomeUnmeasuredRequests:
          Number(row?.requestCount ?? 0) -
          Number(row?.outcomeMeasuredRequests ?? 0),
        successRateDenominator: 'measured-outcomes',
      },
      outcome: this.outcome(row),
      embeddings: this.embeddingMetrics(row),
    };
  }

  private embeddingScope(filters: ConsoleUsageFilters) {
    return {
      source: 'family_embedding_usage',
      unit: 'operations',
      ownership: 'current-organization',
      generationTotalsIncluded: false,
      otherEmbeddingPaths: 'unmeasured',
      filteredOut: Boolean(
        filters.endpoint || filters.modelId || filters.status,
      ),
    };
  }

  private embeddingMetrics(
    row?: Pick<
      UsageAggregateRow,
      | 'embeddingOperations'
      | 'embeddingIndexOperations'
      | 'embeddingSearchOperations'
      | 'embeddingReservedOperations'
      | 'embeddingSucceededOperations'
      | 'embeddingUncertainOperations'
    >,
  ): EmbeddingMetrics {
    return {
      operations: Number(row?.embeddingOperations ?? 0),
      indexOperations: Number(row?.embeddingIndexOperations ?? 0),
      searchOperations: Number(row?.embeddingSearchOperations ?? 0),
      states: {
        reserved: Number(row?.embeddingReservedOperations ?? 0),
        succeeded: Number(row?.embeddingSucceededOperations ?? 0),
        uncertain: Number(row?.embeddingUncertainOperations ?? 0),
      },
    };
  }

  private outcome(
    row?: Pick<
      UsageAggregateRow,
      'successfulRequests' | 'failedRequests' | 'outcomeMeasuredRequests'
    >,
  ) {
    const successfulRequests = Number(row?.successfulRequests ?? 0);
    const failedRequests = Number(row?.failedRequests ?? 0);
    const measuredRequests = Number(row?.outcomeMeasuredRequests ?? 0);
    return {
      successfulRequests,
      failedRequests,
      measuredRequests,
      successRate: measuredRequests
        ? Math.round((successfulRequests / measuredRequests) * 10_000) / 100
        : null,
    };
  }

  private measurement(value?: number, measuredRequests?: number) {
    const measured = Number(measuredRequests ?? 0);
    return {
      value: measured ? Number(value ?? 0) : null,
      measuredRequests: measured,
    };
  }

  private period(from: Date, to: Date, days: number) {
    return { from: from.toISOString(), to: to.toISOString(), days };
  }
}
