export const JEV_AI_BASE_URL = 'https://jev-ai.pro/api';
export const JEV_AI_DEFAULT_MODEL = 'jev-latest';
export const JEV_AI_MAX_BODY_BYTES = 256000;

export type JevQuestion = {
  instructions: string;
} & (
  | { type: 'noul'; criteria?: { true?: string; false?: string } }
  | { type: 'choice'; criteria: Record<string, string | null> }
  | { type: 'score'; criteria: string[] }
);

export type JevAnswer =
  | { type: 'noul'; noul: number }
  | {
      type: 'choice';
      choice: string;
      probabilities: Record<string, number>;
      confidence: number;
    }
  | {
      type: 'score';
      score: number;
      probabilities: Record<string, number>;
      confidence: number;
    };

export type JevResult = {
  model: string;
  answers: Record<string, JevAnswer>;
  usage: { inputTokens: number; outputTokens: number; cost: number | null };
  billing: {
    mode: string | null;
    paidInputTokensUsed: number | null;
    modelMultiplier: number | null;
    creditsCharged: number | null;
    tokensRemaining: number | null;
    creditsRemaining: number | null;
  };
};

type JevResponseIssue =
  | 'json'
  | 'envelope'
  | 'model'
  | 'answers'
  | 'usage'
  | 'answer_type'
  | 'probability'
  | 'probability_labels'
  | 'probability_sum'
  | 'choice'
  | 'score';

export type JevResponseFailure = {
  validationIssue: JevResponseIssue;
  billing: JevResult['billing'];
  usage: JevResult['usage'] | null;
  probabilitySum?: number;
};

export class JevError extends Error {
  constructor(
    readonly code: string,
    readonly status: number | null = null,
    readonly retryAfterMs: number | null = null,
    readonly outcome: 'not_sent' | 'failed' | 'unknown' = 'not_sent',
    readonly responseFailure?: JevResponseFailure,
  ) {
    // Never retain provider bodies, request content, credentials or transport causes.
    super(code);
    this.name = 'JevError';
  }
}

type JevClientOptions = {
  apiKey?: string;
  baseURL?: string;
  model?: string;
  timeoutMs?: number;
};

export function validateJevOptions(options: JevClientOptions) {
  if ((options.baseURL?.trim() || JEV_AI_BASE_URL) !== JEV_AI_BASE_URL) {
    throw new JevError('JEV_AI_INVALID_DESTINATION');
  }
  const model = options.model?.trim() || JEV_AI_DEFAULT_MODEL;
  if (!/^(jev-latest|jev-preview|jev-\d+\.\d+\.\d+)$/.test(model)) {
    throw new JevError('JEV_AI_INVALID_MODEL');
  }
  const timeoutMs = options.timeoutMs ?? 3000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000) {
    throw new JevError('JEV_AI_INVALID_TIMEOUT');
  }
  return { baseURL: JEV_AI_BASE_URL, model, timeoutMs };
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonnegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function probability(value: unknown): value is number {
  return nonnegative(value) && value <= 1;
}

function tokenCount(value: unknown): value is number {
  return nonnegative(value) && Number.isSafeInteger(value);
}

function headerNumber(headers: Headers, key: string): number | null {
  const raw = headers.get(key);
  if (raw === null || !raw.trim()) return null;
  const number = Number(raw);
  return nonnegative(number) ? number : null;
}

function readBilling(headers: Headers): JevResult['billing'] {
  const mode = headers.get('x-jev-billing');
  return {
    mode: mode && /^[a-z_-]{1,64}$/i.test(mode) ? mode : null,
    paidInputTokensUsed: headerNumber(headers, 'x-jev-paid-input-tokens-used'),
    modelMultiplier: headerNumber(headers, 'x-jev-model-multiplier'),
    creditsCharged: headerNumber(headers, 'x-jev-credits-charged'),
    tokensRemaining: headerNumber(headers, 'x-jev-tokens-remaining'),
    creditsRemaining: headerNumber(headers, 'x-jev-credits-remaining'),
  };
}

function readUsage(value: unknown): JevResult['usage'] | null {
  if (
    !record(value) ||
    !tokenCount(value.input_tokens) ||
    !tokenCount(value.output_tokens)
  )
    return null;
  return {
    inputTokens: value.input_tokens,
    outputTokens: value.output_tokens,
    cost: nonnegative(value.cost) ? value.cost : null,
  };
}

function retryAfter(headers: Headers): number | null {
  const raw = headers.get('retry-after');
  if (raw === null || !raw.trim()) return null;
  const seconds = Number(raw);
  if (nonnegative(seconds)) return Math.ceil(seconds * 1000);
  const date = Date.parse(raw);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

export class JevClient {
  readonly destination: Readonly<ReturnType<typeof validateJevOptions>>;
  readonly #apiKey: string;

  constructor(options: JevClientOptions) {
    this.destination = Object.freeze(validateJevOptions(options));
    this.#apiKey = options.apiKey?.trim() || '';
    if (!this.#apiKey || /\s/.test(this.#apiKey)) {
      throw new JevError('JEV_AI_API_KEY_REQUIRED');
    }
  }

  async listModels(
    signal?: AbortSignal,
  ): Promise<{ name: string; description: string }[]> {
    const { value } = await this.request(
      'GET',
      '/v1/models',
      undefined,
      signal,
    );
    if (
      !record(value) ||
      !Array.isArray(value.models) ||
      !value.models.every(
        (model: unknown) =>
          record(model) &&
          typeof model.name === 'string' &&
          typeof model.description === 'string',
      )
    ) {
      throw new JevError('JEV_AI_INVALID_RESPONSE', 200, null, 'failed');
    }
    return value.models as { name: string; description: string }[];
  }

  async decide(
    state: string | Record<string, unknown> | unknown[],
    questions: Record<string, JevQuestion>,
    signal?: AbortSignal,
  ): Promise<JevResult> {
    if (
      (typeof state === 'string' && !state.trim()) ||
      (Array.isArray(state) && !state.length) ||
      (record(state) && !Object.keys(state).length) ||
      !(typeof state === 'string' || record(state) || Array.isArray(state))
    ) {
      throw new JevError('JEV_AI_INVALID_STATE');
    }
    const entries = Object.entries(questions);
    if (!entries.length || entries.length > 64) {
      throw new JevError('JEV_AI_INVALID_QUESTIONS');
    }
    for (const [id, question] of entries) {
      if (
        !/^[A-Za-z0-9._-]{1,64}$/.test(id) ||
        !question ||
        typeof question.instructions !== 'string' ||
        !question.instructions.trim()
      ) {
        throw new JevError('JEV_AI_INVALID_QUESTIONS');
      }
      if (question.type === 'choice') {
        if (
          !record(question.criteria) ||
          Object.keys(question.criteria).length < 2 ||
          Object.keys(question.criteria).length > 255 ||
          !Object.values(question.criteria).every(
            (item) => item === null || typeof item === 'string',
          )
        ) {
          throw new JevError('JEV_AI_INVALID_QUESTIONS');
        }
      } else if (question.type === 'score') {
        if (
          !Array.isArray(question.criteria) ||
          question.criteria.length < 2 ||
          question.criteria.length > 10 ||
          !question.criteria.every((item) => typeof item === 'string')
        ) {
          throw new JevError('JEV_AI_INVALID_QUESTIONS');
        }
      } else if (question.type === 'noul') {
        if (
          question.criteria !== undefined &&
          (!record(question.criteria) ||
            !Object.entries(question.criteria).every(
              ([key, value]) =>
                ['true', 'false'].includes(key) && typeof value === 'string',
            ))
        ) {
          throw new JevError('JEV_AI_INVALID_QUESTIONS');
        }
      } else {
        throw new JevError('JEV_AI_INVALID_QUESTIONS');
      }
    }
    let body: string;
    try {
      body = JSON.stringify({
        model: this.destination.model,
        state,
        questions,
      });
    } catch {
      throw new JevError('JEV_AI_INVALID_STATE');
    }
    if (Buffer.byteLength(body, 'utf8') > JEV_AI_MAX_BODY_BYTES) {
      throw new JevError('JEV_AI_BODY_TOO_LARGE');
    }
    const { value, headers } = await this.request(
      'POST',
      '/v1/systemone',
      body,
      signal,
    );
    const billing = readBilling(headers);
    const usage = readUsage(record(value) ? value.usage : undefined);
    const invalid = (
      validationIssue: JevResponseIssue,
      probabilitySum?: number,
    ) =>
      new JevError('JEV_AI_INVALID_RESPONSE', 200, null, 'unknown', {
        validationIssue,
        billing,
        usage,
        ...(probabilitySum === undefined ? {} : { probabilitySum }),
      });
    if (!record(value)) throw invalid('envelope');
    if (
      typeof value.model !== 'string' ||
      // The hosted endpoint also reports this upstream model identifier on batches.
      // Preserve it verbatim; it does not establish a specific resolved Jev version.
      !(
        value.model === 'typesafe-ai/jev' ||
        /^(jev-latest|jev-preview|jev-\d+\.\d+\.\d+)$/.test(value.model)
      )
    )
      throw invalid('model');
    if (
      !record(value.answers) ||
      Object.keys(value.answers).length !== entries.length
    ) {
      throw invalid('answers');
    }
    if (!usage) throw invalid('usage');
    const answers: Record<string, JevAnswer> = {};
    for (const [id, question] of entries) {
      const answer = value.answers[id];
      if (!record(answer) || answer.type !== question.type)
        throw invalid('answer_type');
      if (question.type === 'noul') {
        if (!probability(answer.noul)) throw invalid('probability');
        answers[id] = { type: 'noul', noul: answer.noul };
      } else {
        if (!probability(answer.confidence) || !record(answer.probabilities)) {
          throw invalid('probability');
        }
        const probabilities = answer.probabilities;
        const labels =
          question.type === 'choice'
            ? Object.keys(question.criteria)
            : question.criteria.map((_, index) => String(index));
        if (
          Object.keys(probabilities).length !== labels.length ||
          !labels.every((label) => probability(probabilities[label]))
        ) {
          throw invalid('probability_labels');
        }
        const sum = labels.reduce(
          (total, label) => total + (probabilities[label] as number),
          0,
        );
        // Allow only floating-point accumulation error at the existing 2% boundary.
        const roundingError = Number.EPSILON * labels.length;
        if (Math.abs(sum - 1) > 0.02 + roundingError)
          throw invalid('probability_sum', sum);
        if (question.type === 'choice') {
          if (
            typeof answer.choice !== 'string' ||
            !Object.hasOwn(question.criteria, answer.choice)
          ) {
            throw invalid('choice');
          }
          answers[id] = {
            type: 'choice',
            choice: answer.choice,
            probabilities: probabilities as Record<string, number>,
            confidence: answer.confidence,
          };
        } else {
          if (
            !nonnegative(answer.score) ||
            answer.score > question.criteria.length - 1
          ) {
            throw invalid('score');
          }
          answers[id] = {
            type: 'score',
            score: answer.score,
            probabilities: probabilities as Record<string, number>,
            confidence: answer.confidence,
          };
        }
      }
    }
    return {
      model: value.model,
      answers,
      usage,
      billing,
    };
  }

  private async request(
    method: 'GET' | 'POST',
    path: '/v1/models' | '/v1/systemone',
    body?: string,
    parentSignal?: AbortSignal,
  ): Promise<{ value: unknown; headers: Headers }> {
    if (parentSignal?.aborted) throw new JevError('JEV_AI_CANCELLED');
    const timeout = AbortSignal.timeout(this.destination.timeoutMs);
    const signal = parentSignal
      ? AbortSignal.any([parentSignal, timeout])
      : timeout;
    // Deliberately no retry loop and no redirect/provider fallback.
    let response: Response;
    try {
      response = await fetch(this.destination.baseURL + path, {
        method,
        headers: {
          Authorization: `Bearer ${this.#apiKey}`,
          Accept: 'application/json',
          ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
        },
        body,
        signal,
        redirect: 'error',
      });
    } catch {
      throw new JevError(
        signal.aborted
          ? 'JEV_AI_CANCELLED_OR_TIMEOUT'
          : 'JEV_AI_CONNECTION_FAILED',
        null,
        null,
        method === 'POST' ? 'unknown' : 'failed',
      );
    }
    if (!response.ok) {
      const codes: Record<number, string> = {
        401: 'JEV_AI_AUTHENTICATION_FAILED',
        402: 'JEV_AI_BALANCE_REQUIRED',
        404: 'JEV_AI_ENDPOINT_NOT_FOUND',
        409: 'JEV_AI_REVISION_CONFLICT',
        422: 'JEV_AI_VALIDATION_FAILED',
        429: 'JEV_AI_RATE_LIMITED',
        502: 'JEV_AI_PROVIDER_UNAVAILABLE',
        503: 'JEV_AI_PROVIDER_UNAVAILABLE',
        504: 'JEV_AI_UPSTREAM_TIMEOUT',
      };
      await response.body?.cancel().catch(() => undefined);
      throw new JevError(
        codes[response.status] ?? 'JEV_AI_HTTP_ERROR',
        response.status,
        retryAfter(response.headers),
        method === 'POST' &&
          (response.status === 504 || response.status === 500)
          ? 'unknown'
          : 'failed',
      );
    }
    try {
      const value: unknown = await response.json();
      return { value, headers: response.headers };
    } catch {
      throw new JevError(
        'JEV_AI_INVALID_RESPONSE',
        response.status,
        null,
        method === 'POST' ? 'unknown' : 'failed',
        method === 'POST'
          ? {
              validationIssue: 'json',
              billing: readBilling(response.headers),
              usage: null,
            }
          : undefined,
      );
    }
  }
}
