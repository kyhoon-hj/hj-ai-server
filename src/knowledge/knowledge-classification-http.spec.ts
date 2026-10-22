import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import request from 'supertest';
import type { Server } from 'node:http';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeService } from './knowledge.service';
import { AppInfoService } from '../app-info/app-info.service';
import { ApiExposureGuard } from '../common/guards/api-exposure.guard';
import { CorrelationIdMiddleware } from '../common/http/correlation-id.middleware';

describe('classification HTTP and OpenAPI contract', () => {
  let app: INestApplication;
  const createRagResponse = jest.fn();
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [KnowledgeController],
      providers: [
        { provide: KnowledgeService, useValue: { createRagResponse } },
        {
          provide: AppInfoService,
          useValue: {
            validateAppKey: jest
              .fn()
              .mockResolvedValue({ appcode: 'test-app', status: 'active' }),
          },
        },
      ],
    })
      .overrideGuard(ApiExposureGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication();
    app.use(
      new CorrelationIdMiddleware().use.bind(new CorrelationIdMiddleware()),
    );
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
  });
  beforeEach(() => {
    createRagResponse
      .mockReset()
      .mockImplementation(
        (
          dto: { includeClassification?: boolean },
          _app: unknown,
          requestId: string,
        ) => ({
          requestId,
          ...(dto.includeClassification
            ? { classification: { status: 'skipped' } }
            : {}),
        }),
      );
  });
  afterAll(async () => {
    await app?.close();
  });

  describe.each(['answers', 'rag-response'])('%s', (route) => {
    it.each([undefined, false, true])(
      'accepts boolean %s and preserves correlation ID',
      async (includeClassification) => {
        const id = '6ca66f47-9b2e-4c78-919e-e65cbe5ad939';
        const response = await request(app.getHttpServer() as Server)
          .post(`/knowledge/${route}`)
          .set('appkey', 'fixture')
          .set('x-correlation-id', id)
          .send({ query: '문의', includeClassification })
          .expect(200);
        expect(response.body).toHaveProperty('requestId', id);
        expect(response.headers['x-correlation-id']).toBe(id);
        expect(Object.hasOwn(response.body as object, 'classification')).toBe(
          includeClassification === true,
        );
        expect(
          (
            (createRagResponse.mock.calls as unknown[][])[0][0] as {
              includeClassification?: boolean;
            }
          ).includeClassification,
        ).toBe(includeClassification);
      },
    );
    it.each(['false', 'true', 0, 1, null, {}, []])(
      'rejects invalid flag %j before service execution',
      async (includeClassification) => {
        await request(app.getHttpServer() as Server)
          .post(`/knowledge/${route}`)
          .set('appkey', 'fixture')
          .send({ query: '문의', includeClassification })
          .expect(400);
        expect(createRagResponse).not.toHaveBeenCalled();
      },
    );
    it('rejects missing authentication before service execution', async () => {
      await request(app.getHttpServer() as Server)
        .post(`/knowledge/${route}`)
        .send({ query: '문의', includeClassification: true })
        .expect(401);
      expect(createRagResponse).not.toHaveBeenCalled();
    });
  });
  it('documents both routes and all required summary fields', () => {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().build(),
    );
    for (const route of ['answers', 'rag-response'])
      expect(
        doc.paths[`/knowledge/${route}`].post?.responses['200'],
      ).toHaveProperty(
        'content.application/json.schema.$ref',
        '#/components/schemas/KnowledgeAnswerEntity',
      );
    const schemas = doc.components!.schemas!;
    expect(schemas.KnowledgeRagResponseDto).toHaveProperty(
      'properties.includeClassification.default',
      false,
    );
    expect(schemas.KnowledgeClassificationEntity).toHaveProperty('required', [
      'status',
      'category',
      'appliedCategory',
      'applied',
      'confidence',
      'selectedProbability',
      'minimumConfidence',
      'policyVersion',
      'durationMs',
      'reason',
      'errorCode',
      'outcome',
      'usage',
      'billing',
    ]);
  });
});
