import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { ConsoleIdentityContext } from '../security/console-identity-context';
import { ConsoleRequestLogsService } from './console-request-logs.service';

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
  permissions: ['logs:read'],
};

const app = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  appname: 'Console app',
  appcode: 'CONSOLE_APP',
};

const row = (id: string, overrides = {}) => ({
  logId: `knowledge:${id}`,
  source: 'knowledge',
  appcode: app.appcode,
  occurredAt: new Date('2026-09-14T01:00:00.000Z'),
  requestId: 'request-1',
  endpoint: '/knowledge/answers',
  status: 'success',
  result: 'answered',
  failureStage: null,
  errorCode: null,
  modelId: 'model-1',
  embeddingModel: 'embed-1',
  responseTimeMs: 120,
  inputTokens: 10,
  outputTokens: 20,
  totalTokens: 30,
  matchedChunkCount: 2,
  contentStored: true,
  execution: {
    schemaVersion: 1,
    promptVersion: 'v1',
    retrievedSources: [{ content: 'secret' }],
  },
  ...overrides,
});

describe('ConsoleRequestLogsService', () => {
  const findMany = jest.fn();
  const queryRaw = jest.fn();
  const prisma = {
    consoleAppOwnership: { findMany },
    $queryRaw: queryRaw,
  };
  const service = new ConsoleRequestLogsService(prisma as never);

  beforeEach(() => {
    findMany.mockReset().mockResolvedValue([{ appInfo: app }]);
    queryRaw.mockReset();
  });

  it('returns metadata-only list items with an opaque next cursor', async () => {
    queryRaw.mockResolvedValue([
      row('11111111-1111-4111-8111-111111111111'),
      row('22222222-2222-4222-8222-222222222222'),
    ]);
    const result = await service.list(identity, { days: 30, limit: 1 });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: identity.organizationId },
      }),
    );
    expect(result.items).toHaveLength(1);
    expect(result.nextCursor).toEqual(expect.any(String));
    expect(JSON.stringify(result.items)).not.toContain('secret');
    expect(result.items[0]).not.toHaveProperty('execution');
  });

  it('rejects a foreign app filter without querying logs', async () => {
    findMany.mockResolvedValue([]);
    await expect(
      service.list(identity, { days: 30, limit: 25, appId: app.id }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('rejects malformed cursors', async () => {
    await expect(
      service.list(identity, { days: 30, limit: 25, cursor: 'bad-cursor' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('returns allowlisted execution metadata and never request content', async () => {
    queryRaw.mockResolvedValue([row('11111111-1111-4111-8111-111111111111')]);
    const result = await service.findOne(
      'knowledge:11111111-1111-4111-8111-111111111111',
      identity,
    );

    expect(result.content).toEqual({
      stored: true,
      exposed: false,
      reason: 'operational-metadata-only',
    });
    expect(result.execution).toEqual({ schemaVersion: 1, promptVersion: 'v1' });
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('returns 404 for malformed and missing log identifiers', async () => {
    await expect(service.findOne('invalid', identity)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    queryRaw.mockResolvedValue([]);
    await expect(
      service.findOne('bedrock:11111111-1111-4111-8111-111111111111', identity),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('exports metadata-only CSV and neutralizes spreadsheet formulas', async () => {
    queryRaw.mockResolvedValue([
      row('11111111-1111-4111-8111-111111111111', {
        requestId: '=HYPERLINK("https://invalid")',
        status: 'failed',
        errorCode: 'UPSTREAM_TIMEOUT',
      }),
    ]);
    const result = await service.exportCsv(identity, { days: 30 });

    expect(result).toMatchObject({ rowCount: 1, truncated: false });
    expect(result.csv).toContain('errorCode');
    expect(result.csv).toContain('UPSTREAM_TIMEOUT');
    expect(result.csv).toContain("'=HYPERLINK");
    expect(result.csv).not.toContain('secret');
  });
});
