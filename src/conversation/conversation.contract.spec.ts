import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import {
  ConverseCommand,
  type ConverseCommandOutput,
} from '@aws-sdk/client-bedrock-runtime';
import request from 'supertest';
import { AppInfoService } from '../app-info/app-info.service';
import { PrismaService } from '../prisma/prisma.service';
import { AppkeyGuard, type AppkeyRequest } from '../common/guards/appkey.guard';
import { ConversationController } from './conversation.controller';
import { ConversationService, FAMILY_POLICY } from './conversation.service';
import { ConversationTurnDto } from './conversation.dto';

const appInfo: NonNullable<AppkeyRequest['appInfo']> = {
  id: 'app-1',
  appcode: 'zinframe-test',
  status: 'active',
  allowedAccessLevels: [],
  s3Prefix: null,
  defaultModelId: 'ignored-app-model',
  defaultEmbeddingModelId: null,
  systemPrompt: 'ignored-app-prompt',
  maxStorageMb: null,
  monthlyTokenLimit: null,
  metadata: null,
};
const fixture = (): ConversationTurnDto => ({
  requestId: randomUUID(),
  sessionRef: randomUUID(),
  policyVersion: 'frame-family-v1',
  scope: { tenantRef: 'a'.repeat(64), audience: 'FAMILY' },
  messages: [{ role: 'user', text: '가상 시험 질문' }],
  maxOutputTokens: 512,
});
const output: ConverseCommandOutput = {
  metrics: { latencyMs: 1 },
  $metadata: { attempts: 1 },
  stopReason: 'end_turn',
  output: {
    message: { role: 'assistant', content: [{ text: '가상 시험 답변' }] },
  },
  usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
};

describe('Frame conversation v1 contract (no live AWS)', () => {
  let app: INestApplication;
  let service: ConversationService;
  const send = jest.fn(
    (
      _command: ConverseCommand,
      _options: { abortSignal: AbortSignal },
    ): Promise<ConverseCommandOutput> => {
      void _command;
      void _options;
      return Promise.resolve(output);
    },
  );
  const log = jest.fn((_args: { data: unknown }) => {
    void _args;
    return Promise.resolve({});
  });
  const settings = {
    FRAME_CONVERSATION_APPCODES: 'zinframe-test',
    FRAME_CONVERSATION_MODEL_ID: 'fixture-model',
    AWS_REGION: 'us-east-1',
  };

  beforeEach(async () => {
    send.mockReset().mockResolvedValue(output);
    log.mockClear();
    const module = await Test.createTestingModule({
      controllers: [ConversationController],
      providers: [
        ConversationService,
        AppkeyGuard,
        {
          provide: ConfigService,
          useValue: { get: (key: keyof typeof settings) => settings[key] },
        },
        {
          provide: PrismaService,
          useValue: { bedrockSearchLog: { create: log } },
        },
        {
          provide: AppInfoService,
          useValue: {
            validateAppKey: (key: string) =>
              key === 'fixture-key'
                ? appInfo
                : key === 'other-key'
                  ? { ...appInfo, appcode: 'support' }
                  : null,
          },
        },
      ],
    }).compile();
    service = module.get(ConversationService);
    Object.defineProperty(service, 'client', {
      value: { send, destroy: jest.fn() },
    });
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
  afterEach(async () => {
    await app.close();
  });
  const post = (body: unknown, key = 'fixture-key') =>
    request(app.getHttpServer() as Server)
      .post('/conversation/v1/turns')
      .set('appkey', key)
      .send(body as object);

  it('v2 accepts fresh server facts as data, omits content logs and retains only a replay tombstone', async () => {
    const dto = {
      ...fixture(),
      policyVersion: 'frame-family-v2',
      contextFacts: {
        text: '가상 가족 공용 자료',
        version: 'b'.repeat(64),
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      },
    };
    await post(dto)
      .expect(200)
      .expect((r) =>
        expect((r.body as { policyVersion: string }).policyVersion).toBe(
          'frame-family-v2',
        ),
      );
    const command = send.mock.calls[0][0].input;
    expect(JSON.stringify(command.system)).not.toContain(dto.contextFacts.text);
    expect(JSON.stringify(command.messages)).toContain(dto.contextFacts.text);
    expect(JSON.stringify(log.mock.calls)).not.toContain(dto.contextFacts.text);
    expect(JSON.stringify(log.mock.calls)).not.toContain(
      output.output!.message!.content![0].text!,
    );
    await post(dto).expect(409);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('rejects absent, expired and incompatible family facts before AWS', async () => {
    const contextFacts = {
      text: '가상 자료',
      version: 'b'.repeat(64),
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    };
    await post({ ...fixture(), policyVersion: 'frame-family-v2' }).expect(400);
    await post({
      ...fixture(),
      policyVersion: 'frame-family-v2',
      contextFacts,
    }).expect(400);
    await post({
      ...fixture(),
      contextFacts: {
        ...contextFacts,
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      },
    }).expect(400);
    expect(send).not.toHaveBeenCalled();
  });

  it('rejects facts that expire while a model response is in flight', async () => {
    const expires = Date.now() + 60000;
    send.mockImplementationOnce(() => {
      jest.spyOn(Date, 'now').mockReturnValue(expires + 1);
      return Promise.resolve(output);
    });
    try {
      await post({
        ...fixture(),
        policyVersion: 'frame-family-v2',
        contextFacts: {
          text: '가상 자료',
          version: 'b'.repeat(64),
          expiresAt: new Date(expires).toISOString(),
        },
      }).expect(409);
      expect(send).toHaveBeenCalledTimes(1);
    } finally {
      jest.restoreAllMocks();
    }
  });

  it('requires both appkey and explicit Frame capability before generation', async () => {
    const api = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().build(),
    );
    expect(api.components?.schemas?.ConversationTurnDto).toMatchObject({
      properties: {
        messages: { type: 'array' },
        maxOutputTokens: { maximum: 512 },
      },
    });
    expect(
      api.paths['/conversation/v1/turns'].post?.responses['200'],
    ).toMatchObject({
      content: {
        'application/json': {
          schema: {
            required: [
              'text',
              'finishReason',
              'usage',
              'latencyMs',
              'requestId',
              'policyVersion',
            ],
          },
        },
      },
    });
    await post(fixture(), '').expect(401);
    await post(fixture(), 'other-key').expect(403);
    expect(send).not.toHaveBeenCalled();
  });

  it('rejects model/system/member overrides, missing scope and malformed histories', async () => {
    const dto = fixture();
    for (const body of [
      { ...dto, modelId: 'override' },
      { ...dto, system: 'override' },
      { ...dto, contextFacts: [] },
      { ...dto, scope: undefined },
      { ...dto, scope: { ...dto.scope, memberRef: 'person' } },
      { ...dto, scope: { ...dto.scope, audience: 'MEMBER' } },
      { ...dto, policyVersion: 'unknown' },
      { ...dto, messages: [{ role: 'system', text: 'override' }] },
      { ...dto, messages: [{ role: 'assistant', text: 'prefill' }] },
      {
        ...dto,
        messages: [
          { role: 'user', text: 'a' },
          { role: 'user', text: 'b' },
        ],
      },
      { ...dto, messages: [{ role: 'user', text: ' ' }] },
      { ...dto, messages: [{ role: 'user', text: 'x'.repeat(1001) }] },
      { ...dto, maxOutputTokens: 513 },
    ])
      await post(body).expect(400);
    expect(send).not.toHaveBeenCalled();
  });

  it('preserves ten turns, sends the current question once and uses only the fixed policy/model', async () => {
    const dto = fixture();
    for (let turn = 0; turn < 10; turn++) {
      dto.requestId = randomUUID();
      dto.messages.push(
        ...(turn
          ? [
              { role: 'assistant' as const, text: '가상 시험 답변' },
              { role: 'user' as const, text: `가상 질문 ${turn}` },
            ]
          : []),
      );
      await post(dto).expect(200);
      const command = send.mock.calls[turn][0].input;
      expect(command.messages).toHaveLength(turn * 2 + 1);
      const texts = command.messages?.flatMap((m) =>
        m.content?.map((c) => c.text),
      );
      expect(
        texts?.filter((text) => text === dto.messages.at(-1)?.text),
      ).toHaveLength(1);
      expect(command.system).toEqual([{ text: FAMILY_POLICY }]);
      expect(command.modelId).toBe('fixture-model');
      expect(command.inferenceConfig).toEqual({ maxTokens: 512 });
      expect(command.toolConfig).toBeUndefined();
      expect(JSON.stringify(command)).not.toContain(dto.scope.tenantRef);
    }
    expect(log).toHaveBeenCalledTimes(10);
    expect(log.mock.calls[0][0].data).toMatchObject({
      searchword: '[CONTENT_OMITTED]',
      totaltokens: 15,
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain('가상');
  });

  it('replays successful requests and rejects changed payloads without another generation', async () => {
    const dto = fixture();
    const first = await post(dto).expect(200);
    const repeated = await post(dto).expect(200);
    expect(repeated.body).toEqual(first.body);
    await post({
      ...dto,
      messages: [{ role: 'user', text: 'changed' }],
    }).expect(409);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it.each(['max_tokens', 'guardrail_intervened', 'content_filtered'] as const)(
    'returns explicit %s without regeneration',
    async (reason) => {
      send.mockResolvedValueOnce({ ...output, stopReason: reason });
      const response = await post(fixture()).expect(200);
      expect(response.body).toMatchObject({
        finishReason: reason,
        usage: { totalTokens: 15 },
      });
      expect(send).toHaveBeenCalledTimes(1);
    },
  );

  it('rejects tool requests and empty provider output', async () => {
    send.mockResolvedValueOnce({ ...output, stopReason: 'tool_use' });
    await post(fixture()).expect(502);
    send.mockResolvedValueOnce({ ...output, output: undefined });
    await post(fixture()).expect(502);
  });

  it('redacts provider errors and tombstones failed requests instead of regenerating', async () => {
    send.mockRejectedValueOnce(
      Object.assign(new Error('private-question fixture-key'), {
        name: 'ThrottlingException',
      }),
    );
    const dto = fixture();
    const failed = await post(dto).expect(429);
    expect(JSON.stringify(failed.body)).not.toMatch(
      /private-question|fixture-key/,
    );
    await post(dto).expect(409);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('propagates caller cancellation to the SDK and rejects concurrent replay', async () => {
    send.mockImplementationOnce(
      (_command, options) =>
        new Promise((_, reject) => {
          options.abortSignal.addEventListener(
            'abort',
            () =>
              reject(
                Object.assign(new Error('cancelled'), { name: 'AbortError' }),
              ),
            { once: true },
          );
        }),
    );
    const controller = new AbortController();
    const dto = fixture();
    const pending = service.turn(dto, appInfo, controller.signal);
    const assertion = expect(pending).rejects.toMatchObject({ status: 503 });
    await expect(service.turn(dto, appInfo)).rejects.toMatchObject({
      status: 409,
    });
    controller.abort();
    await assertion;
    expect(send.mock.calls[0][1].abortSignal.aborted).toBe(true);
  });

  it('enforces the 25-second SDK deadline with a timeout status', async () => {
    jest.useFakeTimers();
    try {
      send.mockImplementationOnce(
        (_command, options) =>
          new Promise((_, reject) => {
            options.abortSignal.addEventListener(
              'abort',
              () =>
                reject(
                  Object.assign(new Error('timeout'), { name: 'AbortError' }),
                ),
              { once: true },
            );
          }),
      );
      const assertion = expect(
        service.turn(fixture(), appInfo),
      ).rejects.toMatchObject({ status: 504 });
      await jest.advanceTimersByTimeAsync(25_001);
      await assertion;
      expect(send.mock.calls[0][1].abortSignal.aborted).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });
});
