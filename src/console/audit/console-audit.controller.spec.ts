import type { Server } from 'node:http';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { ConsoleIdentityContext } from '../security/console-identity-context';
import { CONSOLE_IDENTITY_CONTEXT_RESOLVER } from '../security/console-identity-context.resolver';
import { ConsoleSecurityModule } from '../security/console-security.module';
import { ConsoleAuditController } from './console-audit.controller';
import { ConsoleAuditService } from './console-audit.service';

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
  permissions: ['audit:read'],
});

describe('Console audit HTTP contract', () => {
  let app: INestApplication;
  let identity = identityFixture();
  const list = jest.fn().mockResolvedValue({ items: [], nextCursor: null });

  beforeEach(async () => {
    identity = identityFixture();
    list.mockClear();
    const module = await Test.createTestingModule({
      imports: [ConsoleSecurityModule],
      controllers: [ConsoleAuditController],
      providers: [{ provide: ConsoleAuditService, useValue: { list } }],
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

  it('validates filters and forwards the authenticated organization identity', async () => {
    await request(app.getHttpServer() as Server)
      .get(
        '/console-api/v1/audit-events?days=7&eventType=CONSOLE_APP_UPDATED&limit=20',
      )
      .expect(200);
    expect(list).toHaveBeenCalledWith(
      identity,
      expect.objectContaining({
        days: 7,
        eventType: 'CONSOLE_APP_UPDATED',
        limit: 20,
      }),
    );
  });

  it('requires audit:read and rejects unsupported filters', async () => {
    identity = { ...identity, permissions: [] };
    await request(app.getHttpServer() as Server)
      .get('/console-api/v1/audit-events')
      .expect(403);
    identity = identityFixture();
    await request(app.getHttpServer() as Server)
      .get('/console-api/v1/audit-events?days=14')
      .expect(400);
    expect(list).not.toHaveBeenCalled();
  });
});
