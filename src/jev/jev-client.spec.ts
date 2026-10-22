import {
  JevClient,
  JevError,
  JEV_AI_BASE_URL,
  type JevQuestion,
} from './jev-client';

const questions: Record<string, JevQuestion> = {
  category: {
    type: 'choice',
    instructions: 'Classify the ticket.',
    criteria: { billing: null, technical: null },
  },
  urgent: { type: 'noul', instructions: 'Is this urgent?' },
  severity: {
    type: 'score',
    instructions: 'Rate severity.',
    criteria: ['low', 'high'],
  },
};

function responseValue() {
  return {
    model: 'jev-1.13.0',
    answers: {
      category: {
        type: 'choice',
        choice: 'billing',
        probabilities: { billing: 0.9, technical: 0.1 },
        confidence: 0.8,
      },
      urgent: { type: 'noul', noul: 0.6 },
      severity: {
        type: 'score',
        score: 0.75,
        probabilities: { '0': 0.25, '1': 0.75 },
        confidence: 0.5,
      },
    },
    usage: { input_tokens: 120, output_tokens: 12 },
  };
}

describe('JevClient transport and provider contract', () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;
  const client = () => new JevClient({ apiKey: 'test-only-key' });
  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as typeof fetch;
  });
  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
  });

  it('pins the actual destination and checks models without inference', async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        models: [{ name: 'jev-latest', description: 'Stable Jev' }],
      }),
    );
    await expect(client().listModels()).resolves.toEqual([
      { name: 'jev-latest', description: 'Stable Jev' },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      JEV_AI_BASE_URL + '/v1/models',
      expect.objectContaining({
        method: 'GET',
        redirect: 'error',
        headers: {
          Authorization: 'Bearer test-only-key',
          Accept: 'application/json',
        },
        body: undefined,
      }),
    );
  });

  it('rejects missing keys and different/malformed destinations before transport', () => {
    expect(() => new JevClient({})).toThrow('JEV_AI_API_KEY_REQUIRED');
    for (const baseURL of [
      'https://api.typesafe.ai',
      'https://jev-ai.pro/api/v1',
      'https://jev-ai.pro.evil.test/api',
      'http://jev-ai.pro/api',
    ]) {
      expect(() => new JevClient({ apiKey: 'test-only-key', baseURL })).toThrow(
        'JEV_AI_INVALID_DESTINATION',
      );
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.stringify(client())).not.toContain('test-only-key');
  });

  it('sends one typed request and preserves actual usage and billing units', async () => {
    fetchMock.mockResolvedValue(
      Response.json(responseValue(), {
        headers: {
          'X-Jev-Billing': 'tokens',
          'X-Jev-Paid-Input-Tokens-Used': '120',
          'X-Jev-Model-Multiplier': '1',
          'X-Jev-Credits-Charged': '0',
          'X-Jev-Tokens-Remaining': '880',
        },
      }),
    );
    const result = await client().decide('Payment issue.', questions);
    expect(result).toMatchObject({
      model: 'jev-1.13.0',
      usage: { inputTokens: 120, outputTokens: 12, cost: null },
      billing: {
        mode: 'tokens',
        paidInputTokensUsed: 120,
        creditsCharged: 0,
        tokensRemaining: 880,
        creditsRemaining: null,
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://jev-ai.pro/api/v1/systemone');
    expect(init).toMatchObject({
      method: 'POST',
      redirect: 'error',
      headers: {
        Authorization: 'Bearer test-only-key',
        'Content-Type': 'application/json',
      },
    });
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'jev-latest',
      state: 'Payment issue.',
      questions,
    });
  });

  it.each([401, 402, 404, 409, 422, 429, 500, 502, 503, 504])(
    'does not replay HTTP %i or retain secret-bearing error bodies',
    async (status) => {
      fetchMock.mockResolvedValue(
        Response.json(
          { error: { code: status, message: 'test-only-key private prompt' } },
          {
            status,
            headers: { 'Retry-After': '12' },
          },
        ),
      );
      let caught: unknown;
      try {
        await client().decide('Payment issue.', questions);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(JevError);
      expect(caught).toMatchObject({
        status,
        retryAfterMs: 12000,
        outcome: [500, 504].includes(status) ? 'unknown' : 'failed',
      });
      expect(String(caught)).not.toMatch(/test-only-key|private prompt/);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it('preserves the live batch model identifier without claiming a resolved version', async () => {
    const body = responseValue();
    body.model = 'typesafe-ai/jev';
    fetchMock.mockResolvedValue(Response.json(body));
    await expect(
      client().decide('Batch evaluation.', questions),
    ).resolves.toMatchObject({
      model: 'typesafe-ai/jev',
      answers: body.answers,
      usage: { inputTokens: 120, outputTokens: 12 },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://jev-ai.pro/api/v1/systemone');
    expect(JSON.parse(init.body as string)).toMatchObject({
      model: 'jev-latest',
    });
  });

  it.each([
    { first: 0.49, second: 0.49 },
    { first: 0.51, second: 0.51 },
  ])(
    'accepts probability sums at the rounding tolerance boundary: %j',
    async ({ first, second }) => {
      const body = responseValue();
      body.answers.category.probabilities = {
        billing: first,
        technical: second,
      };
      fetchMock.mockResolvedValue(Response.json(body));
      const result = await client().decide('Boundary evaluation.', questions);
      expect(result.answers.category).toMatchObject({
        probabilities: { billing: first, technical: second },
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it('preserves an HTTP-date Retry-After without automatically retrying', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-22T00:00:00Z'));
    fetchMock.mockResolvedValue(
      new Response('', {
        status: 429,
        headers: { 'Retry-After': 'Thu, 22 Oct 2026 00:01:00 GMT' },
      }),
    );
    await expect(client().listModels()).rejects.toMatchObject({
      retryAfterMs: 60000,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('marks lost POST responses uncertain, never leaking the transport cause', async () => {
    fetchMock.mockRejectedValue(new Error('test-only-key private prompt'));
    await expect(
      client().decide('Payment issue.', questions),
    ).rejects.toMatchObject({
      code: 'JEV_AI_CONNECTION_FAILED',
      outcome: 'unknown',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('propagates cancellation and does not send pre-cancelled requests', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      client().decide('Payment issue.', questions, controller.signal),
    ).rejects.toMatchObject({ code: 'JEV_AI_CANCELLED', outcome: 'not_sent' });
    expect(fetchMock).not.toHaveBeenCalled();
    const active = new AbortController();
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener(
            'abort',
            () => reject(new Error('aborted')),
            { once: true },
          );
        }),
    );
    const pending = client().decide('Payment issue.', questions, active.signal);
    active.abort();
    await expect(pending).rejects.toMatchObject({
      code: 'JEV_AI_CANCELLED_OR_TIMEOUT',
      outcome: 'unknown',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('enforces UTF-8 byte limits and question limits without truncating or spending', async () => {
    await expect(
      client().decide('한'.repeat(86000), questions),
    ).rejects.toMatchObject({ code: 'JEV_AI_BODY_TOO_LARGE' });
    await expect(client().decide('test', {})).rejects.toMatchObject({
      code: 'JEV_AI_INVALID_QUESTIONS',
    });
    const many = Object.fromEntries(
      Array.from({ length: 65 }, (_, i) => ['q' + i, questions.urgent]),
    );
    await expect(client().decide('test', many)).rejects.toMatchObject({
      code: 'JEV_AI_INVALID_QUESTIONS',
    });
    await expect(client().decide('', questions)).rejects.toMatchObject({
      code: 'JEV_AI_INVALID_STATE',
    });
    await expect(
      client().decide('test', {
        q: { type: 'choice', instructions: 'test', criteria: { one: null } },
      }),
    ).rejects.toMatchObject({ code: 'JEV_AI_INVALID_QUESTIONS' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    'missing-answer',
    'invalid-choice',
    'invalid-probability',
    'missing-usage',
    'wrong-model',
    'invalid-json',
  ])('rejects %s after a paid response without replay', async (mode) => {
    const body = responseValue();
    if (mode === 'missing-answer')
      delete (body.answers as Record<string, unknown>).urgent;
    if (mode === 'invalid-choice') body.answers.category.choice = 'unrequested';
    if (mode === 'invalid-probability') body.answers.urgent.noul = 2;
    if (mode === 'missing-usage')
      delete (body as Record<string, unknown>).usage;
    if (mode === 'wrong-model') body.model = 'other-provider-model';
    fetchMock.mockResolvedValue(
      mode === 'invalid-json' ? new Response('invalid') : Response.json(body),
    );
    await expect(client().decide('test', questions)).rejects.toMatchObject({
      code: 'JEV_AI_INVALID_RESPONSE',
      outcome: 'unknown',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['under-sum', 'probability_sum'],
    ['over-sum', 'probability_sum'],
    ['out-of-range', 'probability_labels'],
    ['missing-label', 'probability_labels'],
    ['extra-label', 'probability_labels'],
    ['invalid-json', 'json'],
  ])(
    'retains safe billing and validation diagnostics for %s without replay',
    async (mode, issue) => {
      const body = responseValue();
      const probabilities: Record<string, unknown> =
        body.answers.category.probabilities;
      if (mode === 'under-sum') probabilities.billing = 0.87;
      if (mode === 'over-sum') probabilities.technical = 0.13;
      if (mode === 'out-of-range') probabilities.billing = 1.1;
      if (mode === 'missing-label') delete probabilities.technical;
      if (mode === 'extra-label') probabilities['unrequested'] = 0;
      const headers = {
        'X-Jev-Credits-Charged': '1',
        'X-Jev-Credits-Remaining': '10',
        'X-Private': 'test-only-key',
      };
      fetchMock.mockResolvedValue(
        mode === 'invalid-json'
          ? new Response('test-only-key private provider detail', { headers })
          : Response.json(
              {
                ...body,
                privateDetail: 'test-only-key private provider detail',
              },
              { headers },
            ),
      );
      let caught: unknown;
      try {
        await client().decide('Private request text.', questions);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(JevError);
      expect(caught).toMatchObject({
        code: 'JEV_AI_INVALID_RESPONSE',
        outcome: 'unknown',
        status: 200,
        responseFailure: {
          validationIssue: issue,
          billing: {
            creditsCharged: 1,
            creditsRemaining: 10,
            tokensRemaining: null,
          },
          usage:
            mode === 'invalid-json'
              ? null
              : { inputTokens: 120, outputTokens: 12, cost: null },
        },
      });
      expect(JSON.stringify(caught)).not.toMatch(
        /test-only-key|private provider detail|Private request text|X-Private/,
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );
});
