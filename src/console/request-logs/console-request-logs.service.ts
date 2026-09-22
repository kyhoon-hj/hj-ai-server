import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { consoleUsageEvents } from '../usage/console-usage-events';
import { PrismaService } from '../../prisma/prisma.service';
import type { ConsoleIdentityContext } from '../security/console-identity-context';
import type { ExportConsoleRequestLogsDto } from './dto/export-console-request-logs.dto';
import type { ListConsoleRequestLogsDto } from './dto/list-console-request-logs.dto';

type RequestLogRow = {
  logId: string;
  source: 'knowledge' | 'bedrock' | 'conversation' | 'recovery';
  appcode: string;
  occurredAt: Date;
  originalAt?: Date;
  reservationId?: string | null;
  recovered?: boolean;
  tokenSource?: string;
  requestId: string | null;
  endpoint: string;
  status: 'success' | 'failed' | 'unknown';
  result: string;
  failureStage: string | null;
  errorCode: string | null;
  modelId: string | null;
  embeddingModel: string | null;
  responseTimeMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  matchedChunkCount: number;
  contentStored: boolean;
  execution: unknown;
};

type Cursor = { occurredAt: string; logId: string };
type OwnedApp = { id: string; appname: string; appcode: string };
const CSV_EXPORT_ROW_LIMIT = 5_000;

@Injectable()
export class ConsoleRequestLogsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    identity: ConsoleIdentityContext,
    query: ListConsoleRequestLogsDto,
  ) {
    const apps = await this.ownedApps(identity.organizationId, query.appId);
    const cursor = query.cursor ? this.decodeCursor(query.cursor) : undefined;
    const to = new Date();
    const from = new Date(
      Date.UTC(
        to.getUTCFullYear(),
        to.getUTCMonth(),
        query.period === 'month' ? 1 : to.getUTCDate() - query.days + 1,
      ),
    );
    if (query.period === 'month') {
      to.setTime(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1));
    }
    const rows = await this.prisma.$queryRaw<RequestLogRow[]>(
      this.listQuery(identity.organizationId, apps, from, to, query, cursor),
    );
    const hasMore = rows.length > query.limit;
    const page = rows.slice(0, query.limit);
    return {
      period: {
        from: from.toISOString(),
        to: to.toISOString(),
        days: query.days,
        kind: query.period ?? 'rolling',
      },
      items: page.map((row) => this.toListItem(row, apps)),
      nextCursor: hasMore
        ? this.encodeCursor(page.at(-1) as RequestLogRow)
        : null,
    };
  }

  async findOne(logId: string, identity: ConsoleIdentityContext) {
    if (
      !/^(knowledge|bedrock|conversation|recovery):[0-9a-f-]{36}$/i.test(logId)
    ) {
      throw new NotFoundException('요청 로그를 찾을 수 없습니다.');
    }
    const apps = await this.ownedApps(identity.organizationId);
    const rows = await this.prisma.$queryRaw<RequestLogRow[]>(
      this.detailQuery(identity.organizationId, logId),
    );
    const row = rows[0];
    if (!row) throw new NotFoundException('요청 로그를 찾을 수 없습니다.');
    return {
      ...this.toListItem(row, apps),
      matchedChunkCount: Number(row.matchedChunkCount ?? 0),
      content: {
        stored: Boolean(row.contentStored),
        exposed: false,
        reason: 'operational-metadata-only',
      },
      execution: this.executionMetadata(row.execution),
    };
  }

  async exportCsv(
    identity: ConsoleIdentityContext,
    query: ExportConsoleRequestLogsDto,
  ) {
    const apps = await this.ownedApps(identity.organizationId, query.appId);
    const to = new Date();
    const from = new Date(
      Date.UTC(
        to.getUTCFullYear(),
        to.getUTCMonth(),
        query.period === 'month' ? 1 : to.getUTCDate() - query.days + 1,
      ),
    );
    if (query.period === 'month') {
      to.setTime(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1));
    }
    const rows = await this.prisma.$queryRaw<RequestLogRow[]>(
      this.listQuery(
        identity.organizationId,
        apps,
        from,
        to,
        { ...query, limit: CSV_EXPORT_ROW_LIMIT },
        undefined,
        CSV_EXPORT_ROW_LIMIT + 1,
      ),
    );
    const page = rows.slice(0, CSV_EXPORT_ROW_LIMIT);
    const header = [
      'occurredAt',
      'appname',
      'appcode',
      'endpoint',
      'status',
      'result',
      'errorCode',
      'failureStage',
      'requestId',
      'latencyMs',
      'inputTokens',
      'outputTokens',
      'totalTokens',
      'modelId',
      'embeddingModel',
      'logId',
      'originalAt',
      'reservationId',
      'tokenSource',
      'recovered',
    ];
    const lines = page.map((row) => {
      const item = this.toListItem(row, apps);
      return [
        item.occurredAt,
        item.app.appname,
        item.app.appcode,
        item.endpoint,
        item.status,
        item.result,
        item.errorCode,
        item.failureStage,
        item.requestId,
        item.latencyMs,
        item.tokens.input,
        item.tokens.output,
        item.tokens.total,
        item.modelId,
        item.embeddingModel,
        item.id,
        item.originalAt,
        item.reservationId,
        item.tokenSource,
        item.recovered,
      ]
        .map((value) => this.csvCell(value))
        .join(',');
    });
    return {
      csv: `\uFEFF${[header.join(','), ...lines].join('\r\n')}\r\n`,
      rowCount: page.length,
      truncated: rows.length > CSV_EXPORT_ROW_LIMIT,
    };
  }

  private async ownedApps(organizationId: string, appId?: string) {
    const ownerships = await this.prisma.consoleAppOwnership.findMany({
      where: { organizationId, ...(appId ? { appInfoId: appId } : {}) },
      select: {
        appInfo: { select: { id: true, appname: true, appcode: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    if (appId && !ownerships.length) {
      throw new NotFoundException('요청한 앱을 찾을 수 없습니다.');
    }
    return ownerships.map((ownership) => ownership.appInfo);
  }

  private listQuery(
    organizationId: string,
    apps: OwnedApp[],
    from: Date,
    to: Date,
    query: ListConsoleRequestLogsDto,
    cursor?: Cursor,
    rowLimit = query.limit + 1,
  ) {
    const filters: Prisma.Sql[] = [];
    if (query.appcode) filters.push(Prisma.sql`appcode = ${query.appcode}`);
    if (query.status) filters.push(Prisma.sql`status = ${query.status}`);
    if (query.requestId) {
      filters.push(Prisma.sql`request_id = ${query.requestId.trim()}`);
    }
    if (query.errorCode) {
      filters.push(
        Prisma.sql`error_code = ${query.errorCode.trim().toUpperCase()}`,
      );
    }
    if (cursor) {
      filters.push(
        Prisma.sql`(occurred_at, log_id) < (${new Date(cursor.occurredAt)}, ${cursor.logId})`,
      );
    }
    const where = filters.length
      ? Prisma.sql`WHERE ${Prisma.join(filters, ' AND ')}`
      : Prisma.empty;
    return Prisma.sql`${consoleUsageEvents(organizationId, from, to, { ...query, appcode: query.appId ? apps[0]?.appcode : query.appcode })}
      SELECT log_id AS "logId", source, appcode,
             occurred_at AS "occurredAt", original_at AS "originalAt",
             reservation_id AS "reservationId", recovered, token_source AS "tokenSource", request_id AS "requestId", endpoint,
             status, result, failure_stage AS "failureStage", error_code AS "errorCode",
             model_id AS "modelId",
             embedding_model AS "embeddingModel", responsetime AS "responseTimeMs",
             inputtokens AS "inputTokens", outputtokens AS "outputTokens",
             totaltokens AS "totalTokens", matched_chunk_count AS "matchedChunkCount",
             content_stored AS "contentStored", execution
      FROM request_events ${where}
      ORDER BY occurred_at DESC, log_id DESC
      LIMIT ${rowLimit}`;
  }

  private detailQuery(organizationId: string, logId: string) {
    return Prisma.sql`${consoleUsageEvents(organizationId)}
      SELECT log_id AS "logId", source, appcode,
             occurred_at AS "occurredAt", original_at AS "originalAt",
             reservation_id AS "reservationId", recovered, token_source AS "tokenSource", request_id AS "requestId", endpoint,
             status, result, failure_stage AS "failureStage", error_code AS "errorCode",
             model_id AS "modelId",
             embedding_model AS "embeddingModel", responsetime AS "responseTimeMs",
             inputtokens AS "inputTokens", outputtokens AS "outputTokens",
             totaltokens AS "totalTokens", matched_chunk_count AS "matchedChunkCount",
             content_stored AS "contentStored", execution
      FROM request_events WHERE log_id = ${logId}
      LIMIT 1`;
  }

  private toListItem(row: RequestLogRow, apps: OwnedApp[]) {
    const app = apps.find((candidate) => candidate.appcode === row.appcode);
    return {
      id: row.logId,
      source: row.source,
      app: app
        ? { id: app.id, appname: app.appname, appcode: app.appcode }
        : { id: null, appname: row.appcode, appcode: row.appcode },
      occurredAt: new Date(row.occurredAt).toISOString(),
      originalAt: new Date(row.originalAt ?? row.occurredAt).toISOString(),
      reservationId: row.reservationId ?? null,
      recovered: row.recovered ?? false,
      tokenSource:
        row.tokenSource ??
        (row.totalTokens === null ? 'unmeasured' : 'measured'),
      requestId: row.requestId,
      endpoint: row.endpoint,
      status: row.status,
      result: row.result,
      failureStage: row.failureStage,
      errorCode: row.errorCode,
      modelId: row.modelId,
      embeddingModel: row.embeddingModel,
      latencyMs:
        row.responseTimeMs === null ? null : Number(row.responseTimeMs),
      tokens: {
        input: row.inputTokens === null ? null : Number(row.inputTokens),
        output: row.outputTokens === null ? null : Number(row.outputTokens),
        total: row.totalTokens === null ? null : Number(row.totalTokens),
      },
    };
  }

  private executionMetadata(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return null;
    const execution = value as Record<string, unknown>;
    const allowed = [
      'schemaVersion',
      'promptVersion',
      'policyVersion',
      'modelInvoked',
      'stopReason',
      'failedStage',
      'errorCode',
      'aborted',
      'performance',
      'sdk',
    ];
    return Object.fromEntries(
      allowed
        .filter((key) => Object.hasOwn(execution, key))
        .map((key) => [key, execution[key]]),
    );
  }

  private encodeCursor(row: RequestLogRow) {
    return Buffer.from(
      JSON.stringify({
        occurredAt: new Date(row.occurredAt).toISOString(),
        logId: row.logId,
      } satisfies Cursor),
    ).toString('base64url');
  }

  private csvCell(value: unknown) {
    if (value === null || value === undefined) return '';
    if (
      typeof value !== 'string' &&
      typeof value !== 'number' &&
      typeof value !== 'boolean' &&
      typeof value !== 'bigint'
    ) {
      return '';
    }
    let text = String(value);
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  }

  private decodeCursor(value: string): Cursor {
    try {
      const cursor = JSON.parse(
        Buffer.from(value, 'base64url').toString('utf8'),
      ) as Partial<Cursor>;
      if (
        !cursor.occurredAt ||
        Number.isNaN(new Date(cursor.occurredAt).getTime()) ||
        !cursor.logId ||
        !/^(knowledge|bedrock|conversation|recovery):[0-9a-f-]{36}$/i.test(
          cursor.logId,
        )
      ) {
        throw new Error('invalid cursor');
      }
      return cursor as Cursor;
    } catch {
      throw new BadRequestException('유효하지 않은 페이지 cursor입니다.');
    }
  }
}
