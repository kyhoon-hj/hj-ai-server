import type { Server } from 'node:http';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { ConsoleIdentityContext } from '../security/console-identity-context';
import { CONSOLE_IDENTITY_CONTEXT_RESOLVER } from '../security/console-identity-context.resolver';
import { ConsoleSecurityModule } from '../security/console-security.module';
import { ConsoleAppsController } from './console-apps.controller';
import { ConsoleAppsService } from './console-apps.service';
import { ConsoleCredentialsService } from './console-credentials.service';

const appId = '66666666-6666-4666-8666-666666666666';
const credentialId = '77777777-7777-4777-8777-777777777777';
const appEntity = {
  id: appId,
  appname: 'Support',
  appcode: 'CONSOLE_66666666666646668666666666666666',
  status: 'active',
};

const identityFixture = (
  permissions: ConsoleIdentityContext['permissions'],
): ConsoleIdentityContext => ({
  authenticationSource: 'test-fixture',
  identityId: '11111111-1111-4111-8111-111111111111',
  worksUserId: '22222222-2222-4222-8222-222222222222',
  identityStatus: 'ACTIVE',
  organizationId: '33333333-3333-4333-8333-333333333333',
  worksOrganizationId: '44444444-4444-4444-8444-444444444444',
  organizationStatus: 'ACTIVE',
  membershipId: '55555555-5555-4555-8555-555555555555',
  membershipStatus: 'ACTIVE',
  permissions,
});

describe('Console apps HTTP contract', () => {
  let app: INestApplication;
  let identity: ConsoleIdentityContext | null;
  const list = jest.fn().mockResolvedValue([appEntity]);
  const create = jest.fn().mockResolvedValue(appEntity);
  const findOne = jest.fn().mockResolvedValue(appEntity);
  const update = jest.fn().mockResolvedValue(appEntity);
  const listCredentials = jest.fn().mockResolvedValue([]);
  const issueCredential = jest.fn().mockResolvedValue({
    credential: { id: credentialId, status: 'active', slot: 'current' },
    appkey: 'one-time-secret',
  });
  const rotateCredential = jest.fn().mockResolvedValue({
    credential: { id: credentialId, status: 'active', slot: 'current' },
    appkey: 'rotated-one-time-secret',
  });
  const revokeCredential = jest.fn().mockResolvedValue({
    credentialId,
    status: 'revoked',
  });

  beforeEach(async () => {
    identity = identityFixture(['apps:read', 'apps:write']);
    list.mockClear();
    create.mockClear();
    findOne.mockClear();
    update.mockClear();
    listCredentials.mockClear();
    issueCredential.mockClear();
    rotateCredential.mockClear();
    revokeCredential.mockClear();
    const module = await Test.createTestingModule({
      imports: [ConsoleSecurityModule],
      controllers: [ConsoleAppsController],
      providers: [
        {
          provide: ConsoleAppsService,
          useValue: { list, create, findOne, update },
        },
        {
          provide: ConsoleCredentialsService,
          useValue: {
            list: listCredentials,
            issue: issueCredential,
            rotate: rotateCredential,
            revoke: revokeCredential,
          },
        },
      ],
    })
      .overrideProvider(CONSOLE_IDENTITY_CONTEXT_RESOLVER)
      .useValue({ resolve: () => Promise.resolve(identity) })
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
  });

  afterEach(async () => app.close());

  it('lists and reads apps with apps:read', async () => {
    await request(app.getHttpServer() as Server)
      .get('/console-api/v1/apps')
      .expect(200, [appEntity]);
    await request(app.getHttpServer() as Server)
      .get('/console-api/v1/apps/' + appId)
      .expect(200, appEntity);

    expect(list).toHaveBeenCalledWith(identity);
    expect(findOne).toHaveBeenCalledWith(appId, identity);
  });

  it('requires apps:write and rejects client-supplied appcode', async () => {
    identity = identityFixture(['apps:read']);
    await request(app.getHttpServer() as Server)
      .post('/console-api/v1/apps')
      .send({ appname: 'Support' })
      .expect(403);

    identity = identityFixture(['apps:write']);
    await request(app.getHttpServer() as Server)
      .post('/console-api/v1/apps')
      .send({ appname: 'Support', appcode: 'CLIENT_CONTROLLED' })
      .expect(400);
    expect(create).not.toHaveBeenCalled();
  });

  it('creates and updates only the exposed mutable fields', async () => {
    await request(app.getHttpServer() as Server)
      .post('/console-api/v1/apps')
      .send({ appname: 'Support', remark: 'RAG app' })
      .expect(201, appEntity);
    await request(app.getHttpServer() as Server)
      .patch('/console-api/v1/apps/' + appId)
      .send({ appname: 'Updated', status: 'inactive' })
      .expect(200, appEntity);

    expect(create).toHaveBeenCalledWith(
      { appname: 'Support', remark: 'RAG app' },
      identity,
      undefined,
    );
    expect(update).toHaveBeenCalledWith(
      appId,
      { appname: 'Updated', status: 'inactive' },
      identity,
      undefined,
    );
  });

  it('fails closed before the Works session adapter is connected', async () => {
    identity = null;
    await request(app.getHttpServer() as Server)
      .get('/console-api/v1/apps')
      .expect(401);
  });

  it('enforces separate credential read, rotate and revoke permissions', async () => {
    identity = identityFixture(['apps:read']);
    await request(app.getHttpServer() as Server)
      .get('/console-api/v1/apps/' + appId + '/credentials')
      .expect(403);

    identity = identityFixture(['credentials:read']);
    await request(app.getHttpServer() as Server)
      .get('/console-api/v1/apps/' + appId + '/credentials')
      .expect(200, []);

    identity = identityFixture(['credentials:rotate']);
    await request(app.getHttpServer() as Server)
      .post('/console-api/v1/apps/' + appId + '/credentials')
      .send({ ttlDays: 90 })
      .expect(201);
    await request(app.getHttpServer() as Server)
      .post('/console-api/v1/apps/' + appId + '/credentials/rotate')
      .send({ gracePeriodSeconds: 60 })
      .expect(201);

    await request(app.getHttpServer() as Server)
      .delete('/console-api/v1/apps/' + appId + '/credentials/' + credentialId)
      .expect(403);

    identity = identityFixture(['credentials:revoke']);
    await request(app.getHttpServer() as Server)
      .delete('/console-api/v1/apps/' + appId + '/credentials/' + credentialId)
      .expect(200);
  });

  it('rejects invalid credential lifecycle input before the service', async () => {
    identity = identityFixture(['credentials:rotate']);
    await request(app.getHttpServer() as Server)
      .post('/console-api/v1/apps/' + appId + '/credentials')
      .send({ ttlDays: 0 })
      .expect(400);
    await request(app.getHttpServer() as Server)
      .post('/console-api/v1/apps/' + appId + '/credentials/rotate')
      .send({ gracePeriodSeconds: 86401 })
      .expect(400);
    expect(issueCredential).not.toHaveBeenCalled();
    expect(rotateCredential).not.toHaveBeenCalled();
  });
});
