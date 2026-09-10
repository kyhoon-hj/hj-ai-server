import { Controller, Get, Param, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type {
  ConverseCommand,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import request from 'supertest';
import type { App } from 'supertest/types';
import { KnowledgeService } from '../src/knowledge/knowledge.service';
import { EmbeddingService } from '../src/knowledge/embedding.service';
import { AwsMetricsInterceptor } from '../src/common/http/aws-metrics.interceptor';
import { StructuredHttpExceptionFilter } from '../src/common/http/structured-http-exception.filter';
import { KnowledgeController } from '../src/knowledge/knowledge.controller';
import { AppInfoService } from '../src/app-info/app-info.service';
import { createHash, createHmac } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { ValidationPipe } from '@nestjs/common';

const secret = 'synthetic-integration-secret';
const unsigned = `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')}.${Buffer.from('{"sub":"fixture"}').toString('base64url')}`;
const fixtureKey = `${unsigned}.${createHmac('sha256', secret).update(unsigned).digest('base64url')}`;

@Controller('fixture/rag')
class FixtureController {
  constructor(private readonly knowledge: KnowledgeService) {}
  @Get(':mode')
  answer(@Param('mode') mode: string) {
    return this.knowledge.createRagResponse(
      { query: mode, strict: mode === 'noanswer' },
      'FIXTURE',
    );
  }
}

describe('RAG request SDK metrics over HTTP (synthetic providers)', () => {
  let app: INestApplication<App>;
  let sdkCalls = 0;
  beforeAll(async () => {
    const config = new ConfigService({
      BEDROCK_MODEL_ID: 'fixture',
      AWS_REQUEST_TIMEOUT_MS: '100',
      APPKEY_JWT_SECRET: secret,
    });
    const embedding = new EmbeddingService(config);
    Object.defineProperty(embedding, 'bedrockClient', {
      value: {
        send: async (command: InvokeModelCommand) => {
          sdkCalls++;
          const input = JSON.parse(
            typeof command.input.body === 'string'
              ? command.input.body
              : new TextDecoder().decode(command.input.body as Uint8Array),
          ) as {
            inputText: string;
          };
          await new Promise((resolve) => setTimeout(resolve, 5));
          return {
            body: Buffer.from('{"embedding":[1,0]}'),
            $metadata: {
              attempts: input.inputText === 'other' ? 4 : 2,
              totalRetryDelay: 10,
            },
          };
        },
      },
    });
    const prisma = {
      $queryRaw: () => Promise.resolve([]),
      knowledgeChunk: { findMany: () => Promise.resolve([]) },
      knowledgeQueryLog: {
        create: () => Promise.resolve({}),
        aggregate: () => Promise.resolve({ _sum: { totaltokens: 0 } }),
      },
    };
    const knowledge = new KnowledgeService(
      config,
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      embedding,
    );
    Object.defineProperty(knowledge, 'bedrockClient', {
      value: {
        send: (
          command: ConverseCommand,
          options: { abortSignal: AbortSignal },
        ) => {
          sdkCalls++;
          const prompt = JSON.stringify(command.input.messages);
          if (prompt.includes('timeout'))
            return new Promise((_, reject) =>
              options.abortSignal.addEventListener(
                'abort',
                () =>
                  reject(
                    Object.assign(new Error('aborted'), { name: 'AbortError' }),
                  ),
                { once: true },
              ),
            );
          if (prompt.includes('failure'))
            return Promise.reject(
              Object.assign(new Error('synthetic provider failure'), {
                $metadata: { attempts: 3, totalRetryDelay: 20 },
              }),
            );
          return Promise.resolve({
            output: {
              message: {
                content: [
                  {
                    text: '{"answerable":false,"answer":"No evidence","sourceIndexes":[]}',
                  },
                ],
              },
            },
            stopReason: 'end_turn',
            $metadata: { attempts: 1, totalRetryDelay: 0 },
          });
        },
      },
    });
    const module = await Test.createTestingModule({
      controllers: [FixtureController, KnowledgeController],
      providers: [
        { provide: KnowledgeService, useValue: knowledge },
        { provide: ConfigService, useValue: config },
        {
          provide: AppInfoService,
          useValue: new AppInfoService(
            {
              appInfo: {
                findFirst: () =>
                  Promise.resolve({
                    id: 'fixture',
                    appcode: 'FIXTURE',
                    status: 'active',
                    allowedAccessLevels: ['PUBLIC'],
                    appkeyHash: createHash('sha256')
                      .update(fixtureKey)
                      .digest('hex'),
                    defaultModelId: null,
                    defaultEmbeddingModelId: null,
                    systemPrompt: null,
                    monthlyTokenLimit: null,
                  }),
              },
            } as never,
            config,
            {} as never,
          ),
        },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalInterceptors(new AwsMetricsInterceptor());
    app.useGlobalFilters(new StructuredHttpExceptionFilter());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });
  it('rejects missing and invalid appkeys before SDK calls on the production route', async () => {
    const before = sdkCalls;
    await request(app.getHttpServer())
      .post('/knowledge/answers')
      .send({ query: 'success' })
      .expect(401);
    await request(app.getHttpServer())
      .post('/knowledge/answers')
      .set('appkey', 'invalid')
      .send({ query: 'success' })
      .expect(401);
    expect(sdkCalls).toBe(before);
    const response = await request(app.getHttpServer())
      .post('/knowledge/answers')
      .set('appkey', fixtureKey)
      .send({ query: 'success', strict: false })
      .expect(200);
    expect(response.body).toMatchObject({ awsRequest: { attempts: 3 } });
  });

  (process.env.RUN_DEMO_METRICS_E2E === 'true' ? it : it.skip)(
    'passes authenticated RAG outcomes through the actual demo report API',
    async () => {
      const probe = createServer();
      await new Promise<void>((resolve, reject) => {
        probe.once('error', reject);
        probe.listen(11001, '127.0.0.1', resolve);
      });
      await new Promise<void>((resolve) => probe.close(() => resolve()));
      await app.listen(0, '127.0.0.1');
      const child = spawn(process.execPath, ['demo/server.mjs'], {
        cwd: process.cwd(),
        windowsHide: true,
        env: {
          ...process.env,
          AI_SERVER_BASE_URL: await app.getUrl(),
          AI_SERVER_APPKEY: fixtureKey,
          DEMO_HOST: '127.0.0.1',
          DEMO_PORT: '11001',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const exit = new Promise<void>((resolve) =>
        child.once('exit', () => resolve()),
      );
      try {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error('Demo startup timeout')),
            10000,
          );
          child.stdout.on('data', (chunk: Buffer) => {
            if (chunk.toString().includes('Demo Console:')) {
              clearTimeout(timer);
              resolve();
            }
          });
          child.once('error', (error) => {
            clearTimeout(timer);
            reject(error);
          });
          child.once('exit', () => {
            clearTimeout(timer);
            reject(new Error('Demo exited before ready'));
          });
        });
        const run = async (query: string) => {
          const response = await fetch(
            'http://127.0.0.1:11001/api/performance/run',
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                operationId: 'knowledge.answers',
                total: 2,
                concurrency: 2,
                body: { query, strict: false },
              }),
            },
          );
          expect(response.status).toBe(200);
          return (await response.json()) as {
            summary: {
              successRate: number;
              awsRequest: {
                attempts: { p95: number | null };
                reportedRequests: number;
              };
            };
            reportFile: string;
          };
        };
        expect((await run('success')).summary).toMatchObject({
          successRate: 100,
          awsRequest: { attempts: { p95: 3 }, completeRequests: 2 },
        });
        expect((await run('failure')).summary).toMatchObject({
          successRate: 0,
          awsRequest: { attempts: { p95: 5 } },
        });
        expect((await run('timeout')).summary).toMatchObject({
          successRate: 0,
          awsRequest: { attempts: { p95: null }, completeRequests: 0 },
        });
        const before = sdkCalls;
        const configResponse = await fetch(
          'http://127.0.0.1:11001/api/config',
          {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ appkey: 'invalid' }),
          },
        );
        expect(configResponse.status).toBe(200);
        expect((await run('success')).summary).toMatchObject({
          successRate: 0,
          statusCounts: { '401': 2 },
          awsRequest: { reportedRequests: 0 },
        });
        expect(sdkCalls).toBe(before);
      } finally {
        child.kill();
        await exit;
      }
    },
    20000,
  );
  it('isolates simultaneous requests through embedding and generation', async () => {
    const [first, second] = await Promise.all(
      ['success', 'other'].map((mode) =>
        request(app.getHttpServer()).get(`/fixture/rag/${mode}`).expect(200),
      ),
    );
    expect(first.body).toMatchObject({
      awsRequest: { operations: 2, attempts: 3, retryCount: 1, complete: true },
    });
    expect(second.body).toMatchObject({
      awsRequest: { operations: 2, attempts: 5, retryCount: 3, complete: true },
    });
  });
  it('includes successful retrieval before a failed generation', async () => {
    const response = await request(app.getHttpServer())
      .get('/fixture/rag/failure')
      .expect(500);
    expect(response.body).toMatchObject({
      awsRequest: { operations: 2, attempts: 5, retryCount: 3 },
      sdk: { scope: 'failed-call', attempts: 3 },
    });
  });
  it('keeps deadline measurement incomplete rather than reporting a partial total', async () => {
    const response = await request(app.getHttpServer())
      .get('/fixture/rag/timeout')
      .expect(504);
    expect(response.body).toMatchObject({
      code: 'AWS_REQUEST_TIMEOUT',
      awsRequest: {
        operations: 2,
        completedOperations: 2,
        measuredOperations: 1,
        attempts: null,
        complete: false,
      },
    });
  });
  it('counts retrieval only for strict no-answer', async () => {
    const response = await request(app.getHttpServer())
      .get('/fixture/rag/noanswer')
      .expect(200);
    expect(response.body).toMatchObject({
      answerable: false,
      awsRequest: { operations: 1, attempts: 2, complete: true },
    });
  });
});
