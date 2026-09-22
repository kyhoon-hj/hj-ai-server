import type { ConsoleIdentityContext } from '../security/console-identity-context';
import { ConsoleUsageService } from './console-usage.service';

const identity: ConsoleIdentityContext = {
  authenticationSource: 'test-fixture',
  identityId: '11111111-1111-4111-8111-111111111111',
  worksUserId: '22222222-2222-4222-8222-222222222222',
  identityStatus: 'ACTIVE',
  organizationId: '33333333-3333-4333-8333-333333333333',
  worksOrganizationId: '44444444-4444-4444-8444-444444444444',
  organizationStatus: 'ACTIVE',
  membershipId: '55555555-5555-4555-8555-555555555555',
  membershipStatus: 'ACTIVE',
  permissions: ['usage:read'],
};

const apps = [
  {
    appInfo: { id: 'app-1', appname: 'Support', appcode: 'SUPPORT' },
  },
  {
    appInfo: { id: 'app-2', appname: 'Search', appcode: 'SEARCH' },
  },
];

describe('ConsoleUsageService', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-14T03:00:00.000Z'));
  });

  afterEach(() => jest.useRealTimers());

  const fixture = (rows: unknown[]) => {
    const findMany = jest.fn().mockResolvedValue(apps);
    const queryRaw = jest
      .fn<Promise<unknown[]>, [unknown]>()
      .mockResolvedValue(rows);
    const service = new ConsoleUsageService({
      consoleAppOwnership: { findMany },
      $queryRaw: queryRaw,
    } as never);
    return { service, findMany, queryRaw };
  };

  it('combines measured values while preserving unmeasured request counts', async () => {
    const { service, findMany } = fixture([
      {
        requestCount: 4,
        inputTokens: 20,
        inputMeasuredRequests: 2,
        outputTokens: 0,
        outputMeasuredRequests: 2,
        totalTokens: 20,
        tokenMeasuredRequests: 2,
        averageLatencyMs: 125.4,
        maximumLatencyMs: 200,
        latencyMeasuredRequests: 3,
        successfulRequests: 3,
        failedRequests: 1,
        outcomeMeasuredRequests: 4,
        embeddingOperations: 5,
        embeddingIndexOperations: 2,
        embeddingSearchOperations: 3,
        embeddingReservedOperations: 1,
        embeddingSucceededOperations: 3,
        embeddingUncertainOperations: 1,
      },
    ]);

    await expect(service.summary(identity, 30)).resolves.toMatchObject({
      appCount: 2,
      requestCount: 4,
      tokens: {
        input: { value: 20, measuredRequests: 2 },
        output: { value: 0, measuredRequests: 2 },
        total: { value: 20, measuredRequests: 2 },
      },
      latency: {
        averageMs: 125,
        maximumMs: 200,
        measuredRequests: 3,
      },
      outcome: {
        successfulRequests: 3,
        failedRequests: 1,
        measuredRequests: 4,
        successRate: 75,
      },
      embeddings: {
        operations: 5,
        indexOperations: 2,
        searchOperations: 3,
        states: { reserved: 1, succeeded: 3, uncertain: 1 },
      },
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: identity.organizationId },
      }),
    );
  });

  it('fills missing UTC dates with explicit zero requests and null measurements', async () => {
    const { service } = fixture([
      {
        date: '2026-09-14',
        requestCount: 1,
        totalTokens: 0,
        tokenMeasuredRequests: 1,
        averageLatencyMs: 10,
        latencyMeasuredRequests: 1,
        embeddingOperations: 2,
        embeddingIndexOperations: 0,
        embeddingSearchOperations: 2,
        embeddingReservedOperations: 0,
        embeddingSucceededOperations: 2,
        embeddingUncertainOperations: 0,
      },
    ]);

    const result = await service.timeseries(identity, 7);
    expect(result.points).toHaveLength(7);
    expect(result.points[0]).toEqual({
      date: '2026-09-08',
      requestCount: 0,
      tokens: { value: null, measuredRequests: 0 },
      latency: {
        averageMs: null,
        p50Ms: null,
        p95Ms: null,
        measuredRequests: 0,
      },
      outcome: {
        successfulRequests: 0,
        failedRequests: 0,
        measuredRequests: 0,
        successRate: null,
      },
      embeddings: {
        operations: 0,
        indexOperations: 0,
        searchOperations: 0,
        states: { reserved: 0, succeeded: 0, uncertain: 0 },
      },
    });
    expect(result.points[6]).toMatchObject({
      date: '2026-09-14',
      requestCount: 1,
      tokens: { value: 0, measuredRequests: 1 },
      embeddings: {
        operations: 2,
        searchOperations: 2,
      },
    });
  });

  it('returns every owned app and does not invent measurements for idle apps', async () => {
    const { service } = fixture([
      {
        appcode: 'SUPPORT',
        requestCount: 3,
        inputTokens: 10,
        inputMeasuredRequests: 3,
        outputTokens: 5,
        outputMeasuredRequests: 3,
        totalTokens: 15,
        tokenMeasuredRequests: 3,
        averageLatencyMs: 50,
        maximumLatencyMs: 70,
        latencyMeasuredRequests: 3,
        embeddingOperations: 4,
        embeddingIndexOperations: 3,
        embeddingSearchOperations: 1,
        embeddingReservedOperations: 0,
        embeddingSucceededOperations: 4,
        embeddingUncertainOperations: 0,
      },
    ]);

    const result = await service.breakdown(identity, 30);
    expect(result.apps).toHaveLength(2);
    expect(result.apps[0]).toMatchObject({
      appcode: 'SUPPORT',
      requestCount: 3,
      tokens: { total: { value: 15, measuredRequests: 3 } },
      embeddings: { operations: 4, indexOperations: 3, searchOperations: 1 },
    });
    expect(result.apps[1]).toMatchObject({
      appcode: 'SEARCH',
      requestCount: 0,
      tokens: { total: { value: null, measuredRequests: 0 } },
      embeddings: { operations: 0 },
    });
  });

  it('queries historical attribution even when the organization owns no current apps', async () => {
    const { service, findMany, queryRaw } = fixture([]);
    findMany.mockResolvedValueOnce([]);

    await expect(service.summary(identity, 30)).resolves.toMatchObject({
      appCount: 0,
      requestCount: 0,
      tokens: { total: { value: null, measuredRequests: 0 } },
    });
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it('uses the request and embedding ledgers as the aggregate sources', async () => {
    const { service, queryRaw } = fixture([]);

    await service.summary(identity, 30);

    const query = queryRaw.mock.calls[0][0] as { strings: string[] };
    const sql = query.strings.join(' ');
    expect(sql).toContain('bedrock_search_log');
    expect(sql).toContain('knowledge_query_log');
    expect(sql).toContain('family_conversation_metric');
    expect(sql).toContain('family_embedding_usage');
  });
});
