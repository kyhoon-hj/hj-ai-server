import { Prisma } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { KnowledgeService } from './knowledge.service';
import type { JevService } from '../jev/jev.service';

describe('KnowledgeService provider contract', () => {
  const createService = (options?: {
    rawMatches?: unknown[];
    rawError?: unknown;
    memoryMatches?: unknown[];
    jev?: Partial<Pick<JevService, 'evaluateRag' | 'classifyInquiry'>>;
  }) => {
    let capturedQuery: unknown;
    let loggedRequestId: string | undefined;
    const queryLogCreate = jest.fn((args: { data: { requestId?: string } }) => {
      loggedRequestId = args.data.requestId;
      return Promise.resolve({});
    });
    const chunkFindMany = jest
      .fn()
      .mockResolvedValue(options?.memoryMatches ?? []);
    const queryRaw = jest.fn((query: unknown): Promise<unknown[]> => {
      capturedQuery = query;

      if (options?.rawError) {
        return Promise.reject(
          options.rawError instanceof Error
            ? options.rawError
            : new Error(
                typeof options.rawError === 'string'
                  ? options.rawError
                  : 'mock raw query error',
              ),
        );
      }
      return Promise.resolve(options?.rawMatches ?? []);
    });
    const prisma = {
      $queryRaw: queryRaw,
      knowledgeChunk: { findMany: chunkFindMany },
      knowledgeQueryLog: {
        create: queryLogCreate,
        aggregate: jest.fn().mockResolvedValue({ _sum: { totaltokens: 0 } }),
      },
    };
    const embeddingService = {
      getDefaultEmbeddingModelId: jest.fn().mockReturnValue('embed-v1'),
      createEmbedding: jest.fn().mockResolvedValue([1, 0]),
    };
    const config = {
      get: jest.fn((key: string) =>
        key === 'BEDROCK_MODEL_ID' ? 'model-v1' : undefined,
      ),
    };
    const quota = {
      begin: jest.fn().mockResolvedValue({ id: 'reservation' }),
      reserveTokens: jest.fn().mockResolvedValue(undefined),
      settle: jest.fn().mockResolvedValue(undefined),
      markUncertain: jest.fn().mockResolvedValue(undefined),
      recordUsage: jest.fn(
        (
          _reservation: unknown,
          write: (tx: Prisma.TransactionClient) => Promise<unknown>,
        ) =>
          write({
            knowledgeQueryLog: { create: queryLogCreate },
          } as unknown as Prisma.TransactionClient),
      ),
    };
    const service = new KnowledgeService(
      config as unknown as ConfigService,
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      embeddingService as never,
      quota as never,
      (options?.jev
        ? {
            classifyInquiry: jest.fn().mockResolvedValue(undefined),
            evaluateRag: jest.fn().mockResolvedValue(undefined),
            ...options.jev,
          }
        : undefined) as JevService | undefined,
    );
    const bedrockSend = jest.fn().mockResolvedValue({
      output: {
        message: {
          content: [
            {
              text: JSON.stringify({
                answerable: true,
                answer: '게시판 승인 답변을 참고하세요.',
                sourceIndexes: [1],
              }),
            },
          ],
        },
      },
      stopReason: 'end_turn',
      $metadata: { attempts: 2, totalRetryDelay: 12 },
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    });
    Object.defineProperty(service, 'bedrockClient', {
      value: { send: bedrockSend },
    });

    return {
      service,
      queryRaw,
      chunkFindMany,
      queryLogCreate,
      embeddingService,
      bedrockSend,
      quota,
      getCapturedQuery: () => capturedQuery,
      getLoggedRequestId: () => loggedRequestId,
    };
  };

  it.each([undefined, false, true])(
    'returns classification only for opt-in %s',
    async (includeClassification) => {
      const { service, bedrockSend, queryLogCreate } = createService();
      const result = await service.createRagResponse(
        { query: '문의', strict: true, includeClassification },
        'test-app',
        'classification-request',
      );
      expect(bedrockSend).not.toHaveBeenCalled();
      if (includeClassification)
        expect(result).toHaveProperty('classification.status', 'skipped');
      else expect(result).not.toHaveProperty('classification');
      expect(queryLogCreate.mock.calls[0][0]).toMatchObject({
        data: {
          requestId: result.requestId,
          execution: {
            classification: { status: 'skipped', policyVersion: null },
          },
        },
      });
    },
  );

  it('does not call classification, retrieval or generation when admission is rejected', async () => {
    const classifyInquiry = jest.fn();
    const { service, quota, bedrockSend, embeddingService } = createService({
      jev: { classifyInquiry },
    });
    quota.begin.mockRejectedValueOnce(
      new Error('APP_MONTHLY_REQUEST_LIMIT_EXCEEDED'),
    );
    await expect(
      service.createRagResponse(
        { query: '문의', includeClassification: true },
        'test-app',
      ),
    ).rejects.toThrow('APP_MONTHLY_REQUEST_LIMIT_EXCEEDED');
    expect(classifyInquiry).not.toHaveBeenCalled();
    expect(embeddingService.createEmbedding).not.toHaveBeenCalled();
    expect(bedrockSend).not.toHaveBeenCalled();
  });

  it.each([
    'answered',
    'insufficient_evidence',
    'invalid_model_response',
    'incomplete_model_response',
    'request_failed',
  ])('preserves classification and request ID for %s', async (status) => {
    const classification = {
      status: 'unavailable',
      policyVersion: 'inquiry-v1',
      minimumConfidence: 0.7,
      durationMs: 12,
      outcome: 'unknown',
      code: 'JEV_AI_INVALID_RESPONSE',
      applied: false,
      billing: { creditsCharged: 1 },
      usage: { inputTokens: 10, outputTokens: 2 },
    };
    const classifyInquiry = jest.fn().mockResolvedValue(classification);
    const { service, bedrockSend, queryLogCreate } = createService({
      jev: { classifyInquiry },
      rawMatches:
        status === 'insufficient_evidence'
          ? []
          : [
              {
                id: 'chunk-1',
                fileId: 'file-1',
                fileName: 'policy',
                key: 'private/key',
                content: '검수 자료',
                score: 0.9,
              },
            ],
    });
    if (status === 'invalid_model_response')
      bedrockSend.mockResolvedValueOnce({
        output: { message: { content: [{ text: 'not JSON' }] } },
        stopReason: 'end_turn',
      });
    if (status === 'incomplete_model_response')
      bedrockSend.mockResolvedValueOnce({
        output: { message: { content: [{ text: '{}' }] } },
        stopReason: 'max_tokens',
      });
    if (status === 'request_failed')
      bedrockSend.mockRejectedValueOnce(new Error('provider failed'));
    const pending = service.createRagResponse(
      { query: '문의', strict: true, includeClassification: true },
      'test-app',
      'classification-request',
    );
    let response:
      | Awaited<ReturnType<KnowledgeService['createRagResponse']>>
      | undefined;
    if (status === 'request_failed')
      await expect(pending).rejects.toThrow('provider failed');
    else response = await pending;
    const saved = queryLogCreate.mock.calls[0][0].data as unknown as {
      requestId: string;
      execution: { classification: unknown; jevClassification: unknown };
    };
    expect(saved.requestId).toBe('classification-request');
    expect(saved.execution.jevClassification).toEqual(classification);
    expect(saved.execution.classification).toMatchObject({
      status: 'unavailable',
      policyVersion: 'inquiry-v1',
      minimumConfidence: 0.7,
      errorCode: 'CLASSIFICATION_INVALID_RESPONSE',
      outcome: 'unknown',
      billing: { creditsCharged: 1, paidInputTokensUsed: null },
      usage: { inputTokens: 10, outputTokens: 2 },
    });
    if (response) {
      expect(response.answerStatus).toBe(status);
      expect(response.classification).toEqual(saved.execution.classification);
      expect(response.requestId).toBe(saved.requestId);
      if (status === 'answered')
        expect(response.usage).toMatchObject({ totalTokens: 15 });
    }
    expect(classifyInquiry).toHaveBeenCalledTimes(1);
    if (status === 'insufficient_evidence')
      expect(bedrockSend).not.toHaveBeenCalled();
  });

  it.each(['evaluated', 'unavailable'])(
    'records Jev %s separately while preserving the answer, citation mapping and Bedrock usage',
    async (status) => {
      const evaluateRag = jest.fn().mockResolvedValue({
        mode: 'shadow',
        status,
        usage: { inputTokens: 99 },
      });
      const { service, queryLogCreate, quota } = createService({
        jev: { evaluateRag },
        rawMatches: [
          {
            id: 'chunk-1',
            fileId: 'file-1',
            fileName: 'policy',
            key: 'private/key',
            content: '문을 오전 10시에 엽니다.',
            score: 0.5,
          },
        ],
      });
      const result = await service.createRagResponse(
        { query: '운영시간은?' },
        'test-app',
      );
      expect(result).toMatchObject({
        answer: '게시판 승인 답변을 참고하세요.',
        answerable: true,
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        sources: [{ index: 1, chunkId: 'chunk-1' }],
      });
      expect(result).not.toHaveProperty('jev');
      expect(evaluateRag).toHaveBeenCalledWith(
        expect.objectContaining({
          appcode: 'test-app',
          sourceIndexes: [1],
          answerable: true,
        }),
      );
      const log = queryLogCreate.mock.calls[0][0] as unknown as {
        data: { totaltokens: number; execution: { jev: { status: string } } };
      };
      expect(log.data.totaltokens).toBe(15);
      expect(log.data.execution.jev.status).toBe(status);
      expect(quota.settle).toHaveBeenCalledWith(expect.anything(), 15);
    },
  );

  it.each(['classified', 'unavailable'])(
    'classifies before retrieval and generation, with safe guidance or fallback for %s',
    async (status) => {
      const classification =
        status === 'classified'
          ? {
              mode: 'classify',
              status,
              category: 'refund_exchange',
              appliedCategory: 'refund_exchange',
              applied: true,
              usage: { inputTokens: 80 },
              billing: { creditsCharged: 1 },
            }
          : {
              mode: 'classify',
              status,
              applied: false,
              code: 'JEV_AI_BALANCE_REQUIRED',
            };
      const classifyInquiry = jest.fn().mockResolvedValue(classification);
      const { service, embeddingService, bedrockSend, queryLogCreate, quota } =
        createService({
          jev: { classifyInquiry },
          rawMatches: [
            {
              id: 'chunk-1',
              fileId: 'file-1',
              fileName: 'policy',
              key: 'private/key',
              content: '교환 기한은 7일입니다.',
              score: 0.9,
            },
          ],
        });
      const response = await service.createRagResponse(
        { query: '8일 전 구매한 상품 교환 가능?' },
        'test-app',
      );
      expect(classifyInquiry).toHaveBeenCalledWith({
        appcode: 'test-app',
        query: '8일 전 구매한 상품 교환 가능?',
        signal: undefined,
      });
      expect(classifyInquiry.mock.invocationCallOrder[0]).toBeLessThan(
        embeddingService.createEmbedding.mock.invocationCallOrder[0],
      );
      expect(classifyInquiry.mock.invocationCallOrder[0]).toBeLessThan(
        bedrockSend.mock.invocationCallOrder[0],
      );
      const calls = bedrockSend.mock.calls as unknown as [
        { input: { system: { text: string }[] } },
      ][];
      const system = calls[0][0].input.system;
      expect(system).toHaveLength(status === 'classified' ? 3 : 2);
      if (status === 'classified') expect(system[2].text).toContain('기한');
      const saved = queryLogCreate.mock.calls[0][0] as unknown as {
        data: { execution: Record<string, unknown> };
      };
      expect(saved.data.execution.jevClassification).toEqual(classification);
      expect(response.usage?.totalTokens).toBe(15);
      expect(quota.settle).toHaveBeenCalledWith(expect.anything(), 15);
      expect(response).not.toHaveProperty('jevClassification');
    },
  );

  it('does not bypass strict no-evidence handling after successful classification', async () => {
    const classifyInquiry = jest.fn().mockResolvedValue({
      mode: 'classify',
      status: 'classified',
      appliedCategory: 'product',
      applied: true,
    });
    const { service, bedrockSend, queryLogCreate } = createService({
      jev: { classifyInquiry },
    });
    const response = await service.createRagResponse(
      { query: '가격은?', strict: true },
      'test-app',
    );
    expect(response.answerable).toBe(false);
    expect(bedrockSend).not.toHaveBeenCalled();
    const saved = queryLogCreate.mock.calls[0][0] as unknown as {
      data: { totaltokens: number; execution: Record<string, unknown> };
    };
    expect(saved.data.totaltokens).toBe(0);
    expect(saved.data.execution.jevClassification).toMatchObject({
      status: 'classified',
    });
  });

  it.each(['answer', 'no-answer', 'generation-error'])(
    'omits Frame content at the query log sink for %s',
    async (mode) => {
      const { service, bedrockSend, queryLogCreate, quota } = createService();
      if (mode === 'generation-error')
        bedrockSend.mockRejectedValueOnce(new Error('private provider detail'));
      const result = service.createRagResponse(
        { query: 'private family question', strict: mode === 'no-answer' },
        'zinframe-test',
      );
      if (mode === 'generation-error') await expect(result).rejects.toThrow();
      else await result;
      expect(quota.recordUsage).toHaveBeenCalledTimes(1);
      expect(quota.recordUsage.mock.calls[0][0]).toEqual({ id: 'reservation' });
      if (mode === 'generation-error')
        expect(quota.markUncertain).toHaveBeenCalledWith({ id: 'reservation' });
      const data = queryLogCreate.mock.calls[0][0].data;
      expect(data).toMatchObject({
        question: '[CONTENT_OMITTED]',
        matchedChunkIds: [],
      });
      expect(data).not.toHaveProperty('response', expect.any(String));
      expect(data).not.toHaveProperty('execution', expect.any(Object));
      expect(JSON.stringify(data)).not.toContain('private');
    },
  );

  it.each(['answer', 'no-answer', 'retrieval-error', 'generation-error'])(
    'records separate monotonic stage timings for %s',
    async (mode) => {
      const { service, embeddingService, bedrockSend, queryLogCreate } =
        createService();
      const reply: unknown = await bedrockSend();
      bedrockSend.mockClear();
      const failure = new Error('synthetic stage failure');
      jest.useFakeTimers();
      try {
        embeddingService.createEmbedding.mockImplementationOnce(() => {
          jest.advanceTimersByTime(25);
          return mode === 'retrieval-error'
            ? Promise.reject(failure)
            : Promise.resolve([1, 0]);
        });
        bedrockSend.mockImplementationOnce(() => {
          jest.advanceTimersByTime(40);
          return mode === 'generation-error'
            ? Promise.reject(failure)
            : Promise.resolve(reply);
        });
        const response = service.createRagResponse(
          {
            query: 'stage timing fixture',
            strict: mode === 'no-answer',
            maxTokens: 257,
          },
          'APP_A',
        );
        const expected = {
          retrievalMs: 25,
          generationMs: ['answer', 'generation-error'].includes(mode) ? 40 : 0,
          maxTokens: 257,
        };
        if (mode.endsWith('-error'))
          await expect(response).rejects.toBe(failure);
        else {
          const answer = await response;
          expect(answer.performance).toEqual(expected);
          if (mode === 'answer') {
            expect(answer.sdk).toEqual({
              scope: 'generation',
              attempts: 2,
              retryCount: 1,
              totalRetryDelayMs: 12,
            });
            expect(queryLogCreate.mock.calls[0][0].data).toMatchObject({
              execution: { sdk: answer.sdk },
            });
          }
        }
        expect(queryLogCreate.mock.calls[0][0].data).toMatchObject({
          execution: { performance: expected },
        });
        expect(bedrockSend).toHaveBeenCalledTimes(
          expected.generationMs ? 1 : 0,
        );
      } finally {
        jest.useRealTimers();
      }
    },
  );

  it('TS-CON-001/002 applies public, published, product and active-period filters', async () => {
    const { service, getCapturedQuery } = createService();
    const activeAt = '2026-07-18T00:00:00.000Z';

    await service.search(
      {
        query: '배송 정책',
        filters: {
          accessLevels: ['PUBLIC'],
          businessStatuses: ['PUBLISHED'],
          productCodes: [' PRODUCT_A ', 'PRODUCT_A'],
          activeAt,
        },
      },
      {
        appcode: 'HJ_CUSTOMER_SUPPORT_DEMO',
        defaultEmbeddingModelId: 'embed-v1',
        allowedAccessLevels: ['PUBLIC'],
      },
    );

    const query = getCapturedQuery() as {
      strings: string[];
      values: unknown[];
    };
    const sql = query.strings.join('?');

    expect(sql).toContain('kf."access_level"::text IN');
    expect(sql).toContain('kf."business_status"::text IN');
    expect(sql).toContain('cardinality(kf."product_codes") = 0');
    expect(sql).toContain('kf."effective_from" <=');
    expect(sql).toContain('kf."effective_to" >');
    expect(query.values).toContain('PUBLIC');
    expect(query.values).toContain('PUBLISHED');
    expect(query.values).toContain('PRODUCT_A');
    expect(query.values).toContain('HJ_CUSTOMER_SUPPORT_DEMO');
  });

  it('TS-CON-002 enforces app access policy even when caller omits filters', async () => {
    const { service, getCapturedQuery } = createService();

    await service.search(
      { query: '공개 정책' },
      {
        appcode: 'HJ_CUSTOMER_SUPPORT_DEMO',
        defaultEmbeddingModelId: 'embed-v1',
        allowedAccessLevels: ['PUBLIC'],
      },
    );

    const query = getCapturedQuery() as {
      strings: string[];
      values: unknown[];
    };

    expect(query.strings.join('?')).toContain('kf."access_level"::text IN');
    expect(query.values).toContain('PUBLIC');
  });

  it('TS-CON-002 denies a requested level outside the server policy without searching', async () => {
    const { service, queryRaw, embeddingService } = createService();

    const result = await service.search(
      {
        query: '내부 정책',
        filters: { accessLevels: ['INTERNAL'] },
      },
      {
        appcode: 'HJ_CUSTOMER_SUPPORT_DEMO',
        defaultEmbeddingModelId: 'embed-v1',
        allowedAccessLevels: ['PUBLIC'],
      },
    );

    expect(result).toEqual({ query: '내부 정책', count: 0, matches: [] });
    expect(embeddingService.createEmbedding).not.toHaveBeenCalled();
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('TS-CON-003 returns the compatible strict no-answer shape and logs request ID', async () => {
    const { service, getLoggedRequestId, queryLogCreate } = createService();
    const requestId = 'd594d4d0-d5e5-4b74-9c5a-e0f0bf282d72';

    const result = await service.createRagResponse(
      {
        query: '근거 없는 질문',
        strict: true,
        includeSources: true,
        noAnswerMessage: '담당자 검토가 필요합니다.',
      },
      {
        appcode: 'HJ_CUSTOMER_SUPPORT_DEMO',
        defaultModelId: 'model-v1',
        defaultEmbeddingModelId: 'embed-v1',
        systemPrompt: null,
        monthlyTokenLimit: null,
        allowedAccessLevels: ['PUBLIC'],
      },
      requestId,
    );

    expect(result).toMatchObject({
      query: '근거 없는 질문',
      answer: '담당자 검토가 필요합니다.',
      response: '담당자 검토가 필요합니다.',
      answerable: false,
      usage: null,
      requestId,
      sources: [],
      retrieval: { count: 0, limit: 5, scoreThreshold: null },
    });
    expect(getLoggedRequestId()).toBe(requestId);
    expect(queryLogCreate.mock.calls[0][0].data).toMatchObject({
      execution: {
        promptVersion: 'rag-answer-v3-partial',
        modelId: 'model-v1',
        embeddingModel: 'embed-v1',
        inferenceConfig: { maxTokens: 1024, temperature: 0.2 },
        retrieval: {
          limit: 5,
          scoreThreshold: -1,
          filters: { accessLevels: ['PUBLIC'] },
        },
        answerStatus: 'insufficient_evidence',
        modelInvoked: false,
        retrievedSources: [],
        citedSourceIndexes: [],
      },
    });
  });

  it('uses an approved support board answer as a supplemental grounded source', async () => {
    const { service, bedrockSend } = createService();

    const result = await service.createRagResponse(
      {
        query: '제품 설치 방법을 알려주세요.',
        strict: true,
        includeSources: true,
        supplementalSources: [
          {
            sourceType: 'SUPPORT_BOARD_APPROVED_ANSWER',
            sourceId: '10000000-0000-4000-8000-000000000001',
            title: '제품 설치 방법',
            content: '전원을 연결한 후 설치 마법사를 실행하세요.',
            publishedAt: '2026-07-20T00:00:00.000Z',
            relevanceScore: 0.82,
            productCode: 'PRODUCT_A',
          },
        ],
      },
      {
        appcode: 'HJ_CUSTOMER_SUPPORT_DEMO',
        defaultModelId: 'model-v1',
        defaultEmbeddingModelId: 'embed-v1',
        systemPrompt: null,
        monthlyTokenLimit: null,
        allowedAccessLevels: ['PUBLIC'],
      },
    );

    expect(bedrockSend).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      answerable: true,
      retrieval: { count: 0, supplementalCount: 1 },
      sources: [
        {
          sourceType: 'SUPPORT_BOARD_APPROVED_ANSWER',
          fileId: '10000000-0000-4000-8000-000000000001',
          score: 0.82,
        },
      ],
    });
  });

  it.each([
    [
      'insufficient_evidence',
      JSON.stringify({
        answerable: false,
        answer: '자료 없음',
        sourceIndexes: [],
      }),
      'end_turn',
    ],
    ['invalid_model_response', 'not JSON', 'end_turn'],
    [
      'incomplete_model_response',
      JSON.stringify({
        answerable: true,
        answer: 'partial',
        sourceIndexes: [1],
      }),
      'max_tokens',
    ],
  ])(
    'returns safe text and no sources for %s despite retrieved evidence',
    async (answerStatus, text, stopReason) => {
      const { service, bedrockSend, queryLogCreate } = createService();
      bedrockSend.mockResolvedValueOnce({
        output: { message: { content: [{ text }] } },
        stopReason,
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      });
      const result = await service.createRagResponse(
        {
          query: '자료에 없는 질문',
          noAnswerMessage: '담당자 확인이 필요합니다.',
          supplementalSources: [
            {
              sourceType: 'SUPPORT_BOARD_APPROVED_ANSWER',
              sourceId: '10000000-0000-4000-8000-000000000001',
              title: '설치',
              content: '전원을 연결하세요.',
              publishedAt: '2026-07-20T00:00:00.000Z',
              relevanceScore: 0.8,
            },
          ],
        },
        'APP_A',
      );
      expect(result).toMatchObject({
        answerable: false,
        answerStatus,
        promptVersion: 'rag-answer-v3-partial',
        stopReason,
        answer: '담당자 확인이 필요합니다.',
        response: '담당자 확인이 필요합니다.',
        sources: [],
        retrieval: { supplementalCount: 1 },
        usage: { totalTokens: 15 },
      });
      expect(queryLogCreate.mock.calls[0][0].data).toMatchObject({
        response: '담당자 확인이 필요합니다.',
        totaltokens: 15,
        execution: {
          answerStatus,
          stopReason,
          modelInvoked: true,
          citedSourceIndexes: [],
        },
      });
    },
  );

  it('keeps source suppression and no-evidence safety when strict is false', async () => {
    const { service, bedrockSend } = createService();
    const result = await service.createRagResponse(
      { query: '없는 자료', strict: false, includeSources: false },
      'APP_A',
    );
    expect(bedrockSend).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      answerable: false,
      sources: undefined,
      answerStatus: 'invalid_model_response',
    });
  });

  it('returns only cited sources while preserving retrieval counts and indexes', async () => {
    const { service, bedrockSend } = createService();
    bedrockSend.mockResolvedValueOnce({
      output: {
        message: {
          content: [
            {
              text: JSON.stringify({
                answerable: true,
                answer: '전원을 연결하세요.',
                sourceIndexes: [2],
              }),
            },
          ],
        },
      },
      stopReason: 'end_turn',
    });
    const result = await service.createRagResponse(
      {
        query: '설치 방법',
        system: '한국어로 답하세요.',
        includeSourceContent: true,
        supplementalSources: [1, 2].map((index) => ({
          sourceType: 'SUPPORT_BOARD_APPROVED_ANSWER' as const,
          sourceId: `source-${index}`,
          title: '설치',
          content: '전원을 연결하세요.',
          publishedAt: '2026-07-20T00:00:00.000Z',
          relevanceScore: 0.8,
        })),
      },
      'APP_A',
    );
    expect(result.retrieval.supplementalCount).toBe(2);
    expect(result.sources).toHaveLength(1);
    expect(result.sources?.[0]).toMatchObject({
      index: 2,
      fileId: 'source-2',
      content: '전원을 연결하세요.',
    });
    const calls = bedrockSend.mock.calls as unknown as [
      { input: { system: { text: string }[] } },
    ][];
    const command = calls[0][0];
    expect(command.input.system).toHaveLength(2);
    expect(command.input.system[1].text).toContain('출력 계약');
  });

  it.each(['retrieval', 'generation'])(
    'preserves the original %s error and records its execution context',
    async (stage) => {
      const { service, embeddingService, bedrockSend, queryLogCreate } =
        createService();
      const failure = new Error('Provider error with sensitive detail');
      if (stage === 'retrieval')
        embeddingService.createEmbedding.mockRejectedValueOnce(failure);
      else bedrockSend.mockRejectedValueOnce(failure);
      await expect(
        service.createRagResponse(
          { query: 'question', strict: false },
          'APP_A',
          'failure-id',
        ),
      ).rejects.toBe(failure);
      const data = queryLogCreate.mock.calls[0][0].data;
      expect(data).toMatchObject({
        requestId: 'failure-id',
        execution: {
          answerStatus: 'request_failed',
          errorCode: 'REQUEST_FAILED',
          failedStage: stage,
          modelId: 'model-v1',
          generationAttempted: stage === 'generation',
        },
      });
      expect(JSON.stringify(data)).not.toContain('sensitive detail');
    },
  );

  it('snapshots effective overrides and legacy provenance without leaking them into the model or sources', async () => {
    const match = {
      id: 'chunk-a',
      fileId: 'file-a',
      fileName: 'a.md',
      key: 'a',
      content: 'Original evidence',
      score: 0.9,
      metadata: null,
    };
    const { service, bedrockSend, queryLogCreate } = createService({
      rawMatches: [match],
    });
    const response = await service.createRagResponse(
      {
        query: 'question',
        modelId: 'override-model',
        system: 'private system text',
        maxTokens: 200,
        temperature: 0,
        limit: 2,
        scoreThreshold: 0.4,
      },
      'APP_A',
      'trace-id',
    );
    expect(queryLogCreate.mock.calls[0][0].data).toMatchObject({
      execution: {
        modelId: 'override-model',
        inferenceConfig: { maxTokens: 200, temperature: 0 },
        retrieval: { limit: 2, scoreThreshold: 0.4 },
        answerStatus: 'answered',
        retrievedSources: [
          { chunkId: 'chunk-a', fileId: 'file-a', indexProvenance: null },
        ],
        citedSourceIndexes: [1],
      },
    });
    expect(JSON.stringify(queryLogCreate.mock.calls[0][0].data)).not.toContain(
      'private system text',
    );
    expect(JSON.stringify(response)).not.toContain('execution');
    const calls = bedrockSend.mock.calls as unknown as [
      { input: { messages: { content: { text: string }[] }[] } },
    ][];
    expect(calls[0][0].input.messages[0].content[0].text).not.toContain(
      'indexProvenance',
    );
  });

  it('TS-CON-004 keeps the unfiltered legacy search path unchanged', async () => {
    const { service, chunkFindMany } = createService({
      rawError: new Error('relation "knowledge_chunk" does not exist'),
    });

    await service.search({ query: 'legacy query' }, 'LEGACY_APP');

    expect(chunkFindMany).toHaveBeenCalledWith({
      where: {
        appcode: 'LEGACY_APP',
        embedding: { isEmpty: false },
        embeddingModel: 'embed-v1',
        file: { status: 'indexed' },
      },
      include: { file: true },
    });
  });

  it('TS-CON-005 always binds the authenticated appcode in provider queries', async () => {
    const { service, getCapturedQuery } = createService();

    await service.search(
      { query: 'tenant boundary' },
      {
        appcode: 'APP_A',
        defaultEmbeddingModelId: 'embed-v1',
        allowedAccessLevels: [],
      },
    );

    const query = getCapturedQuery() as { values: unknown[] };
    expect(query.values).toContain('APP_A');
    expect(query.values).not.toContain('APP_B');
  });
  it('retains uncertain quota when the provider did not report total tokens', async () => {
    const { service, bedrockSend, quota } = createService();
    bedrockSend.mockResolvedValue({
      output: { message: { content: [{ text: 'answer' }] } },
      stopReason: 'end_turn',
    });
    await service.createRagResponse(
      { query: 'question', strict: false },
      'SUPPORT',
    );
    expect(quota.markUncertain).toHaveBeenCalledWith({ id: 'reservation' });
    expect(quota.settle).not.toHaveBeenCalled();
    expect(quota.begin).toHaveBeenCalledWith(
      expect.objectContaining({ operationScope: 'knowledge.answer' }),
    );
  });

  it('records known zero generation tokens for no-answer without invoking the model', async () => {
    const { service, bedrockSend, quota, queryLogCreate } = createService();
    await service.createRagResponse(
      { query: 'question', strict: true },
      'SUPPORT',
    );
    expect(bedrockSend).not.toHaveBeenCalled();
    expect(queryLogCreate.mock.calls[0][0].data).toMatchObject({
      totaltokens: 0,
    });
    expect(quota.settle).toHaveBeenCalledWith({ id: 'reservation' }, 0);
  });
});
