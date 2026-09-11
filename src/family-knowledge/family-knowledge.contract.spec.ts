import type { Server } from 'node:http';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppInfoService } from '../app-info/app-info.service';
import { AppkeyGuard, type AppkeyRequest } from '../common/guards/appkey.guard';
import { FamilyKnowledgeAccessGuard } from './family-knowledge-access.guard';
import { FamilyKnowledgeController } from './family-knowledge.controller';
import { FamilyKnowledgeSearchService } from './family-knowledge-search.service';
import { FamilyKnowledgeService } from './family-knowledge.service';

const appInfo: NonNullable<AppkeyRequest['appInfo']> = {
  id: 'app-1',
  appcode: 'zinframe-app',
  status: 'active',
  allowedAccessLevels: [],
  s3Prefix: null,
  defaultModelId: null,
  defaultEmbeddingModelId: null,
  systemPrompt: null,
  maxStorageMb: null,
  monthlyTokenLimit: null,
  metadata: null,
};
const body = {
  sourceId: 'story-1',
  sourceVersion: 1,
  operation: 'UPSERT',
  tenantRef: 'a'.repeat(64),
  audience: 'FAMILY',
  sourceType: 'TEXT',
  sensitivity: 'NON_SENSITIVE',
  title: '가상 기록',
  content: '가상 가족 기록 본문',
  publishedAt: '2026-09-10T00:00:00.000Z',
};

describe('Family knowledge ingestion HTTP contract', () => {
  let app: INestApplication;
  const settings: Record<string, string> = {
    FRAME_FAMILY_RAG_ENABLED: 'true',
    FRAME_FAMILY_RAG_APPCODES: 'zinframe-app',
  };
  const receiveEvent = jest.fn().mockResolvedValue({
    eventId: '11111111-1111-4111-8111-111111111111',
    sourceId: 'story-1',
    sourceVersion: 1,
    operation: 'UPSERT',
    status: 'QUEUED',
    resultCode: 'QUEUED',
    replayed: false,
  });
  const search = jest.fn().mockResolvedValue({ results: [] });

  beforeEach(async () => {
    settings.FRAME_FAMILY_RAG_ENABLED = 'true';
    settings.FRAME_FAMILY_RAG_APPCODES = 'zinframe-app';
    receiveEvent.mockClear();
    search.mockClear();
    const module = await Test.createTestingModule({
      controllers: [FamilyKnowledgeController],
      providers: [
        AppkeyGuard,
        FamilyKnowledgeAccessGuard,
        { provide: FamilyKnowledgeService, useValue: { receiveEvent } },
        { provide: FamilyKnowledgeSearchService, useValue: { search } },
        {
          provide: ConfigService,
          useValue: { get: (key: string) => settings[key] },
        },
        {
          provide: AppInfoService,
          useValue: {
            validateAppKey: (key: string) =>
              key === 'fixture-key'
                ? appInfo
                : key === 'other-key'
                  ? { ...appInfo, appcode: 'other-app' }
                  : null,
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

  const post = (payload: object, key?: string) => {
    const call = request(app.getHttpServer() as Server)
      .post('/family-knowledge/events')
      .send(payload);
    return key ? call.set('appkey', key) : call;
  };

  it('accepts an authenticated allowlisted event without exposing scope or content', async () => {
    const response = await post(body, 'fixture-key').expect(202);

    expect(receiveEvent).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: 'story-1' }),
      'zinframe-app',
    );
    expect(JSON.stringify(response.body)).not.toContain(body.tenantRef);
    expect(JSON.stringify(response.body)).not.toContain(body.content);
  });

  it('rejects missing authentication and non-allowlisted appcodes', async () => {
    await post(body).expect(401);
    await post(body, 'other-key').expect(403);
    expect(receiveEvent).not.toHaveBeenCalled();
  });

  it('fails closed when the feature flag or allowlist is empty', async () => {
    settings.FRAME_FAMILY_RAG_ENABLED = 'false';
    await post(body, 'fixture-key').expect(404);

    settings.FRAME_FAMILY_RAG_ENABLED = 'true';
    settings.FRAME_FAMILY_RAG_APPCODES = '';
    await post(body, 'fixture-key').expect(403);
    expect(receiveEvent).not.toHaveBeenCalled();
  });

  it('rejects appcode body injection and malformed scope before the service', async () => {
    await post({ ...body, appcode: 'other-app' }, 'fixture-key').expect(400);
    await post({ ...body, tenantRef: 'NOT-A-REF' }, 'fixture-key').expect(400);
    expect(receiveEvent).not.toHaveBeenCalled();
  });

  it('allows only bounded FAMILY searches and forbids member/sensitivity overrides', async () => {
    const searchBody = {
      query: '가상 가족 질문',
      tenantRef: body.tenantRef,
      audience: 'FAMILY',
    };
    await request(app.getHttpServer() as Server)
      .post('/family-knowledge/search')
      .set('appkey', 'fixture-key')
      .send(searchBody)
      .expect(200);
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 5 }),
      appInfo,
      undefined,
      expect.stringMatching(/^http-search:/),
    );

    await request(app.getHttpServer() as Server)
      .post('/family-knowledge/search')
      .set('appkey', 'fixture-key')
      .send({ ...searchBody, audience: 'MEMBER' })
      .expect(400);
    await request(app.getHttpServer() as Server)
      .post('/family-knowledge/search')
      .set('appkey', 'fixture-key')
      .send({ ...searchBody, memberRef: 'b'.repeat(64) })
      .expect(400);
    await request(app.getHttpServer() as Server)
      .post('/family-knowledge/search')
      .set('appkey', 'fixture-key')
      .send({ ...searchBody, sensitivity: 'SENSITIVE' })
      .expect(400);
    await request(app.getHttpServer() as Server)
      .post('/family-knowledge/search')
      .set('appkey', 'fixture-key')
      .send({ ...searchBody, limit: 6 })
      .expect(400);
  });
});
