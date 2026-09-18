import type { Server } from 'node:http';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { ConsoleIdentityContext } from '../security/console-identity-context';
import { CONSOLE_IDENTITY_CONTEXT_RESOLVER } from '../security/console-identity-context.resolver';
import { ConsoleSecurityModule } from '../security/console-security.module';
import { ConsoleRequestLogsController } from './console-request-logs.controller';
import { ConsoleRequestLogsService } from './console-request-logs.service';

const identityFixture = (): ConsoleIdentityContext => ({
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
});

describe('Console request logs HTTP contract', () => {
  let app: INestApplication;
  let identity = identityFixture();
  const list = jest.fn().mockResolvedValue({ items: [], nextCursor: null });
  const findOne = jest.fn().mockResolvedValue({ id: 'knowledge:log' });
  const exportCsv = jest.fn().mockResolvedValue({
    csv: '\uFEFFoccurredAt,status\r\n',
    rowCount: 0,
    truncated: false,
  });

  beforeEach(async () => {
    identity = identityFixture();
    list.mockClear();
    findOne.mockClear();
    exportCsv.mockClear();
    const module = await Test.createTestingModule({
      imports: [ConsoleSecurityModule],
      controllers: [ConsoleRequestLogsController],
      providers: [
        {
          provide: ConsoleRequestLogsService,
          useValue: { list, findOne, exportCsv },
        },
      ],
    })
      .overrideProvider(CONSOLE_IDENTITY_CONTEXT_RESOLVER)
      .useValue({ resolve: () => Promise.resolve(identity) })
      .compile();
    app = module.createNestApplication({ logger: false });
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true }),
    );
    await app.init();
  });

  afterEach(async () => app.close());

  it('validates filters and forwards the selected identity', async () => {
    await request(app.getHttpServer() as Server)
      .get(
        '/console-api/v1/request-logs?days=7&status=failed&requestId=req-1&limit=20',
      )
      .expect(200);
    expect(list).toHaveBeenCalledWith(
      identity,
      expect.objectContaining({
        days: 7,
        status: 'failed',
        requestId: 'req-1',
        limit: 20,
      }),
    );
  });

  it('provides metadata detail by stable log id', async () => {
    const logId = 'knowledge:11111111-1111-4111-8111-111111111111';
    await request(app.getHttpServer() as Server)
      .get(`/console-api/v1/request-logs/${logId}`)
      .expect(200);
    expect(findOne).toHaveBeenCalledWith(logId, identity);
  });

  it('downloads a bounded metadata-only CSV', async () => {
    const response = await request(app.getHttpServer() as Server)
      .get('/console-api/v1/request-logs/export.csv?days=7&status=failed')
      .expect(200)
      .expect('content-type', /text\/csv/)
      .expect('x-export-row-count', '0')
      .expect('x-export-truncated', 'false');
    expect(response.headers['content-disposition']).toContain('attachment');
    expect(exportCsv).toHaveBeenCalledWith(
      identity,
      expect.objectContaining({ days: 7, status: 'failed' }),
    );
    expect(findOne).not.toHaveBeenCalled();
  });

  it('rejects unsupported filters before querying logs', async () => {
    await request(app.getHttpServer() as Server)
      .get('/console-api/v1/request-logs?days=14&status=unknown')
      .expect(400);
    expect(list).not.toHaveBeenCalled();
  });

  it('requires logs:read permission', async () => {
    identity = { ...identity, permissions: [] };
    await request(app.getHttpServer() as Server)
      .get('/console-api/v1/request-logs')
      .expect(403);
    expect(list).not.toHaveBeenCalled();
  });
});
