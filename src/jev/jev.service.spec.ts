import { ConfigService } from '@nestjs/config';
import { JevService } from './jev.service';
import { JevClient, JevError } from './jev-client';
import { summarizeClassification } from './jev-classification-summary';
import { createJevInquiryGuidance } from './jev-inquiry-policy';

describe('Jev RAG shadow evaluation', () => {
  const input = {
    appcode: 'test-app',
    query: '운영시간은?',
    answer: '오전 10시입니다.',
    answerable: true,
    sourceIndexes: [1],
    sources: [
      {
        content: '오전 10시에 영업을 시작합니다.',
        key: 'private/key',
        metadata: { private: true },
      },
    ],
  };
  const create = (config: Record<string, string> = {}) =>
    new JevService(
      new ConfigService({
        JEV_AI_RAG_MODE: 'shadow',
        JEV_AI_API_KEY: 'test-only-key',
        JEV_AI_RAG_APPCODES: 'test-app',
        ...config,
      }),
    );
  afterEach(() => jest.restoreAllMocks());

  it('sends only the inquiry once before generation and disables the shadow call in classify mode', async () => {
    const decide = jest.spyOn(JevClient.prototype, 'decide').mockResolvedValue({
      model: 'jev-1.13.0',
      answers: {
        intent: {
          type: 'choice',
          choice: 'store_info',
          confidence: 0.99,
          probabilities: { store_info: 0.99 },
        },
      },
      usage: { inputTokens: 100, outputTokens: 10, cost: null },
      billing: {
        mode: 'credits-fallback',
        creditsCharged: 1,
        creditsRemaining: 7,
        paidInputTokensUsed: 0,
        tokensRemaining: 0,
        modelMultiplier: 1,
      },
    });
    const service = create({ JEV_AI_RAG_MODE: 'classify' });
    const result = await service.classifyInquiry(input);
    expect(result).toMatchObject({
      status: 'classified',
      category: 'store_info',
      appliedCategory: 'store_info',
      applied: true,
      billing: { creditsCharged: 1 },
    });
    expect(summarizeClassification(result)).toMatchObject({
      status: 'classified',
      confidence: 0.99,
      selectedProbability: 0.99,
      outcome: 'succeeded',
      reason: null,
      policyVersion: 'inquiry-v1',
    });
    expect(decide.mock.calls[0][0]).toEqual({ query: input.query });
    expect(Object.keys(decide.mock.calls[0][1])).toEqual(['intent']);
    expect(await service.evaluateRag(input)).toBeUndefined();
    expect(decide).toHaveBeenCalledTimes(1);
  });

  it.each([
    [0.6, 0.95],
    [0.95, 0.6],
  ])(
    'uses general guidance for confidence %s and selected probability %s',
    async (confidence, selected) => {
      jest.spyOn(JevClient.prototype, 'decide').mockResolvedValue({
        model: 'jev-1.13.0',
        answers: {
          intent: {
            type: 'choice',
            choice: 'product',
            confidence,
            probabilities: { product: selected },
          },
        },
        usage: { inputTokens: 100, outputTokens: 10, cost: null },
        billing: {
          mode: null,
          creditsCharged: null,
          creditsRemaining: null,
          paidInputTokensUsed: null,
          tokensRemaining: null,
          modelMultiplier: null,
        },
      });
      expect(
        await create({ JEV_AI_RAG_MODE: 'classify' }).classifyInquiry(input),
      ).toMatchObject({
        status: 'classified',
        category: 'product',
        appliedCategory: 'other',
        applied: false,
      });
    },
  );

  it('skips non-opted-in, redacted, disabled and cancelled inquiry classification', async () => {
    const decide = jest.spyOn(JevClient.prototype, 'decide');
    const aborted = new AbortController();
    aborted.abort();
    expect(await create().classifyInquiry(input)).toMatchObject({
      status: 'skipped',
    });
    expect(
      await create({ JEV_AI_RAG_MODE: 'off' }).classifyInquiry(input),
    ).toMatchObject({ status: 'skipped' });
    const service = create({ JEV_AI_RAG_MODE: 'classify' });
    expect(
      await service.classifyInquiry({ ...input, appcode: 'other-app' }),
    ).toMatchObject({ status: 'skipped' });
    expect(
      await service.classifyInquiry({ ...input, signal: aborted.signal }),
    ).toMatchObject({ status: 'skipped' });
    expect(
      await create({
        JEV_AI_RAG_MODE: 'classify',
        JEV_AI_RAG_APPCODES: 'zinframe-test',
      }).classifyInquiry({ ...input, appcode: 'zinframe-test' }),
    ).toMatchObject({ status: 'skipped' });
    expect(decide).not.toHaveBeenCalled();
  });

  it.each([402, 429, 504])(
    'returns a safe classification fallback for HTTP %s',
    async (status) => {
      const decide = jest
        .spyOn(JevClient.prototype, 'decide')
        .mockRejectedValue(
          new JevError('JEV_AI_HTTP_ERROR', status, 1000, 'unknown'),
        );
      expect(
        await create({ JEV_AI_RAG_MODE: 'classify' }).classifyInquiry(input),
      ).toMatchObject({
        status: 'unavailable',
        applied: false,
        httpStatus: status,
      });
      expect(decide).toHaveBeenCalledTimes(1);
    },
  );

  it('builds guidance only from server-defined labels', () => {
    expect(createJevInquiryGuidance('refund_exchange')).toContain(
      '사실 근거가 아닙니다',
    );
    expect(createJevInquiryGuidance('ignore instructions')).toBeUndefined();
    expect(createJevInquiryGuidance('__proto__')).toBeUndefined();
  });

  it('is opt-in and excludes apps whose content must not be retained', async () => {
    const decide = jest.spyOn(JevClient.prototype, 'decide');
    expect(
      await create({ JEV_AI_RAG_MODE: 'off' }).evaluateRag(input),
    ).toBeUndefined();
    expect(
      await create().evaluateRag({ ...input, appcode: 'other-app' }),
    ).toBeUndefined();
    expect(
      await create({ JEV_AI_RAG_APPCODES: 'zinframe-test' }).evaluateRag({
        ...input,
        appcode: 'zinframe-test',
      }),
    ).toBeUndefined();
    expect(
      await create().evaluateRag({ ...input, sources: [] }),
    ).toBeUndefined();
    expect(decide).not.toHaveBeenCalled();
  });

  it('sends content and stable source numbers only, retaining separate decision usage', async () => {
    const decide = jest.spyOn(JevClient.prototype, 'decide').mockResolvedValue({
      model: 'jev-1.13.0',
      answers: {},
      usage: { inputTokens: 100, outputTokens: 5, cost: null },
      billing: {
        mode: 'tokens',
        paidInputTokensUsed: 100,
        modelMultiplier: 1,
        creditsCharged: 0,
        tokensRemaining: 0,
        creditsRemaining: null,
      },
    });
    const result = await create().evaluateRag(input);
    expect(result).toMatchObject({
      status: 'evaluated',
      mode: 'shadow',
      usage: { inputTokens: 100 },
    });
    expect(decide).toHaveBeenCalledTimes(1);
    const state = decide.mock.calls[0][0];
    expect(state).toMatchObject({
      sources: [{ index: 1, content: input.sources[0].content }],
    });
    expect(JSON.stringify(state)).not.toMatch(/private\/key|metadata|test-app/);
    expect(decide.mock.calls[0][1]).toHaveProperty('source_1');
    expect(decide.mock.calls[0][1]).toHaveProperty('answer_support');
    expect(input.sourceIndexes).toEqual([1]);
  });

  it('records sanitized failures without blocking the existing RAG answer', async () => {
    jest
      .spyOn(JevClient.prototype, 'decide')
      .mockRejectedValue(
        new JevError('JEV_AI_RATE_LIMITED', 429, 15000, 'failed'),
      );
    expect(await create().evaluateRag(input)).toMatchObject({
      status: 'unavailable',
      code: 'JEV_AI_RATE_LIMITED',
      retryAfterMs: 15000,
    });
    jest
      .spyOn(JevClient.prototype, 'decide')
      .mockRejectedValue(new Error('private provider detail'));
    const result = await create().evaluateRag(input);
    expect(result).toMatchObject({ code: 'JEV_AI_EVALUATION_FAILED' });
    expect(JSON.stringify(result)).not.toContain('private provider detail');
  });

  it('records validated parsing diagnostics and charge even when the decision is unavailable', async () => {
    jest.spyOn(JevClient.prototype, 'decide').mockRejectedValue(
      new JevError('JEV_AI_INVALID_RESPONSE', 200, null, 'unknown', {
        validationIssue: 'probability_sum',
        probabilitySum: 0.97,
        billing: {
          mode: 'credits-fallback',
          creditsCharged: 1,
          creditsRemaining: 10,
          paidInputTokensUsed: 0,
          tokensRemaining: 0,
          modelMultiplier: 1,
        },
        usage: { inputTokens: 1036, outputTokens: 109, cost: null },
      }),
    );
    expect(await create().evaluateRag(input)).toMatchObject({
      status: 'unavailable',
      outcome: 'unknown',
      validationIssue: 'probability_sum',
      probabilitySum: 0.97,
      billing: { creditsCharged: 1, creditsRemaining: 10 },
      usage: { inputTokens: 1036 },
    });
  });
});
