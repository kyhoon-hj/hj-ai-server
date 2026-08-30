export const CORRELATION_HEADER = 'x-correlation-id';

export type ApiFailureKind =
  | 'timeout'
  | 'network'
  | 'unauthorized'
  | 'unavailable'
  | 'unexpected';

export interface ApiFailureShape {
  kind: ApiFailureKind;
  status: number | null;
  code: string;
  message: string;
  correlationId: string;
  retryable: boolean;
}

export class ApiFailure extends Error implements ApiFailureShape {
  constructor(
    public readonly kind: ApiFailureKind,
    public readonly status: number | null,
    public readonly code: string,
    message: string,
    public readonly correlationId: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'ApiFailure';
  }
}

type ErrorPayload = {
  code?: string;
  message?: string | string[];
  requestId?: string;
};

export function createCorrelationId(): string {
  return globalThis.crypto.randomUUID();
}

export function normalizeApiFailure(
  status: number,
  payload: ErrorPayload | null,
  fallbackCorrelationId: string,
): ApiFailure {
  const correlationId = payload?.requestId ?? fallbackCorrelationId;
  const message = Array.isArray(payload?.message)
    ? payload.message.join(', ')
    : payload?.message ?? '요청을 처리하지 못했습니다.';

  if (status === 401 || status === 403) {
    return new ApiFailure('unauthorized', status, payload?.code ?? 'ACCESS_DENIED', message, correlationId, false);
  }
  if (status === 502 || status === 503 || status === 504) {
    return new ApiFailure('unavailable', status, payload?.code ?? 'SERVICE_UNAVAILABLE', message, correlationId, true);
  }
  return new ApiFailure('unexpected', status, payload?.code ?? 'REQUEST_FAILED', message, correlationId, status >= 500);
}

export async function apiRequest<T>(
  input: RequestInfo | URL,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<T> {
  const correlationId = createCorrelationId();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), init.timeoutMs ?? 5000);

  try {
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');
    headers.set(CORRELATION_HEADER, correlationId);
    const response = await fetch(input, {
      ...init,
      signal: controller.signal,
      headers,
    });
    const responseCorrelationId = response.headers.get(CORRELATION_HEADER) ?? correlationId;
    const payload = (await response.json().catch(() => null)) as T | ErrorPayload | null;
    if (!response.ok) {
      throw normalizeApiFailure(response.status, payload as ErrorPayload | null, responseCorrelationId);
    }
    return payload as T;
  } catch (error) {
    if (error instanceof ApiFailure) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiFailure('timeout', null, 'REQUEST_TIMEOUT', 'AI 서버 응답 시간이 초과되었습니다.', correlationId, true);
    }
    throw new ApiFailure('network', null, 'NETWORK_ERROR', 'AI 서버에 연결할 수 없습니다.', correlationId, true);
  } finally {
    clearTimeout(timeout);
  }
}
