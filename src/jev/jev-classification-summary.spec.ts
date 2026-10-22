import { ConfigService } from '@nestjs/config';
import { JevService } from './jev.service';
import { JevClient, JevError, JevResult } from './jev-client';
import { summarizeClassification } from './jev-classification-summary';

describe('safe classification summary', () => {
  const service = (mode = 'classify', appcodes = 'test-app') =>
    new JevService(
      new ConfigService({
        JEV_AI_RAG_MODE: mode,
        JEV_AI_RAG_APPCODES: appcodes,
        JEV_AI_API_KEY: 'private-key',
      }),
    );
  const input = { appcode: 'test-app', query: 'private question' };
  const provider = (
    confidence: number,
    probability: number,
    category: string,
  ): JevResult => ({
    model: 'jev-latest',
    answers: {
      intent: {
        type: 'choice',
        choice: category,
        confidence,
        probabilities: { [category]: probability },
      },
    },
    usage: { inputTokens: 18, outputTokens: 3, cost: 42 },
    billing: {
      mode: 'credits-fallback',
      creditsCharged: 1,
      paidInputTokensUsed: 0,
      creditsRemaining: 999,
      tokensRemaining: 999,
      modelMultiplier: 1,
    },
  });
  afterEach(() => jest.restoreAllMocks());
  it.each([
    [0.9, 0.9, 'product', true],
    [0.6, 0.9, 'product', false],
    [0.9, 0.6, 'product', false],
    [0.7, 0.7, 'product', true],
    [0.9, 0.9, 'other', true],
  ] as const)(
    'projects confidence %s, probability %s, category %s',
    async (confidence, probability, category, applied) => {
      const decide = jest
        .spyOn(JevClient.prototype, 'decide')
        .mockResolvedValue(provider(confidence, probability, category));
      const summary = summarizeClassification(
        await service().classifyInquiry(input),
      );
      expect(summary).toEqual({
        status: 'classified',
        category,
        appliedCategory: applied ? category : 'other',
        applied,
        confidence,
        selectedProbability: probability,
        minimumConfidence: 0.7,
        policyVersion: 'inquiry-v1',
        durationMs: summary.durationMs,
        reason: applied ? null : 'low_confidence',
        errorCode: null,
        outcome: 'succeeded',
        usage: { inputTokens: 18, outputTokens: 3 },
        billing: { creditsCharged: 1, paidInputTokensUsed: 0 },
      });
      expect(summary.durationMs).toBeGreaterThanOrEqual(0);
      expect(decide).toHaveBeenCalledTimes(1);
    },
  );
  it.each(['JEV_AI_TIMEOUT', 'JEV_AI_HTTP_ERROR', 'JEV_AI_INVALID_RESPONSE'])(
    'preserves known failure charges for %s',
    async (code) => {
      const result = provider(0.9, 0.9, 'product');
      jest.spyOn(JevClient.prototype, 'decide').mockRejectedValue(
        new JevError(code, 200, null, 'unknown', {
          validationIssue: 'json',
          billing: result.billing,
          usage: result.usage,
        }),
      );
      expect(
        summarizeClassification(await service().classifyInquiry(input)),
      ).toMatchObject({
        status: 'unavailable',
        category: null,
        appliedCategory: null,
        confidence: null,
        selectedProbability: null,
        minimumConfidence: 0.7,
        policyVersion: 'inquiry-v1',
        reason: 'classification_unavailable',
        errorCode:
          code === 'JEV_AI_INVALID_RESPONSE'
            ? 'CLASSIFICATION_INVALID_RESPONSE'
            : 'CLASSIFICATION_UNAVAILABLE',
        outcome: 'unknown',
        usage: { inputTokens: 18, outputTokens: 3 },
        billing: { creditsCharged: 1, paidInputTokensUsed: 0 },
      });
    },
  );
  it.each([
    ['off', 'test-app', 'test-app'],
    ['shadow', 'test-app', 'test-app'],
    ['classify', 'another-app', 'test-app'],
    ['classify', 'zinframe-test', 'zinframe-test'],
  ])('skips %s/%s/%s without calls', async (mode, appcodes, appcode) => {
    const decide = jest.spyOn(JevClient.prototype, 'decide');
    expect(
      summarizeClassification(
        await service(mode, appcodes).classifyInquiry({ ...input, appcode }),
      ),
    ).toEqual({
      status: 'skipped',
      category: null,
      appliedCategory: null,
      applied: false,
      confidence: null,
      selectedProbability: null,
      minimumConfidence: null,
      policyVersion: null,
      durationMs: null,
      reason: 'not_enabled_for_request',
      errorCode: null,
      outcome: 'not_sent',
      usage: null,
      billing: { creditsCharged: null, paidInputTokensUsed: null },
    });
    expect(decide).not.toHaveBeenCalled();
  });
  it('prioritizes pre-call cancellation even when disabled', async () => {
    const decide = jest.spyOn(JevClient.prototype, 'decide');
    expect(
      summarizeClassification(
        await service('off').classifyInquiry({
          ...input,
          signal: AbortSignal.abort(),
        }),
      ),
    ).toMatchObject({
      status: 'skipped',
      reason: 'request_cancelled',
      outcome: 'not_sent',
    });
    expect(decide).not.toHaveBeenCalled();
  });
  it('does not infer missing usage or billing as zero', async () => {
    jest
      .spyOn(JevClient.prototype, 'decide')
      .mockRejectedValue(new JevError('JEV_AI_TIMEOUT', null, null, 'unknown'));
    expect(
      summarizeClassification(await service().classifyInquiry(input)),
    ).toMatchObject({
      usage: null,
      billing: { creditsCharged: null, paidInputTokensUsed: null },
    });
  });
});
