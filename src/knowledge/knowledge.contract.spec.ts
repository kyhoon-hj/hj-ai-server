import { ConfigService } from '@nestjs/config';
import { KnowledgeService } from './knowledge.service';

describe('KnowledgeService provider contract', () => {
  const createService = (options?: {
    rawMatches?: unknown[];
    rawError?: unknown;
    memoryMatches?: unknown[];
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
    const service = new KnowledgeService(
      config as unknown as ConfigService,
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      embeddingService as never,
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
      getCapturedQuery: () => capturedQuery,
      getLoggedRequestId: () => loggedRequestId,
    };
  };

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
    const { service, getLoggedRequestId } = createService();
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
        promptVersion: 'rag-answer-v2',
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
});
