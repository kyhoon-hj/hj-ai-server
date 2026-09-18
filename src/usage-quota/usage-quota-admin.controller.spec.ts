import type { Server } from 'node:http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { UsageQuotaAdminController } from './usage-quota-admin.controller';
import { UsageQuotaRecoveryService } from './usage-quota-recovery.service';
import { AdminApiKeyGuard } from '../common/guards/admin-api-key.guard';
import { SecurityAuditService } from '../security/security-audit.service';

const id = '11111111-1111-4111-8111-111111111111';
const base = '/admin/v1/usage-quota/reservations';
const body = {
  recoveryKey: '22222222-2222-4222-8222-222222222222',
  expectedUpdatedAt: '2026-09-18T01:00:00.000Z',
  executorStopped: true,
  evidenceRef: 'INC-123',
  action: 'CONFIRM_USAGE',
  actualTokens: 25,
};

describe('Quota recovery admin HTTP contract', () => {
  let app: INestApplication;
  const recovery = {
    list: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
    get: jest.fn().mockResolvedValue({ id }),
    reconcile: jest.fn().mockResolvedValue({ id, state: 'SETTLED' }),
  };
  beforeEach(async () => {
    Object.values(recovery).forEach((mock) => mock.mockClear());
    const module = await Test.createTestingModule({
      controllers: [UsageQuotaAdminController],
      providers: [
        AdminApiKeyGuard,
        { provide: UsageQuotaRecoveryService, useValue: recovery },
        {
          provide: SecurityAuditService,
          useValue: { record: jest.fn().mockResolvedValue(true) },
        },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              ({
                ADMIN_API_KEY: 'platform-secret',
                KNOWLEDGE_OPERATOR_API_KEY: 'operator-secret',
              })[key],
          },
        },
      ],
    }).compile();
    app = module.createNestApplication({ logger: false });
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
  });
  afterEach(async () => app.close());

  it.each(['', 'invalid', 'operator-secret'])(
    'rejects unauthorized access with credential %s',
    async (key) => {
      const server = app.getHttpServer() as Server;
      const status = key === 'operator-secret' ? 403 : 401;
      await request(server).get(base).set('x-admin-key', key).expect(status);
      await request(server)
        .get(`${base}/${id}`)
        .set('x-admin-key', key)
        .expect(status);
      await request(server)
        .post(`${base}/${id}/reconcile`)
        .set('x-admin-key', key)
        .send(body)
        .expect(status);
      expect(recovery.reconcile).not.toHaveBeenCalled();
      expect(recovery.list).not.toHaveBeenCalled();
      expect(recovery.get).not.toHaveBeenCalled();
    },
  );

  it('allows platform access and passes the authenticated credential slot', async () => {
    const server = app.getHttpServer() as Server;
    await request(server)
      .get(base)
      .query({ limit: 2, appcode: 'APP' })
      .set('x-admin-key', 'platform-secret')
      .expect(200);
    expect(recovery.list).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 2, appcode: 'APP' }),
    );
    await request(server)
      .get(`${base}/${id}`)
      .set('x-admin-key', 'platform-secret')
      .expect(200);
    await request(server)
      .post(`${base}/${id}/reconcile`)
      .set('x-admin-key', 'platform-secret')
      .send(body)
      .expect(200);
    expect(recovery.reconcile).toHaveBeenCalledWith(
      id,
      body,
      expect.objectContaining({ credentialSlot: 'primary' }),
    );
  });

  it.each([
    { executorStopped: false },
    { executorStopped: 'true' },
    { actualTokens: -1 },
    { actualTokens: 0.5 },
    { actualTokens: 2147483648 },
    { expectedUpdatedAt: 'invalid' },
    { recoveryKey: 'invalid' },
    { action: 'UNKNOWN' },
    { evidenceRef: '' },
    { extra: 'not allowed' },
  ])('rejects invalid recovery input %j', async (change) => {
    await request(app.getHttpServer() as Server)
      .post(`${base}/${id}/reconcile`)
      .set('x-admin-key', 'platform-secret')
      .send({ ...body, ...change })
      .expect(400);
    expect(recovery.reconcile).not.toHaveBeenCalled();
  });

  it.each([
    { limit: 201 },
    { limit: 0 },
    { periodKey: '2026-13' },
    { state: 'UNKNOWN' },
    { after: 'invalid' },
  ])('rejects invalid list query %j', async (query) => {
    await request(app.getHttpServer() as Server)
      .get(base)
      .query(query)
      .set('x-admin-key', 'platform-secret')
      .expect(400);
    expect(recovery.list).not.toHaveBeenCalled();
  });
});
