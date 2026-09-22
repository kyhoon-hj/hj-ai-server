import type { Server } from 'node:http';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { ConsoleIdentityContext } from '../security/console-identity-context';
import { CONSOLE_IDENTITY_CONTEXT_RESOLVER } from '../security/console-identity-context.resolver';
import { ConsoleSecurityModule } from '../security/console-security.module';
import { ConsoleUsageController } from './console-usage.controller';
import { ConsoleUsageService } from './console-usage.service';

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
  permissions: ['usage:read'],
});

describe('Console usage HTTP contract', () => {
  let app: INestApplication;
  let identity = identityFixture();
  const monthly = jest.fn().mockResolvedValue({ period: { timezone: 'UTC' } });
  const summary = jest.fn().mockResolvedValue({ requestCount: 0 });
  const timeseries = jest.fn().mockResolvedValue({ points: [] });
  const breakdown = jest.fn().mockResolvedValue({ apps: [] });

  beforeEach(async () => {
    identity = identityFixture();
    summary.mockClear();
    monthly.mockClear();
    timeseries.mockClear();
    breakdown.mockClear();
    const module = await Test.createTestingModule({
      imports: [ConsoleSecurityModule],
      controllers: [ConsoleUsageController],
      providers: [
        {
          provide: ConsoleUsageService,
          useValue: { summary, timeseries, breakdown, monthly },
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

  it('provides summary, timeseries and breakdown for the selected range', async () => {
    await request(app.getHttpServer() as Server)
      .get('/console-api/v1/usage/summary?days=30')
      .expect(200);
    await request(app.getHttpServer() as Server)
      .get('/console-api/v1/usage/timeseries?days=7')
      .expect(200);
    await request(app.getHttpServer() as Server)
      .get('/console-api/v1/usage/breakdown?days=90')
      .expect(200);

    expect(summary).toHaveBeenCalledWith(
      identity,
      30,
      expect.objectContaining({ days: 30 }),
    );
    expect(timeseries).toHaveBeenCalledWith(
      identity,
      7,
      expect.objectContaining({ days: 7 }),
    );
    expect(breakdown).toHaveBeenCalledWith(
      identity,
      90,
      expect.objectContaining({ days: 90 }),
    );
  });

  it('rejects unsupported ranges before querying usage', async () => {
    await request(app.getHttpServer() as Server)
      .get('/console-api/v1/usage/summary?days=14')
      .expect(400);
    expect(summary).not.toHaveBeenCalled();
  });

  it('validates dimensions and protects the monthly endpoint', async () => {
    await request(app.getHttpServer() as Server)
      .get('/console-api/v1/usage/monthly')
      .expect(200);
    expect(monthly).toHaveBeenCalledWith(identity);
    await request(app.getHttpServer() as Server)
      .get('/console-api/v1/usage/summary?endpoint=invalid')
      .expect(400);
    await request(app.getHttpServer() as Server)
      .get(
        '/console-api/v1/usage/summary?endpoint=%2Fconversation%2Fv1%2Fturns&status=unknown',
      )
      .expect(200);
    expect(summary).toHaveBeenCalledWith(
      identity,
      30,
      expect.objectContaining({
        endpoint: '/conversation/v1/turns',
        status: 'unknown',
      }),
    );
    identity = { ...identity, permissions: [] };
    await request(app.getHttpServer() as Server)
      .get('/console-api/v1/usage/monthly')
      .expect(403);
  });

  it('requires usage:read permission', async () => {
    identity = { ...identity, permissions: [] };
    await request(app.getHttpServer() as Server)
      .get('/console-api/v1/usage/summary?days=30')
      .expect(403);
    expect(summary).not.toHaveBeenCalled();
  });
});
