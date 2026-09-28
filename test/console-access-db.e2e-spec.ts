import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Server } from 'node:http';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  CONSOLE_IDENTITY_CONTEXT_RESOLVER,
  type ConsoleIdentityContextResolver,
} from '../src/console/security/console-identity-context.resolver';
import type {
  ConsoleIdentityContext,
  ConsolePermission,
  ConsoleRequest,
} from '../src/console/security/console-identity-context';
import { DEVELOPMENT_CONSOLE_IDENTITY } from '../src/console/security/console-development-fixture';
import { validateEnvironment } from '../src/config/environment';

const suite =
  process.env.RUN_CONSOLE_ACCESS_DB === 'true' ? describe : describe.skip;

type IdentityName =
  | 'admin-a'
  | 'developer-a'
  | 'knowledge-a'
  | 'viewer-a'
  | 'admin-b'
  | 'disabled-user'
  | 'disabled-organization'
  | 'removed-membership';

const ADMIN_PERMISSIONS: ConsolePermission[] = [
  'apps:read',
  'apps:write',
  'credentials:read',
  'credentials:rotate',
  'credentials:revoke',
  'usage:read',
  'logs:read',
  'knowledge:read',
  'knowledge:write',
  'members:read',
  'members:manage',
  'billing:read',
  'billing:manage',
  'audit:read',
];

suite('Console M3 organization and permission HTTP contracts', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Server;
  const identities = new Map<IdentityName, ConsoleIdentityContext>();
  let appA: { id: string; appcode: string };
  let appB: { id: string; appcode: string };
  let logBId: string;

  const resolver: ConsoleIdentityContextResolver = {
    resolve(request: ConsoleRequest) {
      const headers = (
        request as ConsoleRequest & {
          headers?: Record<string, string | string[] | undefined>;
        }
      ).headers;
      const name = headers?.['x-test-console-identity'];
      return Promise.resolve(
        typeof name === 'string'
          ? (identities.get(name as IdentityName) ?? null)
          : null,
      );
    },
  };

  function as(name: IdentityName) {
    return { 'x-test-console-identity': name };
  }

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    expect(['localhost', '127.0.0.1', '[::1]']).toContain(url.hostname);
    expect(url.pathname).toMatch(/^\/queue_e2e_[a-f0-9]{32}$/);

    expect(process.env.NODE_ENV).toBe('production');
    expect(process.env.ENABLE_CONSOLE_DEV_IDENTITY).toBe('false');
    expect(() =>
      validateEnvironment({
        ...process.env,
        NODE_ENV: 'production',
        ENABLE_CONSOLE_DEV_IDENTITY: 'true',
      }),
    ).toThrow(
      'ENABLE_CONSOLE_DEV_IDENTITY may only be true when NODE_ENV is development',
    );
    const productionModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const productionApp = productionModule.createNestApplication({
      logger: false,
    });
    await productionApp.init();
    const productionPrisma = productionApp.get(PrismaService);
    await request(productionApp.getHttpServer() as Server)
      .get('/console-api/v1/apps')
      .expect(401);
    expect(
      await productionPrisma.consoleIdentity.count({
        where: { id: DEVELOPMENT_CONSOLE_IDENTITY.identityId },
      }),
    ).toBe(0);
    expect(
      await productionPrisma.consoleOrganization.count({
        where: { id: DEVELOPMENT_CONSOLE_IDENTITY.organizationId },
      }),
    ).toBe(0);
    await productionApp.close();

    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CONSOLE_IDENTITY_CONTEXT_RESOLVER)
      .useValue(resolver)
      .compile();
    app = module.createNestApplication({ logger: false });
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
    server = app.getHttpServer() as Server;
    prisma = app.get(PrismaService);

    const now = new Date();
    const organizationA = await prisma.consoleOrganization.create({
      data: {
        worksOrganizationId: randomUUID(),
        displayName: 'M3 Organization A',
        lastSyncedAt: now,
        monthlyRequestLimit: 100,
        monthlyTokenLimit: 10_000,
      },
    });
    const organizationB = await prisma.consoleOrganization.create({
      data: {
        worksOrganizationId: randomUUID(),
        displayName: 'M3 Organization B',
        lastSyncedAt: now,
        monthlyRequestLimit: 100,
        monthlyTokenLimit: 10_000,
      },
    });

    const createIdentity = async (
      name: IdentityName,
      organization: typeof organizationA,
      permissions: ConsolePermission[],
      worksRole: 'ADMIN' | 'MEMBER',
    ) => {
      const actor = await prisma.consoleIdentity.create({
        data: {
          worksUserId: randomUUID(),
          displayName: name,
          lastSyncedAt: now,
        },
      });
      const membership = await prisma.consoleMembership.create({
        data: {
          organizationId: organization.id,
          identityId: actor.id,
          worksRole,
          permissions,
          lastSyncedAt: now,
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
        membershipId: membership.id,
        membershipStatus: 'ACTIVE',
        permissions,
      };
      identities.set(name, identity);
      return identity;
    };

    const adminA = await createIdentity(
      'admin-a',
      organizationA,
      ADMIN_PERMISSIONS,
      'ADMIN',
    );
    await createIdentity(
      'developer-a',
      organizationA,
      [
        'apps:read',
        'credentials:read',
        'credentials:rotate',
        'credentials:revoke',
        'usage:read',
        'logs:read',
      ],
      'MEMBER',
    );
    await createIdentity(
      'knowledge-a',
      organizationA,
      ['apps:read', 'knowledge:read', 'knowledge:write'],
      'MEMBER',
    );
    await createIdentity(
      'viewer-a',
      organizationA,
      ['apps:read', 'usage:read'],
      'MEMBER',
    );
    await createIdentity('admin-b', organizationB, ADMIN_PERMISSIONS, 'ADMIN');
    identities.set('disabled-user', {
      ...adminA,
      identityStatus: 'DISABLED',
    });
    identities.set('disabled-organization', {
      ...adminA,
      organizationStatus: 'DISABLED',
    });
    identities.set('removed-membership', {
      ...adminA,
      membershipStatus: 'REMOVED',
    });
    const periodKey = now.toISOString().slice(0, 7);
    await prisma.consoleUsageThresholdEvent.createMany({
      data: [
        {
          organizationId: organizationA.id,
          periodKey,
          metric: 'REQUESTS',
          thresholdPercent: 70,
          limitValue: 100,
          observedValue: 70,
        },
        {
          organizationId: organizationB.id,
          periodKey,
          metric: 'TOKENS',
          thresholdPercent: 90,
          limitValue: 10_000,
          observedValue: 9_000,
        },
      ],
    });

    appA = await prisma.appInfo.create({
      data: {
        appname: 'Organization A App',
        appcode: `M3_A_${randomUUID()}`,
        consoleOwnership: {
          create: {
            organizationId: organizationA.id,
            createdByIdentityId: adminA.identityId,
          },
        },
      },
      select: { id: true, appcode: true },
    });
    appB = await prisma.appInfo.create({
      data: {
        appname: 'Organization B App',
        appcode: `M3_B_${randomUUID()}`,
        consoleOwnership: {
          create: {
            organizationId: organizationB.id,
            createdByIdentityId: identities.get('admin-b')!.identityId,
          },
        },
      },
      select: { id: true, appcode: true },
    });
    await prisma.securityAuditEvent.createMany({
      data: [
        {
          eventType: 'CONSOLE_TEST_A',
          actorType: 'console-user',
          actorId: adminA.worksUserId,
          appId: appA.id,
          appcode: appA.appcode,
          consoleIdentityId: adminA.identityId,
          consoleOrganizationId: adminA.organizationId,
          worksUserId: adminA.worksUserId,
          worksOrganizationId: adminA.worksOrganizationId,
          consoleSessionIdHash: 'a'.repeat(64),
          metadata: {
            changedFields: 'remark',
            recoveryKey: 'ORGANIZATION_A_PRIVATE_RECOVERY_KEY',
            secret: 'ORGANIZATION_A_PRIVATE_AUDIT_SECRET',
          },
        },
        {
          eventType: 'CONSOLE_TEST_B',
          actorType: 'console-user',
          actorId: identities.get('admin-b')!.worksUserId,
          appId: appB.id,
          appcode: appB.appcode,
          consoleIdentityId: identities.get('admin-b')!.identityId,
          consoleOrganizationId: identities.get('admin-b')!.organizationId,
          worksUserId: identities.get('admin-b')!.worksUserId,
          worksOrganizationId: identities.get('admin-b')!.worksOrganizationId,
          metadata: { secret: 'ORGANIZATION_B_PRIVATE_AUDIT_SECRET' },
        },
      ],
    });
    await prisma.bedrockSearchLog.create({
      data: {
        appcode: appA.appcode,
        searchword: 'ORGANIZATION_A_PRIVATE',
        responsetime: 100,
        inputtokens: 10,
        outputtokens: 5,
        totaltokens: 15,
        requestId: randomUUID(),
        endpoint: '/bedrock/converse',
        status: 'success',
        result: 'completed',
      },
    });
    const logB = await prisma.bedrockSearchLog.create({
      data: {
        appcode: appB.appcode,
        searchword: 'ORGANIZATION_B_PRIVATE',
        responsetime: 200,
        inputtokens: 20,
        outputtokens: 10,
        totaltokens: 30,
        requestId: randomUUID(),
        endpoint: '/bedrock/converse',
        status: 'success',
        result: 'completed',
      },
    });
    logBId = logB.id;
  });

  afterAll(async () => app?.close());

  it('fails closed for missing or inactive identity context', async () => {
    await request(server).get('/console-api/v1/apps').expect(401);
    for (const identity of [
      'disabled-user',
      'disabled-organization',
      'removed-membership',
    ] as const) {
      await request(server)
        .get('/console-api/v1/apps')
        .set(as(identity))
        .expect(403);
    }
  });

  it('enforces app read/write permissions and stores organization ownership', async () => {
    const viewerList = await request(server)
      .get('/console-api/v1/apps')
      .set(as('viewer-a'))
      .expect(200);
    expect(viewerList.body).toEqual([
      expect.objectContaining({ id: appA.id, appcode: appA.appcode }),
    ]);
    expect(JSON.stringify(viewerList.body)).not.toContain(appB.appcode);

    await request(server)
      .post('/console-api/v1/apps')
      .set(as('viewer-a'))
      .send({ appname: 'Viewer must not create' })
      .expect(403);

    const created = await request(server)
      .post('/console-api/v1/apps')
      .set(as('admin-a'))
      .send({ appname: 'Created through HTTP', remark: 'M3-02' })
      .expect(201);
    const createdBody = created.body as unknown as { id: string };
    expect(
      await prisma.consoleAppOwnership.findUnique({
        where: { appInfoId: createdBody.id },
        select: { organizationId: true, createdByIdentityId: true },
      }),
    ).toEqual({
      organizationId: identities.get('admin-a')!.organizationId,
      createdByIdentityId: identities.get('admin-a')!.identityId,
    });

    await request(server)
      .get(`/console-api/v1/apps/${appB.id}`)
      .set(as('admin-a'))
      .expect(404);
  });

  it('separates credential permissions, ownership and secret storage', async () => {
    await request(server)
      .get(`/console-api/v1/apps/${appA.id}/credentials`)
      .set(as('viewer-a'))
      .expect(403);
    await request(server)
      .get(`/console-api/v1/apps/${appA.id}/credentials`)
      .set(as('knowledge-a'))
      .expect(403);

    const issued = await request(server)
      .post(`/console-api/v1/apps/${appA.id}/credentials`)
      .set(as('developer-a'))
      .send({ ttlDays: 30 })
      .expect(201);
    const issuedBody = issued.body as unknown as { appkey: string };
    expect(issuedBody.appkey).toEqual(expect.any(String));
    const appRow = await prisma.appInfo.findUniqueOrThrow({
      where: { id: appA.id },
      select: { appkey: true, appkeyHash: true, appkeyId: true },
    });
    expect(appRow.appkey).toBeNull();
    expect(appRow.appkeyHash).toEqual(expect.any(String));
    expect(appRow.appkeyHash).not.toBe(issuedBody.appkey);

    const listed = await request(server)
      .get(`/console-api/v1/apps/${appA.id}/credentials`)
      .set(as('developer-a'))
      .expect(200);
    const listedBody = listed.body as unknown as Array<Record<string, unknown>>;
    expect(listedBody).toEqual([
      expect.objectContaining({ id: appRow.appkeyId, slot: 'current' }),
    ]);
    expect(JSON.stringify(listedBody)).not.toContain(issuedBody.appkey);
    expect(JSON.stringify(listedBody)).not.toContain(appRow.appkeyHash!);

    await request(server)
      .post(`/console-api/v1/apps/${appB.id}/credentials`)
      .set(as('developer-a'))
      .send({ ttlDays: 30 })
      .expect(404);
  });

  it('isolates usage and request logs by organization and permission', async () => {
    const summary = await request(server)
      .get('/console-api/v1/usage/summary?days=30')
      .set(as('viewer-a'))
      .expect(200);
    expect(summary.body).toMatchObject({
      requestCount: 1,
      tokens: { total: { value: 15 } },
    });

    const alerts = await request(server)
      .get('/console-api/v1/usage/alerts')
      .set(as('viewer-a'))
      .expect(200);
    expect(alerts.body).toMatchObject({
      channel: {
        type: 'console-inbox',
        recipientPermission: 'usage:read',
        redeliveryPolicy: 'idempotent-refetch',
      },
      readOnly: true,
      items: [
        {
          metric: 'REQUESTS',
          thresholdPercent: 70,
          limitValue: 100,
          observedValue: 70,
          severity: 'notice',
        },
      ],
    });
    expect(JSON.stringify(alerts.body)).not.toContain('TOKENS');
    await request(server)
      .get('/console-api/v1/usage/alerts')
      .set(as('knowledge-a'))
      .expect(403);

    await request(server)
      .get('/console-api/v1/request-logs')
      .set(as('viewer-a'))
      .expect(403);
    const logs = await request(server)
      .get('/console-api/v1/request-logs?days=30')
      .set(as('developer-a'))
      .expect(200);
    const logsBody = logs.body as unknown as {
      items: Array<{ app: { appcode: string } }>;
    };
    expect(logsBody.items).toHaveLength(1);
    expect(logsBody.items[0]).toMatchObject({
      app: { appcode: appA.appcode },
    });
    expect(JSON.stringify(logsBody)).not.toContain(appB.appcode);
    expect(JSON.stringify(logsBody)).not.toMatch(/ORGANIZATION_[AB]_PRIVATE/);

    await request(server)
      .get(`/console-api/v1/request-logs/bedrock:${logBId}`)
      .set(as('developer-a'))
      .expect(404);
  });

  it('isolates audit events and returns only safe metadata to audit readers', async () => {
    await request(server)
      .get('/console-api/v1/audit-events')
      .set(as('developer-a'))
      .expect(403);

    const response = await request(server)
      .get(
        `/console-api/v1/audit-events?days=7&eventType=CONSOLE_TEST_A&appId=${appA.id}&worksUserId=${identities.get('admin-a')!.worksUserId}`,
      )
      .set(as('admin-a'))
      .expect(200);
    expect(response.body).toMatchObject({
      items: [
        {
          eventType: 'CONSOLE_TEST_A',
          app: { id: appA.id, appcode: appA.appcode },
          actor: { worksUserId: identities.get('admin-a')!.worksUserId },
          details: { changedFields: 'remark' },
        },
      ],
      nextCursor: null,
    });
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toMatch(
      /ORGANIZATION_[AB]_PRIVATE|recoveryKey|consoleSessionIdHash|metadata/,
    );

    const other = await request(server)
      .get('/console-api/v1/audit-events?days=7&eventType=CONSOLE_TEST_B')
      .set(as('admin-a'))
      .expect(200);
    expect(other.body).toMatchObject({ items: [], nextCursor: null });
  });
});
