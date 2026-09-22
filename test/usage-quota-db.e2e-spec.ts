import { randomUUID } from 'node:crypto';
import { fork, ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  UsageQuotaService,
  UsageQuotaReservation,
} from '../src/usage-quota/usage-quota.service';
import { UsageQuotaRecoveryService } from '../src/usage-quota/usage-quota-recovery.service';
import { ReconcileUsageReservationDto } from '../src/usage-quota/usage-quota-recovery.dto';
import { UsageQuotaAdminController } from '../src/usage-quota/usage-quota-admin.controller';
import { BedrockController } from '../src/bedrock/bedrock.controller';
import { BedrockService } from '../src/bedrock/bedrock.service';
import { AppInfoService } from '../src/app-info/app-info.service';
import { AdminApiKeyGuard } from '../src/common/guards/admin-api-key.guard';
import { AppkeyGuard } from '../src/common/guards/appkey.guard';
import { ApiExposureGuard } from '../src/common/guards/api-exposure.guard';
import { SecurityAuditService } from '../src/security/security-audit.service';
import type { QuotaProcessCommand } from './fixtures/usage-quota-process';

const suite =
  process.env.RUN_USAGE_QUOTA_DB === 'true' ? describe : describe.skip;
type WorkerEvent = {
  type: string;
  id?: string;
  pid?: number;
  backendPid?: number;
  ok?: boolean;
  status?: number;
};
const actor = { credentialSlot: 'primary' as const };
type UsageScope =
  | { appcode: string; periodKey: string }
  | { organizationId: string; periodKey: string };

suite('Monthly quota integration (isolated PostgreSQL, no live AWS)', () => {
  let prisma: PrismaService;
  let second: PrismaService;
  let quota: UsageQuotaService;
  let otherQuota: UsageQuotaService;
  let recovery: UsageQuotaRecoveryService;
  const children: Array<{
    child: ChildProcess;
    exited: Promise<number | null>;
  }> = [];

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    expect(['localhost', '127.0.0.1', '[::1]']).toContain(url.hostname);
    expect(url.pathname).toMatch(/^\/queue_e2e_[a-f0-9]{32}$/);
    prisma = new PrismaService();
    second = new PrismaService();
    await Promise.all([prisma.$connect(), second.$connect()]);
    quota = new UsageQuotaService(prisma);
    otherQuota = new UsageQuotaService(second);
    recovery = new UsageQuotaRecoveryService(prisma);
  });
  afterEach(async () => {
    for (const { child, exited } of children.splice(0)) {
      if (child.exitCode === null && child.signalCode === null)
        child.kill('SIGKILL');
      await exited;
    }
    jest.restoreAllMocks();
  });
  afterAll(async () => {
    await Promise.all([prisma?.$disconnect(), second?.$disconnect()]);
  });

  async function fixture(
    options: {
      requests?: number | null;
      orgTokens?: number | null;
      appTokens?: number | null;
      apps?: number;
    } = {},
  ) {
    const org = await prisma.consoleOrganization.create({
      data: {
        worksOrganizationId: randomUUID(),
        displayName: 'Quota fixture',
        lastSyncedAt: new Date(),
        monthlyRequestLimit:
          options.requests === undefined ? 100 : options.requests,
        monthlyTokenLimit:
          options.orgTokens === undefined ? 1000 : options.orgTokens,
      },
    });
    const identity = await prisma.consoleIdentity.create({
      data: { worksUserId: randomUUID(), lastSyncedAt: new Date() },
    });
    const apps = await Promise.all(
      Array.from({ length: options.apps ?? 1 }, () =>
        prisma.appInfo.create({
          data: {
            appcode: `QUOTA_${randomUUID().replaceAll('-', '')}`,
            appname: 'Quota fixture',
            defaultModelId: 'test-model',
            monthlyTokenLimit:
              options.appTokens === undefined ? 1000 : options.appTokens,
            consoleOwnership: {
              create: {
                organizationId: org.id,
                createdByIdentityId: identity.id,
              },
            },
          },
        }),
      ),
    );
    return { org, apps, app: apps[0] };
  }
  async function begin(
    appcode: string,
    operationKey = randomUUID(),
    service = quota,
  ) {
    const result = await service.begin({
      appcode,
      operationKey,
      operationScope: 'integration',
    });
    expect(result).not.toBeNull();
    return result!;
  }
  function totals(scope: UsageScope) {
    return prisma.$transaction((tx) =>
      (
        quota as unknown as {
          measuredUsage(
            tx: Prisma.TransactionClient,
            scope: UsageScope,
          ): Promise<{
            requests: number;
            tokens: number;
            unmeasuredRequests: number;
          }>;
        }
      ).measuredUsage(tx, scope),
    );
  }
  function log(
    reservation: UsageQuotaReservation,
    tokens: number | undefined,
    at = new Date(),
  ) {
    return quota.recordUsage(
      reservation,
      (tx) =>
        tx.bedrockSearchLog.create({
          data: {
            appcode: reservation.appcode,
            searchword: '[TEST]',
            searchat: at,
            responsetime: 1,
            totaltokens: tokens,
          },
        }),
      'bedrock',
    );
  }
  async function command(
    id: string,
    overrides: Partial<ReconcileUsageReservationDto> = {},
  ): Promise<ReconcileUsageReservationDto> {
    const row = await prisma.consoleUsageReservation.update({
      where: { id },
      data: { updatedAt: new Date(Date.now() - 3600000) },
    });
    return {
      recoveryKey: randomUUID(),
      expectedUpdatedAt: row.updatedAt.toISOString(),
      action: 'CONFIRM_USAGE',
      actualTokens: 25,
      executorStopped: true,
      evidenceRef: 'DB-TEST',
      ...overrides,
    };
  }
  function worker() {
    const child = fork(join(__dirname, 'fixtures/usage-quota-process.ts'), [], {
      execArgv: ['-r', 'ts-node/register/transpile-only'],
      env: { ...process.env },
      stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    });
    const events: WorkerEvent[] = [];
    child.on('message', (event: WorkerEvent) => events.push(event));
    const exited = new Promise<number | null>((resolve, reject) => {
      child.once('exit', resolve);
      child.once('error', reject);
    });
    children.push({ child, exited });
    const wait = async (type: string) => {
      const end = Date.now() + 15000;
      while (Date.now() < end) {
        const event = events.find((item) => item.type === type);
        if (event) return event;
        if (child.exitCode !== null || child.signalCode !== null)
          throw new Error(`Quota worker exited before ${type}`);
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error(`Quota worker timed out waiting for ${type}`);
    };
    return { child, exited, wait };
  }
  async function race(commands: QuotaProcessCommand[]) {
    const workers = commands.map(() => worker());
    const ready = await Promise.all(workers.map((item) => item.wait('ready')));
    expect(new Set(ready.map((item) => item.pid)).size).toBe(commands.length);
    expect(new Set(ready.map((item) => item.backendPid)).size).toBe(
      commands.length,
    );
    workers.forEach((item, index) => item.child.send(commands[index]));
    const results = await Promise.all(
      workers.map((item) => item.wait('result')),
    );
    expect(await Promise.all(workers.map((item) => item.exited))).toEqual(
      commands.map(() => 0),
    );
    return results;
  }

  it('serializes independent processes across apps at one organization request boundary', async () => {
    const { org, apps } = await fixture({ requests: 2, apps: 2 });
    const results = await race(
      Array.from({ length: 6 }, (_, index) => ({
        appcode: apps[index % 2].appcode,
        operationKey: randomUUID(),
      })),
    );
    expect(results.filter((item) => item.ok)).toHaveLength(2);
    expect(results.filter((item) => item.status === 429)).toHaveLength(4);
    expect(
      await prisma.consoleUsageReservation.count({
        where: { organizationId: org.id },
      }),
    ).toBe(2);
    const other = await fixture({ requests: 1 });
    await expect(begin(other.app.appcode)).resolves.toBeTruthy();
  }, 40000);

  it.each(['app', 'organization'] as const)(
    'enforces the %s token boundary across independent processes',
    async (scope) => {
      const { apps, org } = await fixture(
        scope === 'app' ? { appTokens: 100 } : { orgTokens: 100, apps: 2 },
      );
      const results = await race(
        Array.from({ length: 4 }, (_, index) => ({
          appcode: apps[index % apps.length].appcode,
          operationKey: randomUUID(),
          tokens: 60,
        })),
      );
      expect(results.filter((item) => item.ok)).toHaveLength(1);
      expect(results.filter((item) => item.status === 429)).toHaveLength(3);
      const sum = await prisma.consoleUsageReservation.aggregate({
        where: { organizationId: org.id, state: 'RESERVED' },
        _sum: { reservedTokens: true },
      });
      expect(sum._sum.reservedTokens).toBe(60);
    },
    40000,
  );

  it('admits one duplicate operation across independent processes', async () => {
    const { app } = await fixture();
    const operationKey = randomUUID();
    const results = await race(
      Array.from({ length: 4 }, () => ({ appcode: app.appcode, operationKey })),
    );
    expect(results.filter((item) => item.ok)).toHaveLength(1);
    expect(results.filter((item) => item.status === 409)).toHaveLength(3);
    expect(
      await prisma.consoleUsageReservation.count({
        where: { appcode: app.appcode },
      }),
    ).toBe(1);
  }, 40000);

  it.each(['after-reserve', 'during-log', 'after-log'] as const)(
    'recovers after a real process is killed at %s',
    async (hold) => {
      const { app } = await fixture({ appTokens: 100 });
      const processWorker = worker();
      await processWorker.wait('ready');
      processWorker.child.send({
        appcode: app.appcode,
        operationKey: randomUUID(),
        tokens: 80,
        hold,
      });
      const held = await processWorker.wait('held');
      processWorker.child.kill('SIGKILL');
      await processWorker.exited;
      const id = held.id!;
      const row = await prisma.consoleUsageReservation.findUniqueOrThrow({
        where: { id },
      });
      expect(row).toMatchObject({
        state: 'RESERVED',
        reservedRequests: hold === 'after-log' ? 0 : 1,
        reservedTokens: hold === 'after-log' ? 0 : 80,
      });
      expect(
        await prisma.bedrockSearchLog.count({
          where: { appcode: app.appcode },
        }),
      ).toBe(hold === 'after-log' ? 1 : 0);
      const input = await command(
        id,
        hold === 'after-log'
          ? { action: 'SETTLE_LOG', actualTokens: undefined }
          : {},
      );
      const otherRecovery = new UsageQuotaRecoveryService(second);
      const results = await Promise.all([
        recovery.reconcile(id, input, actor),
        otherRecovery.reconcile(id, input, actor),
      ]);
      expect(results[0]).toEqual(results[1]);
      expect(
        await prisma.securityAuditEvent.count({
          where: {
            appcode: app.appcode,
            eventType: 'USAGE_QUOTA_RESERVATION_RECOVERED',
          },
        }),
      ).toBe(1);
      expect(
        await totals({ appcode: app.appcode, periodKey: row.periodKey }),
      ).toEqual({ requests: 1, tokens: 25, unmeasuredRequests: 0 });
      const next = await begin(app.appcode);
      await quota.reserveTokens(next, 75);
      const last = await begin(app.appcode);
      await expect(quota.reserveTokens(last, 1)).rejects.toMatchObject({
        status: 429,
      });
    },
    40000,
  );

  it('rolls back the request transfer when the real log INSERT fails', async () => {
    const { app } = await fixture();
    const reservation = await begin(app.appcode);
    await quota.reserveTokens(reservation, 80);
    await prisma.$executeRawUnsafe(
      `ALTER TABLE bedrock_search_log ADD CONSTRAINT quota_test_log_failure CHECK (appcode <> '${app.appcode}')`,
    );
    try {
      await expect(log(reservation, 25)).rejects.toThrow();
    } finally {
      await prisma.$executeRawUnsafe(
        'ALTER TABLE bedrock_search_log DROP CONSTRAINT quota_test_log_failure',
      );
    }
    expect(
      await prisma.consoleUsageReservation.findUnique({
        where: { id: reservation.id },
      }),
    ).toMatchObject({
      reservedRequests: 1,
      reservedTokens: 80,
      usageLogId: null,
    });
    expect(
      await prisma.bedrockSearchLog.count({ where: { appcode: app.appcode } }),
    ).toBe(0);
    await log(reservation, 25);
    await quota.settle(reservation, 25);
    expect(
      await totals({ appcode: app.appcode, periodKey: reservation.periodKey }),
    ).toEqual({ requests: 1, tokens: 25, unmeasuredRequests: 0 });
  });

  it('retains one measured event after a real settlement failure and recovers it', async () => {
    const { app } = await fixture();
    const reservation = await begin(app.appcode);
    await quota.reserveTokens(reservation, 80);
    await log(reservation, 25);
    await prisma.$executeRawUnsafe(
      `ALTER TABLE console_usage_reservation ADD CONSTRAINT quota_test_settle_failure CHECK (appcode <> '${app.appcode}' OR state <> 'SETTLED')`,
    );
    try {
      await expect(quota.settle(reservation, 25)).rejects.toThrow();
    } finally {
      await prisma.$executeRawUnsafe(
        'ALTER TABLE console_usage_reservation DROP CONSTRAINT quota_test_settle_failure',
      );
    }
    expect(
      await totals({ appcode: app.appcode, periodKey: reservation.periodKey }),
    ).toEqual({ requests: 1, tokens: 25, unmeasuredRequests: 0 });
    await recovery.reconcile(
      reservation.id,
      await command(reservation.id, {
        action: 'SETTLE_LOG',
        actualTokens: undefined,
      }),
      actor,
    );
    await expect(otherQuota.settle(reservation, 99)).rejects.toMatchObject({
      status: 409,
    });
  });

  it('rolls back recovery if its real audit INSERT fails, then commits one retry', async () => {
    const { app } = await fixture();
    const reservation = await begin(app.appcode);
    await quota.markUncertain(reservation);
    const input = await command(reservation.id);
    await prisma.$executeRawUnsafe(
      `ALTER TABLE security_audit_event ADD CONSTRAINT quota_test_audit_failure CHECK (appcode <> '${app.appcode}')`,
    );
    try {
      await expect(
        recovery.reconcile(reservation.id, input, actor),
      ).rejects.toThrow();
    } finally {
      await prisma.$executeRawUnsafe(
        'ALTER TABLE security_audit_event DROP CONSTRAINT quota_test_audit_failure',
      );
    }
    expect(
      await prisma.consoleUsageReservation.findUnique({
        where: { id: reservation.id },
      }),
    ).toMatchObject({
      state: 'UNCERTAIN',
      recoveryKey: null,
      recoveryTokens: 0,
    });
    await recovery.reconcile(reservation.id, input, actor);
    // Simulate a lost application response by retrying from another connection.
    await new UsageQuotaRecoveryService(second).reconcile(
      reservation.id,
      input,
      actor,
    );
    expect(
      await prisma.securityAuditEvent.count({
        where: {
          appcode: app.appcode,
          eventType: 'USAGE_QUOTA_RESERVATION_RECOVERED',
        },
      }),
    ).toBe(1);
  });

  it('keeps UTC admission month and organization when a linked log completes later and ownership changes', async () => {
    const { app, org } = await fixture();
    const newOwner = await fixture();
    jest
      .spyOn(quota as unknown as { periodKey(): string }, 'periodKey')
      .mockReturnValue('2026-09');
    const reservation = await begin(app.appcode);
    await quota.reserveTokens(reservation, 80);
    await log(reservation, 25, new Date('2026-10-01T00:00:01Z'));
    await prisma.consoleAppOwnership.update({
      where: { appInfoId: app.id },
      data: { organizationId: newOwner.org.id },
    });
    expect(
      await totals({ organizationId: org.id, periodKey: '2026-09' }),
    ).toEqual({ requests: 1, tokens: 25, unmeasuredRequests: 0 });
    expect(
      await totals({ organizationId: newOwner.org.id, periodKey: '2026-10' }),
    ).toEqual({ requests: 0, tokens: 0, unmeasuredRequests: 0 });
    await recovery.reconcile(
      reservation.id,
      await command(reservation.id, {
        action: 'SETTLE_LOG',
        actualTokens: undefined,
      }),
      actor,
    );
    expect(
      await totals({ appcode: app.appcode, periodKey: '2026-09' }),
    ).toMatchObject({ requests: 1, tokens: 25 });
  });

  it('combines all log sources and recovered missing tokens without duplicating requests', async () => {
    const { app } = await fixture();
    const bedrock = await begin(app.appcode);
    await quota.reserveTokens(bedrock, 50);
    await log(bedrock, 10);
    await quota.settle(bedrock, 10);
    const knowledge = await begin(app.appcode);
    await quota.reserveTokens(knowledge, 50);
    await quota.recordUsage(
      knowledge,
      (tx) =>
        tx.knowledgeQueryLog.create({
          data: { appcode: app.appcode, question: '[TEST]', totaltokens: 20 },
        }),
      'knowledge',
    );
    await quota.settle(knowledge, 20);
    const conversation = await begin(app.appcode);
    await quota.reserveTokens(conversation, 50);
    await quota.recordUsage(
      conversation,
      (tx) =>
        tx.familyConversationMetric.create({
          data: {
            appcode: app.appcode,
            requestId: randomUUID(),
            policyVersion: 'test',
            status: 'SUCCEEDED',
            latencyMs: 1,
            totalTokens: 30,
            resultCount: 0,
          },
        }),
      'conversation',
    );
    await quota.settle(conversation, 30);
    const unknown = await begin(app.appcode);
    await quota.reserveTokens(unknown, 50);
    await log(unknown, undefined);
    await quota.markUncertain(unknown);
    expect(
      await totals({ appcode: app.appcode, periodKey: bedrock.periodKey }),
    ).toEqual({ requests: 4, tokens: 60, unmeasuredRequests: 0 });
    await recovery.reconcile(
      unknown.id,
      await command(unknown.id, { action: 'SETTLE_LOG', actualTokens: 40 }),
      actor,
    );
    expect(
      await totals({ appcode: app.appcode, periodKey: bedrock.periodKey }),
    ).toEqual({ requests: 4, tokens: 100, unmeasuredRequests: 0 });
  });

  it('fails closed for legacy unmeasured logs and enforces zero/unlimited policies in the DB', async () => {
    const { app } = await fixture();
    await prisma.bedrockSearchLog.create({
      data: { appcode: app.appcode, searchword: '[TEST]', responsetime: 1 },
    });
    const reservation = await begin(app.appcode);
    await expect(quota.reserveTokens(reservation, 1)).rejects.toThrow(
      'USAGE_QUOTA_USAGE_UNMEASURED',
    );
    const zero = await fixture({ requests: 0 });
    await expect(begin(zero.app.appcode)).rejects.toMatchObject({
      status: 429,
    });
    const unlimited = await fixture({
      requests: null,
      orgTokens: null,
      appTokens: null,
    });
    await expect(
      quota.begin({
        appcode: unlimited.app.appcode,
        operationKey: randomUUID(),
      }),
    ).resolves.toBeNull();
    expect(
      await prisma.consoleUsageReservation.count({
        where: { appcode: unlimited.app.appcode },
      }),
    ).toBe(0);
  });

  it('enforces unique log references and recovery keys across real connections', async () => {
    const { app } = await fixture();
    const a = await begin(app.appcode);
    const b = await begin(app.appcode);
    const existing = await prisma.bedrockSearchLog.create({
      data: {
        appcode: app.appcode,
        searchword: '[TEST]',
        responsetime: 1,
        totaltokens: 10,
      },
    });
    const inputs = await Promise.all([
      command(a.id, {
        action: 'SETTLE_LOG',
        logSource: 'bedrock',
        logId: existing.id,
        actualTokens: undefined,
      }),
      command(b.id, {
        action: 'SETTLE_LOG',
        logSource: 'bedrock',
        logId: existing.id,
        actualTokens: undefined,
      }),
    ]);
    const results = await Promise.allSettled([
      recovery.reconcile(a.id, inputs[0], actor),
      new UsageQuotaRecoveryService(second).reconcile(b.id, inputs[1], actor),
    ]);
    expect(results.filter((item) => item.status === 'fulfilled')).toHaveLength(
      1,
    );
    expect(results.filter((item) => item.status === 'rejected')).toHaveLength(
      1,
    );
    const c = await begin(app.appcode);
    const d = await begin(app.appcode);
    const key = randomUUID();
    const first = await command(c.id, { recoveryKey: key });
    const duplicate = await command(d.id, { recoveryKey: key });
    await recovery.reconcile(c.id, first, actor);
    await expect(
      new UsageQuotaRecoveryService(second).reconcile(d.id, duplicate, actor),
    ).rejects.toThrow('USAGE_QUOTA_RECOVERY_REFERENCE_ALREADY_USED');
    expect(
      await prisma.consoleUsageReservation.findUnique({ where: { id: d.id } }),
    ).toMatchObject({ state: 'RESERVED', recoveryKey: null });
  });

  it('rehearses the policy migration backfill on linked measured and unmeasured historical rows', async () => {
    const { app } = await fixture();
    const known = await begin(app.appcode);
    const unknown = await begin(app.appcode);
    await log(known, 25);
    await log(unknown, undefined);
    await prisma.consoleUsageReservation.updateMany({
      where: { id: { in: [known.id, unknown.id] } },
      data: { reservedTokens: 80, actualTokens: null, tokensReservedAt: null },
    });
    const migration = readFileSync(
      join(
        process.cwd(),
        'prisma/migrations/20260918110000_add_usage_reservation_policy/migration.sql',
      ),
      'utf8',
    );
    const backfill = migration.slice(
      migration.indexOf('UPDATE "console_usage_reservation"'),
    );
    for (const statement of backfill.split(';').filter((value) => value.trim()))
      await prisma.$executeRawUnsafe(statement);
    expect(
      await prisma.consoleUsageReservation.findUnique({
        where: { id: known.id },
      }),
    ).toMatchObject({
      reservedTokens: 0,
      actualTokens: 25,
      operationScope: 'integration',
      tokensReservedAt: expect.any(Date) as unknown,
    });
    expect(
      await prisma.consoleUsageReservation.findUnique({
        where: { id: unknown.id },
      }),
    ).toMatchObject({
      reservedTokens: 80,
      actualTokens: null,
      tokensReservedAt: expect.any(Date) as unknown,
    });
  });

  it('runs Bedrock and recovery HTTP contracts with real quota persistence and a deterministic provider', async () => {
    const { app: appInfo } = await fixture({
      requests: 2,
      appTokens: 10000,
      orgTokens: 10000,
    });
    const config = new ConfigService({
      AWS_REGION: 'us-east-1',
      BEDROCK_MODEL_ID: 'fixture-model',
      ADMIN_API_KEY: 'fixture-admin',
    });
    const module = await Test.createTestingModule({
      controllers: [BedrockController, UsageQuotaAdminController],
      providers: [
        BedrockService,
        UsageQuotaService,
        UsageQuotaRecoveryService,
        AppkeyGuard,
        AdminApiKeyGuard,
        ApiExposureGuard,
        { provide: ConfigService, useValue: config },
        { provide: PrismaService, useValue: prisma },
        {
          provide: SecurityAuditService,
          useValue: new SecurityAuditService(prisma),
        },
        {
          provide: AppInfoService,
          useValue: {
            validateAppKey: (key: string) =>
              key === 'fixture-key'
                ? Promise.resolve(appInfo)
                : Promise.resolve(null),
          },
        },
      ],
    }).compile();
    const send = jest.fn().mockResolvedValue({
      output: { message: { content: [{ text: 'test answer' }] } },
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    });
    Object.defineProperty(module.get(BedrockService), 'client', {
      value: { send },
    });
    const http = module.createNestApplication({ logger: false });
    http.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await http.init();
    try {
      const server = http.getHttpServer() as Server;
      await request(server)
        .post('/bedrock/converse')
        .set('appkey', 'fixture-key')
        .send({ message: 'test' })
        .expect(200);
      send.mockRejectedValueOnce(new Error('synthetic provider failure'));
      await request(server)
        .post('/bedrock/text-response')
        .set('appkey', 'fixture-key')
        .send({ message: 'test' })
        .expect(500);
      await request(server)
        .post('/bedrock/general-answers')
        .set('appkey', 'fixture-key')
        .send({ query: 'test' })
        .expect(429);
      expect(send).toHaveBeenCalledTimes(2);
      const pending = await prisma.consoleUsageReservation.findFirstOrThrow({
        where: { appcode: appInfo.appcode, state: 'UNCERTAIN' },
      });
      expect(pending).toMatchObject({
        reservedRequests: 0,
        usageLogSource: 'bedrock',
      });
      expect(
        await prisma.bedrockSearchLog.findUnique({
          where: { id: pending.usageLogId! },
        }),
      ).toMatchObject({
        status: 'failed',
        endpoint: '/bedrock/text-response',
        errorCode: 'REQUEST_FAILED',
        requestId: expect.any(String) as string,
      });
      const input = await command(pending.id, { action: 'SETTLE_LOG' });
      const route = `/admin/v1/usage-quota/reservations/${pending.id}/reconcile`;
      await request(server).post(route).send(input).expect(401);
      await request(server)
        .post(route)
        .set('x-admin-key', 'fixture-admin')
        .send(input)
        .expect(200);
      await request(server)
        .post(route)
        .set('x-admin-key', 'fixture-admin')
        .send(input)
        .expect(200);
      expect(
        await totals({
          appcode: appInfo.appcode,
          periodKey: pending.periodKey,
        }),
      ).toEqual({ requests: 2, tokens: 40, unmeasuredRequests: 0 });
    } finally {
      await http.close();
    }
  }, 20000);
});
