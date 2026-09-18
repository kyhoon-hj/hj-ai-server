import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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
  latency: { averageMs: number | null; measuredRequests: number };
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

  async summary(identity: ConsoleIdentityContext, days: number) {
    const scope = await this.scope(identity, days);
    const row = scope.apps.length
      ? (
          await this.prisma.$queryRaw<UsageAggregateRow[]>(
            this.summaryQuery(scope.appcodes, scope.from, scope.to),
          )
        )[0]
      : undefined;
    return {
      period: this.period(scope.from, scope.to, days),
      appCount: scope.apps.length,
      ...this.metrics(row),
    };
  }

  async timeseries(identity: ConsoleIdentityContext, days: number) {
    const scope = await this.scope(identity, days);
    const rows = scope.apps.length
      ? await this.prisma.$queryRaw<UsageSeriesRow[]>(
          this.timeseriesQuery(scope.appcodes, scope.from, scope.to),
        )
      : [];
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
          measuredRequests: Number(row?.latencyMeasuredRequests ?? 0),
        },
        outcome: this.outcome(row),
        embeddings: this.embeddingMetrics(row),
      });
    }
    return {
      period: this.period(scope.from, scope.to, days),
      points,
    };
  }

  async breakdown(identity: ConsoleIdentityContext, days: number) {
    const scope = await this.scope(identity, days);
    const rows = scope.apps.length
      ? await this.prisma.$queryRaw<UsageBreakdownRow[]>(
          this.breakdownQuery(scope.appcodes, scope.from, scope.to),
        )
      : [];
    const byAppcode = new Map(rows.map((row) => [row.appcode, row]));
    return {
      period: this.period(scope.from, scope.to, days),
      apps: scope.apps.map((app) => ({
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

  private events(appcodes: string[], from: Date, to: Date) {
    const values = Prisma.join(
      appcodes.map((appcode) => Prisma.sql`(${appcode})`),
    );
    return Prisma.sql`
      WITH owned_apps(appcode) AS (VALUES ${values}),
      usage_events AS (
        SELECT log.appcode, log.searchat AS occurred_at,
               log.responsetime, log.inputtokens, log.outputtokens, log.totaltokens,
               'success'::text AS outcome_status
        FROM bedrock_search_log log
        JOIN owned_apps owned ON owned.appcode = log.appcode
        WHERE log.searchat >= ${from} AND log.searchat < ${to}
        UNION ALL
        SELECT log.appcode, log.created_at AS occurred_at,
               log.responsetime, log.inputtokens, log.outputtokens, log.totaltokens,
               CASE WHEN log.execution->>'answerStatus' = 'request_failed' THEN 'failed'
                    WHEN log.execution->>'answerStatus' IS NOT NULL THEN 'success'
                    ELSE NULL END AS outcome_status
        FROM knowledge_query_log log
        JOIN owned_apps owned ON owned.appcode = log.appcode
        WHERE log.created_at >= ${from} AND log.created_at < ${to}
        UNION ALL
        SELECT metric.appcode, metric.created_at AS occurred_at,
               metric.latency_ms AS responsetime,
               metric.input_tokens AS inputtokens,
               metric.output_tokens AS outputtokens,
               metric.total_tokens AS totaltokens,
               CASE WHEN metric.status = 'SUCCEEDED' THEN 'success'
                    WHEN metric.status = 'FAILED' THEN 'failed'
                    ELSE NULL END AS outcome_status
        FROM family_conversation_metric metric
        JOIN owned_apps owned ON owned.appcode = metric.appcode
        WHERE metric.created_at >= ${from} AND metric.created_at < ${to}
      ),
      embedding_events AS (
        SELECT usage.appcode, usage.created_at AS occurred_at,
               usage.kind::text AS kind, usage.state::text AS state
        FROM family_embedding_usage usage
        JOIN owned_apps owned ON owned.appcode = usage.appcode
        WHERE usage.created_at >= ${from} AND usage.created_at < ${to}
      )`;
  }

  private summaryQuery(appcodes: string[], from: Date, to: Date) {
    return Prisma.sql`${this.events(appcodes, from, to)}
      SELECT COUNT(*)::int AS "requestCount",
             COALESCE(SUM(inputtokens), 0)::float8 AS "inputTokens",
             COUNT(inputtokens)::int AS "inputMeasuredRequests",
             COALESCE(SUM(outputtokens), 0)::float8 AS "outputTokens",
             COUNT(outputtokens)::int AS "outputMeasuredRequests",
             COALESCE(SUM(totaltokens), 0)::float8 AS "totalTokens",
             COUNT(totaltokens)::int AS "tokenMeasuredRequests",
             AVG(responsetime)::float8 AS "averageLatencyMs",
             MAX(responsetime)::float8 AS "maximumLatencyMs",
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

  private timeseriesQuery(appcodes: string[], from: Date, to: Date) {
    return Prisma.sql`${this.events(appcodes, from, to)},
      request_days AS (
        SELECT TO_CHAR(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date,
               COUNT(*)::int AS request_count,
               COALESCE(SUM(totaltokens), 0)::float8 AS total_tokens,
               COUNT(totaltokens)::int AS token_measured_requests,
               AVG(responsetime)::float8 AS average_latency_ms,
               COUNT(responsetime)::int AS latency_measured_requests,
               COUNT(*) FILTER (WHERE outcome_status = 'success')::int AS successful_requests,
               COUNT(*) FILTER (WHERE outcome_status = 'failed')::int AS failed_requests,
               COUNT(outcome_status)::int AS outcome_measured_requests
        FROM usage_events GROUP BY date
      ),
      embedding_days AS (
        SELECT TO_CHAR(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date,
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

  private breakdownQuery(appcodes: string[], from: Date, to: Date) {
    return Prisma.sql`${this.events(appcodes, from, to)},
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
             requests."averageLatencyMs", requests."maximumLatencyMs",
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
        measuredRequests: Number(row?.latencyMeasuredRequests ?? 0),
      },
      outcome: this.outcome(row),
      embeddings: this.embeddingMetrics(row),
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
