import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { ConsoleUsageService } from '../src/console/usage/console-usage.service';
import { ConsoleRequestLogsService } from '../src/console/request-logs/console-request-logs.service';
import type { ConsoleIdentityContext } from '../src/console/security/console-identity-context';
import { UsageQuotaService } from '../src/usage-quota/usage-quota.service';

const suite =
  process.env.RUN_CONSOLE_USAGE_DB === 'true' ? describe : describe.skip;

suite('Console M2 usage and logs (isolated PostgreSQL)', () => {
  let prisma: PrismaService;
  let usage: ConsoleUsageService;
  let logs: ConsoleRequestLogsService;
  const now = new Date();
  const at = new Date(now.getTime() - 60_000);
  const periodKey = now.toISOString().slice(0, 7);

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    expect(['localhost', '127.0.0.1', '[::1]']).toContain(url.hostname);
    expect(url.pathname).toMatch(/^\/queue_e2e_[a-f0-9]{32}$/);
    prisma = new PrismaService();
    await prisma.$connect();
    usage = new ConsoleUsageService(prisma);
    logs = new ConsoleRequestLogsService(prisma);
  });
  afterAll(async () => prisma?.$disconnect());

  async function fixture() {
    const organization = await prisma.consoleOrganization.create({
      data: {
        worksOrganizationId: randomUUID(),
        displayName: 'M2 fixture',
        lastSyncedAt: now,
        monthlyRequestLimit: 100,
        monthlyTokenLimit: 1000,
      },
    });
    const actor = await prisma.consoleIdentity.create({
      data: { worksUserId: randomUUID(), lastSyncedAt: now },
    });
    const app = await prisma.appInfo.create({
      data: {
        appcode: `M2_${randomUUID()}`,
        appname: '=M2 private name',
        monthlyTokenLimit: 500,
        consoleOwnership: {
          create: {
            organizationId: organization.id,
            createdByIdentityId: actor.id,
          },
        },
      },
    });
    const identity: ConsoleIdentityContext = {
      authenticationSource: 'test-fixture',
      identityId: actor.id,
      worksUserId: actor.worksUserId,
      identityStatus: 'ACTIVE',
      organizationId: organization.id,
      worksOrganizationId: organization.worksOrganizationId,
      organizationStatus: 'ACTIVE',
      membershipId: randomUUID(),
      membershipStatus: 'ACTIVE',
      permissions: ['usage:read', 'logs:read'],
    };
    return { organization, app, identity };
  }

  async function reservation(
    organizationId: string,
    appcode: string,
    data: Partial<Prisma.ConsoleUsageReservationUncheckedCreateInput> = {},
  ) {
    return prisma.consoleUsageReservation.create({
      data: {
        organizationId,
        appcode,
        periodKey,
        createdAt: at,
        operationKeyHash: randomUUID().replaceAll('-', '').repeat(2),
        reservedRequests: 0,
        reservedTokens: 0,
        state: 'SETTLED',
        ...data,
      },
    });
  }

  async function sample() {
    const f = await fixture();
    const b = await prisma.bedrockSearchLog.create({
      data: {
        appcode: f.app.appcode,
        searchword: 'PRIVATE_QUESTION',
        searchat: at,
        responsetime: 100,
        inputtokens: 10,
        outputtokens: 20,
        totaltokens: 30,
        status: 'success',
        result: 'completed',
        endpoint: '/bedrock/converse',
        modelId: 'model-a',
        requestId: randomUUID(),
      },
    });
    const k = await prisma.knowledgeQueryLog.create({
      data: {
        appcode: f.app.appcode,
        question: 'PRIVATE_QUESTION',
        createdAt: at,
        responsetime: 200,
        modelId: 'model-b',
        requestId: randomUUID(),
        execution: {
          answerStatus: 'request_failed',
          errorCode: 'UPSTREAM_TIMEOUT',
          failedStage: 'generation',
          retrievedSources: ['PRIVATE_SOURCE'],
        },
      },
    });
    const linked = await reservation(f.organization.id, f.app.appcode, {
      usageLogSource: 'knowledge',
      usageLogId: k.id,
      actualTokens: 40,
      recoveryTokens: 40,
      recoveryKey: randomUUID(),
    });
    const c = await prisma.familyConversationMetric.create({
      data: {
        appcode: f.app.appcode,
        requestId: randomUUID(),
        policyVersion: 'frame-family-rag-v1',
        status: 'SUCCEEDED',
        latencyMs: 300,
        totalTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        resultCount: 2,
        createdAt: at,
        modelId: 'model-a',
      },
    });
    const legacy = await prisma.bedrockSearchLog.create({
      data: {
        appcode: f.app.appcode,
        searchword: '[CONTENT_OMITTED]',
        searchat: at,
        responsetime: 400,
      },
    });
    const recovered = await reservation(f.organization.id, f.app.appcode, {
      recoveryRequests: 1,
      recoveryTokens: 10,
      actualTokens: 10,
      recoveryKey: randomUUID(),
      operationScope: 'bedrock.general-answers',
    });
    await reservation(f.organization.id, f.app.appcode, {
      actualTokens: 0,
      recoveryKey: randomUUID(),
    });
    await reservation(f.organization.id, f.app.appcode, {
      state: 'UNCERTAIN',
      reservedRequests: 1,
      reservedTokens: 20,
    });
    await prisma.familyEmbeddingUsage.createMany({
      data: ['INDEX', 'SEARCH'].map((kind) => ({
        appcode: f.app.appcode,
        periodKey,
        operationKeyHash: randomUUID().replaceAll('-', '').repeat(2),
        kind: kind as 'INDEX' | 'SEARCH',
        state: 'SUCCEEDED',
        createdAt: at,
      })),
    });
    return { ...f, b, k, c, legacy, linked, recovered };
  }

  it('matches original ledgers, summary, timeseries, breakdown, logs, detail, CSV and quota', async () => {
    const f = await sample();
    const summary = await usage.summary(f.identity, 30);
    expect(summary).toMatchObject({
      requestCount: 5,
      tokens: { total: { value: 80, measuredRequests: 4 } },
      latency: { p50Ms: 250, p95Ms: 385, measuredRequests: 4 },
      outcome: {
        successfulRequests: 2,
        failedRequests: 1,
        measuredRequests: 3,
        successRate: 66.67,
      },
      measurement: { tokenUnmeasuredRequests: 1, outcomeUnmeasuredRequests: 2 },
      embeddings: { operations: 2, indexOperations: 1, searchOperations: 1 },
    });
    const series = await usage.timeseries(f.identity, 30);
    expect(series.points.reduce((n, p) => n + p.requestCount, 0)).toBe(5);
    expect(series.points.reduce((n, p) => n + (p.tokens.value ?? 0), 0)).toBe(
      80,
    );
    const breakdown = await usage.breakdown(f.identity, 30);
    expect(breakdown.apps[0]).toMatchObject({
      requestCount: 5,
      tokens: summary.tokens,
      latency: summary.latency,
    });
    for (const dimension of ['endpoint', 'model', 'status']) {
      const rows = breakdown.dimensions.filter(
        (row) => row.dimension === dimension,
      );
      expect(rows.reduce((n, row) => n + row.requestCount, 0)).toBe(5);
      expect(
        rows.reduce((n, row) => n + (row.tokens.total.value ?? 0), 0),
      ).toBe(80);
    }
    const page = await logs.list(f.identity, { days: 30, limit: 100 });
    expect(page.items).toHaveLength(5);
    expect(
      page.items.reduce((n, item) => n + (item.tokens.total ?? 0), 0),
    ).toBe(80);
    expect(
      page.items.find((item) => item.id === `bedrock:${f.legacy.id}`),
    ).toMatchObject({
      status: 'unknown',
      requestId: null,
      tokens: { total: null },
    });
    expect(await logs.findOne(`knowledge:${f.k.id}`, f.identity)).toMatchObject(
      {
        recovered: true,
        reservationId: f.linked.id,
        tokenSource: 'settled',
        tokens: { total: 40 },
      },
    );
    expect(
      await logs.findOne(`conversation:${f.c.id}`, f.identity),
    ).toMatchObject({
      endpoint: '/conversation/v1/turns',
      tokens: { total: 0 },
      content: { stored: false },
    });
    expect(
      await logs.findOne(`recovery:${f.recovered.id}`, f.identity),
    ).toMatchObject({ status: 'unknown', tokens: { total: 10 } });
    const csv = await logs.exportCsv(f.identity, { days: 30 });
    expect(csv.rowCount).toBe(5);
    expect(csv.csv).toContain('"\'=M2 private name"');
    expect(csv.csv).not.toMatch(/PRIVATE_QUESTION|PRIVATE_SOURCE/);
    const lines = csv.csv.trim().split('\r\n');
    expect(
      lines
        .slice(1)
        .reduce(
          (n, line) => n + Number(line.split(',')[12].replaceAll('"', '')),
          0,
        ),
    ).toBe(80);
    const quota = new UsageQuotaService(prisma) as unknown as {
      measuredUsage(
        tx: Prisma.TransactionClient,
        scope: { organizationId: string; periodKey: string },
      ): Promise<{ requests: number; tokens: number }>;
    };
    expect(
      await prisma.$transaction((tx) =>
        quota.measuredUsage(tx, {
          organizationId: f.organization.id,
          periodKey,
        }),
      ),
    ).toMatchObject({ requests: 5, tokens: 80 });
  });

  it('uses the same endpoint/model/status filters for aggregates, log pages and CSV', async () => {
    const f = await sample();
    const filters = {
      endpoint: '/knowledge/answers',
      modelId: 'model-b',
      status: 'failed' as const,
    };
    expect(await usage.summary(f.identity, 7, filters)).toMatchObject({
      requestCount: 1,
      tokens: { total: { value: 40 } },
      embeddings: { operations: 0 },
    });
    expect(
      (await usage.timeseries(f.identity, 7, filters)).points.reduce(
        (n, p) => n + p.requestCount,
        0,
      ),
    ).toBe(1);
    expect(
      (await usage.breakdown(f.identity, 7, filters)).apps[0].requestCount,
    ).toBe(1);
    expect(
      (
        await logs.list(f.identity, { ...filters, days: 7, limit: 25 })
      ).items.map((item) => item.id),
    ).toEqual([`knowledge:${f.k.id}`]);
    expect(
      (await logs.exportCsv(f.identity, { ...filters, days: 7 })).rowCount,
    ).toBe(1);
    expect(
      (
        await logs.list(f.identity, {
          days: 7,
          limit: 25,
          requestId: f.c.requestId,
        })
      ).items[0].id,
    ).toBe(`conversation:${f.c.id}`);
    expect(
      (
        await logs.list(f.identity, {
          days: 7,
          limit: 25,
          errorCode: 'upstream_timeout',
        })
      ).items[0].id,
    ).toBe(`knowledge:${f.k.id}`);
    expect(
      (await logs.list(f.identity, { days: 7, limit: 25, modelId: 'unknown' }))
        .items,
    ).toHaveLength(2);
  });

  it('paginates equal timestamps across all sources without duplicates or omissions', async () => {
    const f = await sample();
    const ids: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await logs.list(f.identity, { days: 30, limit: 2, cursor });
      ids.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(ids).toHaveLength(5);
    expect(new Set(ids).size).toBe(5);
    await expect(
      logs.list(f.identity, { days: 30, limit: 2, cursor: 'invalid' }),
    ).rejects.toThrow('cursor');
  });

  it('isolates both organizations, including direct log and app identifiers', async () => {
    const own = await sample();
    const foreign = await sample();
    expect((await usage.summary(own.identity, 90)).requestCount).toBe(5);
    await expect(
      logs.findOne(`conversation:${foreign.c.id}`, own.identity),
    ).rejects.toThrow('찾을 수 없습니다');
    await expect(
      logs.findOne(`recovery:${foreign.recovered.id}`, own.identity),
    ).rejects.toThrow('찾을 수 없습니다');
    await expect(
      logs.list(own.identity, { days: 30, limit: 25, appId: foreign.app.id }),
    ).rejects.toThrow('찾을 수 없습니다');
    expect(
      (
        await logs.exportCsv(own.identity, {
          days: 30,
          appcode: foreign.app.appcode,
        })
      ).rowCount,
    ).toBe(0);
  });

  it('retains reservation organization and admission month after app transfer and month crossing', async () => {
    const origin = await fixture();
    const destination = await fixture();
    const previous = new Date(`${periodKey}-01T00:00:00.000Z`);
    previous.setUTCMilliseconds(-1);
    const raw = await prisma.bedrockSearchLog.create({
      data: {
        appcode: origin.app.appcode,
        searchword: '[CONTENT_OMITTED]',
        searchat: at,
        responsetime: 10,
        totaltokens: 5,
        status: 'success',
      },
    });
    await reservation(origin.organization.id, origin.app.appcode, {
      periodKey: previous.toISOString().slice(0, 7),
      createdAt: previous,
      usageLogSource: 'bedrock',
      usageLogId: raw.id,
      actualTokens: 5,
    });
    await prisma.consoleAppOwnership.update({
      where: { appInfoId: origin.app.id },
      data: { organizationId: destination.organization.id },
    });
    expect(await usage.summary(origin.identity, 90)).toMatchObject({
      appCount: 0,
      requestCount: 1,
      tokens: { total: { value: 5 } },
    });
    expect((await usage.breakdown(origin.identity, 90)).apps[0]).toMatchObject({
      id: null,
      appcode: origin.app.appcode,
      requestCount: 1,
    });
    expect(
      (await logs.findOne(`bedrock:${raw.id}`, origin.identity)).occurredAt,
    ).toBe(previous.toISOString());
    expect(
      (await logs.findOne(`bedrock:${raw.id}`, origin.identity)).originalAt,
    ).toBe(at.toISOString());
    expect((await usage.monthly(origin.identity)).requestCount).toBe(0);
    expect(
      (
        await logs.list(origin.identity, {
          days: 30,
          period: 'month',
          limit: 25,
        })
      ).items,
    ).toHaveLength(0);
    expect((await usage.summary(destination.identity, 90)).requestCount).toBe(
      0,
    );
    await expect(
      logs.findOne(`bedrock:${raw.id}`, destination.identity),
    ).rejects.toThrow();
    expect((await logs.exportCsv(origin.identity, { days: 90 })).rowCount).toBe(
      1,
    );
  });

  it('separates monthly limits and active reservations from unknown or zero measurements', async () => {
    const f = await sample();
    const monthly = await usage.monthly(f.identity);
    expect(monthly.period).toMatchObject({
      key: periodKey,
      timezone: 'UTC',
      from: `${periodKey}-01T00:00:00.000Z`,
    });
    expect(monthly.limits.requests).toMatchObject({
      used: 5,
      reserved: 1,
      limit: 100,
      remaining: 94,
      utilizationPercent: 6,
    });
    expect(monthly.limits.tokens).toMatchObject({
      used: 80,
      reserved: 20,
      unmeasuredRequests: 1,
      remaining: null,
      state: 'unmeasured',
    });
    await prisma.bedrockSearchLog.update({
      where: { id: f.legacy.id },
      data: { totaltokens: 0 },
    });
    expect((await usage.monthly(f.identity)).limits.tokens).toMatchObject({
      used: 80,
      reserved: 20,
      remaining: 900,
      utilizationPercent: 10,
    });
    expect((await usage.monthly(f.identity)).apps[0].tokens).toMatchObject({
      limit: 500,
      remaining: 400,
    });
    await prisma.consoleOrganization.update({
      where: { id: f.organization.id },
      data: { monthlyRequestLimit: 0, monthlyTokenLimit: null },
    });
    const changed = await usage.monthly(f.identity);
    expect(changed.limits.requests).toMatchObject({
      remaining: 0,
      utilizationPercent: null,
      state: 'exhausted',
    });
    expect(changed.limits.tokens).toMatchObject({
      remaining: null,
      utilizationPercent: null,
      state: 'unlimited',
    });
  });

  it('caps CSV at 5000 rows and returns a truthful truncation indicator', async () => {
    const f = await fixture();
    await prisma.bedrockSearchLog.createMany({
      data: Array.from({ length: 5001 }, () => ({
        appcode: f.app.appcode,
        searchword: '[CONTENT_OMITTED]',
        searchat: at,
        responsetime: 0,
        totaltokens: 0,
      })),
    });
    const result = await logs.exportCsv(f.identity, { days: 7 });
    expect(result).toMatchObject({ rowCount: 5000, truncated: true });
    expect(result.csv.trim().split('\r\n')).toHaveLength(5001);
    expect((await usage.summary(f.identity, 7)).requestCount).toBe(5001);
  });

  it('does not present an app subtotal as complete quota after a same-month organization transfer', async () => {
    const origin = await fixture();
    const destination = await fixture();
    await reservation(origin.organization.id, origin.app.appcode, {
      actualTokens: 200,
      recoveryRequests: 1,
      recoveryTokens: 200,
      recoveryKey: randomUUID(),
    });
    await prisma.consoleAppOwnership.update({
      where: { appInfoId: origin.app.id },
      data: { organizationId: destination.organization.id },
    });
    const monthly = await usage.monthly(destination.identity);
    expect(monthly.limits.tokens.used).toBe(0);
    expect(
      monthly.apps.find((app) => app.id === origin.app.id)?.tokens,
    ).toMatchObject({
      used: 0,
      remaining: null,
      utilizationPercent: null,
      state: 'organization-changed',
    });
    expect((await usage.monthly(origin.identity)).limits.tokens.used).toBe(200);
  });
});
