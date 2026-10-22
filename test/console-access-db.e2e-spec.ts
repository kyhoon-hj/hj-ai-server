import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ConsoleWorksAuthService } from '../src/console/security/console-works-auth.service';
import request from 'supertest';
import type { Server } from 'node:http';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { StorageService } from '../src/storage/storage.service';
import { EmbeddingService } from '../src/knowledge/embedding.service';
import { KnowledgeService } from '../src/knowledge/knowledge.service';
import { KnowledgeIndexJobService } from '../src/knowledge/knowledge-index-job.service';
import { AppInfoService } from '../src/app-info/app-info.service';
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
  let knowledgeFileAId: string;
  let knowledgeFileBId: string;
  const lifecycleText =
    'The cobalt kettle return deadline is 17 days after purchase.';
  const vector = Array.from({ length: 1024 }, (_, index) =>
    index === 0 ? 1 : 0,
  );

  const resolver: ConsoleIdentityContextResolver = {
    resolve(request: ConsoleRequest) {
      const headers = (
        request as ConsoleRequest & {
          headers?: Record<string, string | string[] | undefined>;
        }
      ).headers;
      const name = headers?.['x-test-console-identity'];
      if (typeof name !== 'string')
        return app.get(ConsoleWorksAuthService).resolve(request);
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
      .overrideProvider(StorageService)
      .useValue({
        uploadFile: jest.fn((file: Express.Multer.File, appcode: string) =>
          Promise.resolve({
            bucket: 'internal-test-bucket',
            key: `${appcode}/${randomUUID()}`,
            url: null,
            originalName: file.originalname,
            mimetype: file.mimetype,
            size: file.size,
          }),
        ),
        deleteFile: jest.fn().mockResolvedValue(undefined),
        downloadFileBuffer: jest.fn().mockResolvedValue({
          body: Buffer.from(lifecycleText),
          contentType: 'text/plain',
        }),
      })
      .overrideProvider(EmbeddingService)
      .useValue({
        getDefaultEmbeddingModelId: () => 'fixed-vector',
        createEmbedding: jest.fn().mockResolvedValue(vector),
      })
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
    const fileA = await prisma.knowledgeFile.create({
      data: {
        appcode: appA.appcode,
        bucket: 'internal-test-bucket',
        key: 'ORGANIZATION_A_PRIVATE_S3_KEY',
        originalName: 'Organization A policy.txt',
        mimetype: 'text/plain',
        size: 24,
        metadata: { secret: 'ORGANIZATION_A_PRIVATE_METADATA' },
      },
    });
    knowledgeFileAId = fileA.id;
    const fileB = await prisma.knowledgeFile.create({
      data: {
        appcode: appB.appcode,
        bucket: 'internal-test-bucket',
        key: 'ORGANIZATION_B_PRIVATE_S3_KEY',
        originalName: 'Organization B policy.txt',
        mimetype: 'text/plain',
        size: 24,
      },
    });
    knowledgeFileBId = fileB.id;
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
    const repeatedAlerts = await request(server)
      .get('/console-api/v1/usage/alerts')
      .set(as('viewer-a'))
      .expect(200);
    const alertItems = (alerts.body as unknown as { items: unknown[] }).items;
    const repeatedItems = (
      repeatedAlerts.body as unknown as { items: unknown[] }
    ).items;
    expect(repeatedItems).toEqual(alertItems);
    expect(
      await prisma.consoleUsageThresholdEvent.count({
        where: { organizationId: identities.get('viewer-a')!.organizationId },
      }),
    ).toBe(1);
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
    const crossOrganizationApp = await request(server)
      .get(`/console-api/v1/audit-events?days=7&appId=${appB.id}`)
      .set(as('admin-a'))
      .expect(200);
    expect(crossOrganizationApp.body).toMatchObject({
      items: [],
      nextCursor: null,
    });
  });

  it('uses Console knowledge permission and app ownership for file reads', async () => {
    await request(server)
      .get(`/console-api/v1/apps/${appA.id}/knowledge/files`)
      .set(as('viewer-a'))
      .expect(403);

    const listed = await request(server)
      .get(`/console-api/v1/apps/${appA.id}/knowledge/files`)
      .set(as('knowledge-a'))
      .expect(200);
    expect(listed.body).toMatchObject([
      { id: knowledgeFileAId, originalName: 'Organization A policy.txt' },
    ]);
    expect(JSON.stringify(listed.body)).not.toMatch(
      /ORGANIZATION_[AB]_PRIVATE|internal-test-bucket|metadata|bucket|key/,
    );

    await request(server)
      .get(`/console-api/v1/apps/${appB.id}/knowledge/files`)
      .set(as('knowledge-a'))
      .expect(404);
    await request(server)
      .get(
        `/console-api/v1/apps/${appA.id}/knowledge/files/${knowledgeFileBId}`,
      )
      .set(as('knowledge-a'))
      .expect(404);

    const detail = await request(server)
      .get(
        `/console-api/v1/apps/${appA.id}/knowledge/files/${knowledgeFileAId}`,
      )
      .set(as('knowledge-a'))
      .expect(200);
    expect(detail.body).toMatchObject({
      id: knowledgeFileAId,
      chunkCount: 0,
    });
    expect(JSON.stringify(detail.body)).not.toMatch(
      /ORGANIZATION_[AB]_PRIVATE|internal-test-bucket|metadata|bucket|key/,
    );

    await request(server)
      .post(
        `/console-api/v1/apps/${appA.id}/knowledge/files/${knowledgeFileAId}/index-jobs`,
      )
      .set(as('viewer-a'))
      .expect(403);
    await request(server)
      .post(
        `/console-api/v1/apps/${appA.id}/knowledge/files/${knowledgeFileBId}/index-jobs`,
      )
      .set(as('knowledge-a'))
      .expect(404);
    const jobPath = `/console-api/v1/apps/${appA.id}/knowledge/files/${knowledgeFileAId}/index-jobs`;
    const submitted = await request(server)
      .post(jobPath)
      .set(as('knowledge-a'))
      .set('idempotency-key', 'M5-01-index')
      .expect(202);
    const repeated = await request(server)
      .post(jobPath)
      .set(as('knowledge-a'))
      .set('idempotency-key', 'M5-01-index')
      .expect(202);
    expect(repeated.body).toEqual(submitted.body);
    expect(submitted.body).toMatchObject({
      fileId: knowledgeFileAId,
      operation: 'index',
      status: 'queued',
    });
    expect(JSON.stringify(submitted.body)).not.toContain('M5-01-index');
    expect(
      await prisma.knowledgeIndexJob.count({
        where: { fileId: knowledgeFileAId },
      }),
    ).toBe(1);
  });

  it('uploads and publishes owned knowledge files with server-side limits', async () => {
    const uploadPath = `/console-api/v1/apps/${appA.id}/knowledge/files`;
    await request(server).post(uploadPath).set(as('knowledge-a')).expect(400);
    await request(server)
      .post(uploadPath)
      .set(as('viewer-a'))
      .attach('file', Buffer.from('viewer file'), 'viewer.txt')
      .expect(403);
    await request(server)
      .post(`/console-api/v1/apps/${appB.id}/knowledge/files`)
      .set(as('knowledge-a'))
      .attach('file', Buffer.from('foreign file'), 'foreign.txt')
      .expect(404);
    await request(server)
      .post(uploadPath)
      .set(as('knowledge-a'))
      .attach('file', Buffer.from('invalid file'), 'invalid.exe')
      .expect(400);

    const uploaded = await request(server)
      .post(uploadPath)
      .set(as('knowledge-a'))
      .attach('file', Buffer.from('M5-02 test content'), 'm5-02.txt')
      .expect(201);
    expect(uploaded.body).toMatchObject({
      originalName: 'm5-02.txt',
      status: 'uploaded',
      businessStatus: 'DRAFT',
    });
    expect(JSON.stringify(uploaded.body)).not.toMatch(/bucket|key|checksum/);
    const uploadedFileId = String((uploaded.body as { id: string }).id);

    const policyPath = `${uploadPath}/${uploadedFileId}/policy`;
    await request(server)
      .patch(policyPath)
      .set(as('viewer-a'))
      .send({ businessStatus: 'PUBLISHED' })
      .expect(403);
    await request(server)
      .patch(`${uploadPath}/${knowledgeFileBId}/policy`)
      .set(as('knowledge-a'))
      .send({ businessStatus: 'PUBLISHED' })
      .expect(404);
    await request(server)
      .patch(policyPath)
      .set(as('knowledge-a'))
      .send({ businessStatus: 'INVALID' })
      .expect(400);
    const published = await request(server)
      .patch(policyPath)
      .set(as('knowledge-a'))
      .send({
        accessLevel: 'PUBLIC',
        businessStatus: 'PUBLISHED',
        productCodes: ['PRODUCT_A'],
      })
      .expect(200);
    expect(published.body).toMatchObject({
      businessStatus: 'PUBLISHED',
      productCodes: ['PRODUCT_A'],
    });
    expect(
      await prisma.knowledgeFile.findUnique({ where: { id: uploadedFileId } }),
    ).toMatchObject({ businessStatus: 'PUBLISHED' });

    await prisma.appInfo.update({
      where: { id: appA.id },
      data: { maxStorageMb: 1 },
    });
    await prisma.knowledgeFile.update({
      where: { id: uploadedFileId },
      data: { size: 1_048_576 },
    });
    await request(server)
      .post(uploadPath)
      .set(as('knowledge-a'))
      .attach('file', Buffer.from('over quota'), 'over-quota.txt')
      .expect(400);
  });

  it('scopes index jobs and failure summary to the Console organization', async () => {
    const base = `/console-api/v1/apps/${appA.id}/knowledge`;
    const foreignBase = `/console-api/v1/apps/${appB.id}/knowledge`;
    const requestedAt = new Date('2026-10-02T01:00:00.000Z');
    const failedA = await prisma.knowledgeIndexJob.create({
      data: {
        fileId: knowledgeFileAId,
        appcode: appA.appcode,
        operation: 'index',
        status: 'failed',
        attempt: 1,
        maxAttempts: 3,
        retryable: true,
        errorCode: 'UPSTREAM_TIMEOUT',
        errorMessage: '외부 서비스 응답 시간이 초과되었습니다.',
        requestedAt,
        completedAt: requestedAt,
      },
    });
    const failedB = await prisma.knowledgeIndexJob.create({
      data: {
        fileId: knowledgeFileBId,
        appcode: appB.appcode,
        operation: 'index',
        status: 'failed',
        attempt: 3,
        maxAttempts: 3,
        retryable: false,
        errorCode: 'INVALID_INDEX_REQUEST',
        requestedAt,
        completedAt: requestedAt,
      },
    });
    const listPath = `${base}/files/${knowledgeFileAId}/index-jobs`;
    await request(server).get(listPath).set(as('viewer-a')).expect(403);
    await request(server)
      .get(`${base}/files/${knowledgeFileBId}/index-jobs`)
      .set(as('knowledge-a'))
      .expect(404);
    await request(server)
      .get(`${foreignBase}/files/${knowledgeFileBId}/index-jobs`)
      .set(as('knowledge-a'))
      .expect(404);
    const listed = await request(server)
      .get(listPath)
      .set(as('knowledge-a'))
      .expect(200);
    expect(listed.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: failedA.id,
          attempt: 1,
          errorCode: 'UPSTREAM_TIMEOUT',
        }),
      ]),
    );
    expect(JSON.stringify(listed.body)).not.toMatch(
      /idempotencyKey|leaseExpiresAt|appcode/,
    );

    await request(server)
      .get(`${base}/index-jobs/${failedB.id}`)
      .set(as('knowledge-a'))
      .expect(404);
    await request(server)
      .post(`${base}/index-jobs/${failedB.id}/retry`)
      .set(as('knowledge-a'))
      .expect(404);
    const summary = await request(server)
      .get('/console-api/v1/knowledge/index-failures')
      .set(as('knowledge-a'))
      .expect(200);
    expect(summary.body).toMatchObject({
      failedJobs: 1,
      lastFailureAt: requestedAt.toISOString(),
      affectedApps: 1,
    });
    await request(server)
      .get('/console-api/v1/knowledge/index-failures')
      .set(as('viewer-a'))
      .expect(403);

    const retried = await request(server)
      .post(`${base}/index-jobs/${failedA.id}/retry`)
      .set(as('knowledge-a'))
      .expect(202);
    expect(retried.body).toMatchObject({
      id: failedA.id,
      status: 'queued',
      attempt: 1,
    });
    await request(server)
      .post(`${base}/index-jobs/${failedA.id}/retry`)
      .set(as('knowledge-a'))
      .expect(400);
    const emptySummary = await request(server)
      .get('/console-api/v1/knowledge/index-failures')
      .set(as('knowledge-a'))
      .expect(200);
    expect(emptySummary.body).toMatchObject({
      failedJobs: 0,
      lastFailureAt: null,
      affectedApps: 0,
    });

    const uploaded = await prisma.knowledgeFile.findFirstOrThrow({
      where: { appcode: appA.appcode, originalName: 'm5-02.txt' },
      select: { id: true },
    });
    await request(server)
      .post(`${base}/files/${uploaded.id}/reindex-jobs`)
      .set(as('viewer-a'))
      .expect(403);
    const reindexed = await request(server)
      .post(`${base}/files/${uploaded.id}/reindex-jobs`)
      .set(as('knowledge-a'))
      .expect(202);
    expect(reindexed.body).toMatchObject({
      fileId: uploaded.id,
      operation: 'reindex',
      status: 'queued',
    });
    const detail = await request(server)
      .get(
        `${base}/index-jobs/${String((reindexed.body as { id: string }).id)}`,
      )
      .set(as('knowledge-a'))
      .expect(200);
    expect(detail.body).toMatchObject({
      operation: 'reindex',
      status: 'queued',
    });
  });

  it('archives safely, audits changes, and recovers failed object cleanup', async () => {
    const file = await prisma.knowledgeFile.create({
      data: {
        appcode: appA.appcode,
        bucket: 'internal-test-bucket',
        key: `m5-04/${randomUUID()}.txt`,
        originalName: 'm5-04.txt',
        mimetype: 'text/plain',
        size: 32,
        status: 'indexed',
      },
    });
    const path = `/console-api/v1/apps/${appA.id}/knowledge/files/${file.id}`;
    const foreignPath = `/console-api/v1/apps/${appB.id}/knowledge/files/${file.id}`;
    await request(server).delete(path).set(as('viewer-a')).expect(403);
    await request(server)
      .delete(foreignPath)
      .set(as('knowledge-a'))
      .expect(404);
    await request(server)
      .post(`${path}/object-cleanup/retry`)
      .set(as('knowledge-a'))
      .expect(400);

    const policy = await request(server)
      .patch(`${path}/policy`)
      .set(as('knowledge-a'))
      .send({ businessStatus: 'PUBLISHED' })
      .expect(200);
    expect(policy.body).toMatchObject({ businessStatus: 'PUBLISHED' });
    await request(server)
      .patch(`${path}/policy`)
      .set(as('knowledge-a'))
      .send({ businessStatus: 'PUBLISHED' })
      .expect(200);
    expect(
      await prisma.securityAuditEvent.count({
        where: {
          eventType: 'CONSOLE_KNOWLEDGE_POLICY_UPDATED',
          appId: appA.id,
          metadata: { path: ['fileId'], equals: file.id },
        },
      }),
    ).toBe(1);

    const active = await prisma.knowledgeIndexJob.create({
      data: { fileId: file.id, appcode: appA.appcode, operation: 'index' },
    });
    await request(server).delete(path).set(as('knowledge-a')).expect(409);
    await prisma.knowledgeIndexJob.update({
      where: { id: active.id },
      data: { status: 'completed', completedAt: new Date() },
    });
    const archived = await request(server)
      .delete(path)
      .set(as('knowledge-a'))
      .expect(200);
    expect(archived.body).toMatchObject({
      id: file.id,
      status: 'archived',
      businessStatus: 'RETIRED',
      objectCleanupStatus: 'not_requested',
    });
    expect(JSON.stringify(archived.body)).not.toMatch(/bucket|key|metadata/);
    await request(server).delete(path).set(as('knowledge-a')).expect(200);
    expect(
      await prisma.securityAuditEvent.count({
        where: { eventType: 'CONSOLE_KNOWLEDGE_ARCHIVED', appId: appA.id },
      }),
    ).toBe(1);
    await request(server)
      .patch(`${path}/policy`)
      .set(as('knowledge-a'))
      .send({ businessStatus: 'PUBLISHED' })
      .expect(400);
    await request(server)
      .post(`${path}/index-jobs`)
      .set(as('knowledge-a'))
      .expect(400);

    const defaultList = await request(server)
      .get(`/console-api/v1/apps/${appA.id}/knowledge/files`)
      .set(as('knowledge-a'))
      .expect(200);
    expect(defaultList.body).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: file.id })]),
    );
    const archivedList = await request(server)
      .get(
        `/console-api/v1/apps/${appA.id}/knowledge/files?includeArchived=true`,
      )
      .set(as('knowledge-a'))
      .expect(200);
    expect(archivedList.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: file.id, status: 'archived' }),
      ]),
    );

    const storage = app.get(StorageService);
    const deleteMock = jest.spyOn(storage, 'deleteFile');
    const callsBefore = deleteMock.mock.calls.length;
    deleteMock.mockRejectedValueOnce(new Error('S3 test failure'));
    await request(server)
      .delete(`${path}?deleteObject=true`)
      .set(as('knowledge-a'))
      .expect(500);
    const failed = await request(server)
      .get(path)
      .set(as('knowledge-a'))
      .expect(200);
    expect(failed.body).toMatchObject({
      status: 'archived',
      deleteObjectRequested: true,
      deletedObject: false,
      objectCleanupStatus: 'failed',
    });
    await request(server)
      .post(`${path}/object-cleanup/retry`)
      .set(as('viewer-a'))
      .expect(403);
    await request(server)
      .post(`${foreignPath}/object-cleanup/retry`)
      .set(as('knowledge-a'))
      .expect(404);
    const recovered = await request(server)
      .post(`${path}/object-cleanup/retry`)
      .set(as('knowledge-a'))
      .expect(201);
    expect(recovered.body).toMatchObject({
      status: 'archived',
      deletedObject: true,
      objectCleanupStatus: 'completed',
    });
    await request(server)
      .post(`${path}/object-cleanup/retry`)
      .set(as('knowledge-a'))
      .expect(400);
    await request(server)
      .delete(`${path}?deleteObject=true`)
      .set(as('knowledge-a'))
      .expect(200);
    expect(deleteMock.mock.calls.length - callsBefore).toBe(2);
    expect(
      await prisma.securityAuditEvent.count({
        where: {
          eventType: 'CONSOLE_KNOWLEDGE_OBJECT_CLEANUP_FAILED',
          appId: appA.id,
        },
      }),
    ).toBe(1);
    expect(
      await prisma.securityAuditEvent.count({
        where: {
          eventType: 'CONSOLE_KNOWLEDGE_OBJECT_CLEANUP_COMPLETED',
          appId: appA.id,
        },
      }),
    ).toBe(1);
  });
  it('completes upload, index, answer, reindex and archive through scoped HTTP contracts', async () => {
    const manager = identities.get('knowledge-a')!;
    const appA = await prisma.appInfo.create({
      data: {
        appname: 'M5 isolated lifecycle',
        appcode: `M5_LIFECYCLE_${randomUUID()}`,
        consoleOwnership: {
          create: {
            organizationId: manager.organizationId,
            createdByIdentityId: manager.identityId,
          },
        },
      },
    });
    await prisma.appInfo.update({
      where: { id: appA.id },
      data: {
        maxStorageMb: 10,
        defaultModelId: 'test-converse',
        defaultEmbeddingModelId: 'fixed-vector',
        allowedAccessLevels: ['PUBLIC'],
      },
    });
    const credential = app.get(AppInfoService).createAppKeyMaterial({
      id: appA.id,
      appname: 'Organization A App',
      appcode: appA.appcode,
    });
    await prisma.appInfo.update({
      where: { id: appA.id },
      data: {
        appkeyHash: credential.appkeyHash,
        appkeyId: credential.credentialId,
        appkeyExpiresAt: credential.expiresAt,
      },
    });
    const send = jest.fn().mockResolvedValue({
      output: {
        message: {
          content: [
            {
              text: JSON.stringify({
                answerable: true,
                answer: 'The return deadline is 17 days after purchase.',
                sourceIndexes: [1],
              }),
            },
          ],
        },
      },
      stopReason: 'end_turn',
    });
    Object.defineProperty(app.get(KnowledgeService), 'bedrockClient', {
      value: { send },
      configurable: true,
    });

    const base = `/console-api/v1/apps/${appA.id}/knowledge`;
    const uploaded = await request(server)
      .post(`${base}/files`)
      .set(as('knowledge-a'))
      .attach('file', Buffer.from(lifecycleText), 'cobalt-kettle.txt')
      .expect(201);
    const fileId = String((uploaded.body as { id: string }).id);
    const filePath = `${base}/files/${fileId}`;
    await request(server)
      .patch(`${filePath}/policy`)
      .set(as('knowledge-a'))
      .send({ accessLevel: 'PUBLIC', businessStatus: 'PUBLISHED' })
      .expect(200);
    const index = await request(server)
      .post(`${filePath}/index-jobs`)
      .set(as('knowledge-a'))
      .expect(202);
    const indexId = String((index.body as { id: string }).id);
    await app.get(KnowledgeIndexJobService).drain(appA.appcode);
    await request(server)
      .get(`${base}/index-jobs/${indexId}`)
      .set(as('knowledge-a'))
      .expect(200)
      .expect(({ body }) =>
        expect(body).toMatchObject({ status: 'completed' }),
      );
    expect(
      await prisma.knowledgeChunk.count({ where: { fileId } }),
    ).toBeGreaterThan(0);
    await prisma.knowledgeFile.updateMany({
      where: { appcode: appA.appcode, id: { not: fileId } },
      data: { businessStatus: 'DRAFT' },
    });

    const answer = await request(server)
      .post('/knowledge/answers')
      .set('appkey', credential.appkey)
      .send({
        query: 'When can I return the cobalt kettle?',
        strict: true,
        includeSources: true,
      })
      .expect(200);
    expect(answer.body).toMatchObject({
      answerable: true,
      answerStatus: 'answered',
    });
    expect(JSON.stringify(answer.body)).toContain(fileId);
    expect(send).toHaveBeenCalledTimes(1);

    const reindex = await request(server)
      .post(`${filePath}/reindex-jobs`)
      .set(as('knowledge-a'))
      .expect(202);
    await app.get(KnowledgeIndexJobService).drain(appA.appcode);
    await request(server)
      .get(`${base}/index-jobs/${String((reindex.body as { id: string }).id)}`)
      .set(as('knowledge-a'))
      .expect(200)
      .expect(({ body }) =>
        expect(body).toMatchObject({
          status: 'completed',
          operation: 'reindex',
        }),
      );

    await request(server).get(filePath).set(as('admin-b')).expect(404);
    await request(server)
      .get(`${base}/index-jobs/${indexId}`)
      .set(as('admin-b'))
      .expect(404);
    await request(server).delete(filePath).set(as('viewer-a')).expect(403);
    await request(server).delete(filePath).set(as('knowledge-a')).expect(200);
    expect(await prisma.knowledgeChunk.count({ where: { fileId } })).toBe(0);
    const afterArchive = await request(server)
      .post('/knowledge/answers')
      .set('appkey', credential.appkey)
      .send({
        query: 'When can I return the cobalt kettle?',
        strict: true,
        includeSources: true,
      })
      .expect(200);
    expect(afterArchive.body).toMatchObject({ answerable: false, sources: [] });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('exchanges Works SSO once, enforces browser state and origin, and revokes DB sessions', async () => {
    const config = app.get(ConfigService);
    config.set('CONSOLE_WORKS_SSO_ENABLED', 'true');
    config.set('CONSOLE_PUBLIC_ORIGIN', 'https://console.test');
    config.set('WORKS_PUBLIC_ORIGIN', 'https://works.test');
    config.set('WORKS_API_ORIGIN', 'https://works-api.test');
    config.set('WORKS_CONSOLE_CLIENT_ID', 'console-client');
    config.set('WORKS_CONSOLE_CLIENT_SECRET', 'server-only-secret');
    const identity = identities.get('admin-a')!;
    const payload = {
      userId: identity.worksUserId,
      tenantId: identity.worksOrganizationId,
      membershipRole: 'ADMIN',
      user: {
        id: identity.worksUserId,
        email: 'admin@example.com',
        displayName: 'Works Admin',
      },
      tenant: {
        id: identity.worksOrganizationId,
        name: 'Organization A',
        slug: 'org-a',
      },
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    };
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify(payload), { status: 200 })),
      );
    try {
      const login = await request(server)
        .get('/console-api/v1/auth/login')
        .expect(302);
      const location = new URL(String(login.headers.location));
      expect(location.origin).toBe('https://works.test');
      const state = location.searchParams.get('state')!;
      const stateCookie = `hj_console_state=${state}`;
      expect(String(login.headers['set-cookie'])).toContain('HttpOnly');
      expect(String(login.headers['set-cookie'])).toContain('Secure');
      await request(server)
        .get(`/console-api/v1/auth/callback?code=code&state=${state}`)
        .expect(401);
      const callback = await request(server)
        .get(`/console-api/v1/auth/callback?code=code&state=${state}`)
        .set('Cookie', stateCookie)
        .expect(302);
      const cookies = callback.headers['set-cookie'] as unknown as string[];
      const sessionCookie = cookies
        .find((cookie) => cookie.startsWith('hj_console_session='))!
        .split(';')[0];
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(callback.body)).not.toContain('server-only-secret');
      await request(server)
        .get(`/console-api/v1/auth/callback?code=code&state=${state}`)
        .set('Cookie', stateCookie)
        .expect(401);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const session = await request(server)
        .get('/console-api/v1/auth/session')
        .set('Cookie', sessionCookie)
        .expect(200);
      expect(session.body).toMatchObject({
        authenticationSource: 'works-session',
        organizationId: identity.organizationId,
      });
      await request(server)
        .get('/console-api/v1/apps')
        .set('Cookie', sessionCookie)
        .expect(200);
      await request(server)
        .post('/console-api/v1/apps')
        .set('Cookie', sessionCookie)
        .set('Origin', 'https://evil.test')
        .send({ appname: 'Blocked' })
        .expect(403);
      await request(server)
        .post('/console-api/v1/auth/logout')
        .set('Cookie', sessionCookie)
        .expect(403);
      await prisma.consoleMembership.update({
        where: { id: identity.membershipId },
        data: { status: 'REMOVED' },
      });
      await request(server)
        .get('/console-api/v1/auth/session')
        .set('Cookie', sessionCookie)
        .expect(401);
      await prisma.consoleMembership.update({
        where: { id: identity.membershipId },
        data: { status: 'ACTIVE' },
      });
      await request(server)
        .get('/console-api/v1/auth/session')
        .set('Cookie', sessionCookie)
        .expect(401);
      const nextLogin = await request(server)
        .get('/console-api/v1/auth/login')
        .expect(302);
      const nextState = new URL(
        String(nextLogin.headers.location),
      ).searchParams.get('state')!;
      const race = await Promise.all(
        [0, 1].map(() =>
          request(server)
            .get(
              `/console-api/v1/auth/callback?code=next-code&state=${nextState}`,
            )
            .set('Cookie', `hj_console_state=${nextState}`),
        ),
      );
      expect(race.map((result) => result.status).sort()).toEqual([302, 401]);
      const freshCookie = (
        race.find((result) => result.status === 302)!.headers[
          'set-cookie'
        ] as unknown as string[]
      )
        .find((cookie) => cookie.startsWith('hj_console_session='))!
        .split(';')[0];
      await request(server)
        .get('/console-api/v1/auth/session')
        .set('Cookie', freshCookie)
        .expect(200);
      await request(server)
        .post('/console-api/v1/auth/logout')
        .set('Cookie', freshCookie)
        .set('Origin', 'https://console.test')
        .expect(204);
      await request(server)
        .get('/console-api/v1/auth/session')
        .set('Cookie', freshCookie)
        .expect(401);
      const expireLogin = await request(server)
        .get('/console-api/v1/auth/login')
        .expect(302);
      const expireState = new URL(
        String(expireLogin.headers.location),
      ).searchParams.get('state')!;
      const expiring = await request(server)
        .get(
          `/console-api/v1/auth/callback?code=expire-code&state=${expireState}`,
        )
        .set('Cookie', `hj_console_state=${expireState}`)
        .expect(302);
      const expiredCookie = (
        expiring.headers['set-cookie'] as unknown as string[]
      )
        .find((cookie) => cookie.startsWith('hj_console_session='))!
        .split(';')[0];
      await prisma.consoleSession.updateMany({
        where: { membershipId: identity.membershipId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await request(server)
        .get('/console-api/v1/auth/session')
        .set('Cookie', expiredCookie)
        .expect(401);
    } finally {
      fetchMock.mockRestore();
      config.set('CONSOLE_WORKS_SSO_ENABLED', 'false');
    }
  });
});
