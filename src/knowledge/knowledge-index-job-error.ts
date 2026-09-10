import { HttpException } from '@nestjs/common';

export type KnowledgeIndexJobFailure = {
  errorCode: string;
  errorMessage: string;
  retryable: boolean;
  retryAfterMs: number;
};

type ErrorRecord = {
  name?: unknown;
  code?: unknown;
  message?: unknown;
  cause?: unknown;
  $metadata?: { httpStatusCode?: unknown };
  $response?: { headers?: Record<string, string | string[] | undefined> };
};

const RETRYABLE_DATABASE_CODES = new Set([
  'P1001',
  'P1002',
  'P1008',
  'P1017',
  'P2024',
]);

const RETRYABLE_ERROR_NAMES = new Set([
  'ThrottlingException',
  'TooManyRequestsException',
  'ModelTimeoutException',
  'ServiceUnavailableException',
  'InternalServerException',
  'RequestTimeout',
  'RequestTimeoutException',
  'TimeoutError',
  'AbortError',
]);

const PERMANENT_ERROR_NAMES = new Set([
  'ValidationException',
  'AccessDeniedException',
  'UnauthorizedException',
  'ResourceNotFoundException',
  'NoSuchKey',
  'NoSuchKeyException',
  'NotFound',
]);

const RETRYABLE_TRANSPORT_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'EPIPE',
  'EAI_AGAIN',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'ERR_HTTP2_GOAWAY_SESSION',
  'ERR_HTTP2_STREAM_CANCEL',
  'ERR_HTTP2_INVALID_SESSION',
]);

function isTransientTransportFailure(record: ErrorRecord) {
  // Smithy can wrap native errors. Inspect only a bounded cause chain and known codes.
  let current = record;
  for (let depth = 0; depth < 4; depth++) {
    if (
      typeof current.code === 'string' &&
      RETRYABLE_TRANSPORT_CODES.has(current.code)
    )
      return true;
    // NodeHttp2Handler emits this exact uncoded error when the peer closes before headers.
    if (
      current.message ===
      'Unexpected error: http2 request did not get a response'
    )
      return true;
    if (!current.cause || current.cause === current) break;
    current = asErrorRecord(current.cause);
  }
  return false;
}

function asErrorRecord(error: unknown): ErrorRecord {
  return typeof error === 'object' && error !== null ? error : {};
}

function retryAfterHeaderMs(error: ErrorRecord, now: Date): number | null {
  const value = error.$response?.headers?.['retry-after'];
  const header = Array.isArray(value) ? value[0] : value;
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - now.getTime()) : null;
}

function boundedBackoffMs(attempt: number, baseDelayMs: number) {
  return Math.min(60_000, baseDelayMs * 2 ** Math.max(0, attempt - 1));
}

export function classifyKnowledgeIndexJobError(
  error: unknown,
  attempt: number,
  baseDelayMs: number,
  now = new Date(),
): KnowledgeIndexJobFailure {
  const record = asErrorRecord(error);
  const name = typeof record.name === 'string' ? record.name : '';
  const code = typeof record.code === 'string' ? record.code : '';
  const message =
    typeof record.message === 'string' ? record.message.toLowerCase() : '';
  const status =
    error instanceof HttpException
      ? error.getStatus()
      : typeof record.$metadata?.httpStatusCode === 'number'
        ? record.$metadata.httpStatusCode
        : undefined;
  const retryAfterMs = Math.min(
    60_000,
    retryAfterHeaderMs(record, now) ?? boundedBackoffMs(attempt, baseDelayMs),
  );

  if (RETRYABLE_DATABASE_CODES.has(code)) {
    return {
      errorCode: 'DATABASE_TEMPORARILY_UNAVAILABLE',
      errorMessage: '데이터베이스 연결이 일시적으로 불안정합니다.',
      retryable: true,
      retryAfterMs,
    };
  }

  if (name.includes('Throttling') || status === 429) {
    return {
      errorCode: 'UPSTREAM_THROTTLED',
      errorMessage: '외부 AI 서비스 요청이 일시적으로 제한되었습니다.',
      retryable: true,
      retryAfterMs,
    };
  }

  if (
    status === undefined &&
    !PERMANENT_ERROR_NAMES.has(name) &&
    isTransientTransportFailure(record)
  ) {
    return {
      errorCode: 'UPSTREAM_TEMPORARILY_UNAVAILABLE',
      errorMessage: '외부 서비스 연결이 일시적으로 중단되었습니다.',
      retryable: true,
      retryAfterMs,
    };
  }

  if (
    name.includes('Timeout') ||
    name === 'AbortError' ||
    /\b(?:timeout|timed out|econnreset|etimedout)\b/.test(message)
  ) {
    return {
      errorCode: 'UPSTREAM_TIMEOUT',
      errorMessage: '외부 서비스 응답 시간이 초과되었습니다.',
      retryable: true,
      retryAfterMs,
    };
  }

  if (
    RETRYABLE_ERROR_NAMES.has(name) ||
    (status !== undefined && status >= 500)
  ) {
    return {
      errorCode: 'UPSTREAM_TEMPORARILY_UNAVAILABLE',
      errorMessage: '외부 서비스가 일시적으로 응답하지 않습니다.',
      retryable: true,
      retryAfterMs,
    };
  }

  if (name.includes('AccessDenied') || status === 401 || status === 403) {
    return {
      errorCode: 'UPSTREAM_ACCESS_DENIED',
      errorMessage: '외부 서비스 접근 권한을 확인해야 합니다.',
      retryable: false,
      retryAfterMs: 0,
    };
  }

  if (
    name.includes('NotFound') ||
    name.includes('NoSuchKey') ||
    status === 404
  ) {
    return {
      errorCode: 'INDEX_SOURCE_NOT_FOUND',
      errorMessage: '인덱싱할 원본 리소스를 찾을 수 없습니다.',
      retryable: false,
      retryAfterMs: 0,
    };
  }

  if (
    PERMANENT_ERROR_NAMES.has(name) ||
    (status !== undefined && status >= 400 && status < 500)
  ) {
    return {
      errorCode: 'INVALID_INDEX_REQUEST',
      errorMessage: '인덱싱 요청 또는 설정을 확인해야 합니다.',
      retryable: false,
      retryAfterMs: 0,
    };
  }

  return {
    errorCode: 'INDEXING_ERROR',
    errorMessage: '인덱싱 처리 중 복구할 수 없는 오류가 발생했습니다.',
    retryable: false,
    retryAfterMs: 0,
  };
}
