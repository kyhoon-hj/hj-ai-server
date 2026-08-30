import { CORRELATION_HEADER, createCorrelationId } from '@/lib/api-client';

const DEFAULT_AI_SERVER_URL = 'http://127.0.0.1:11000';

export async function GET(request: Request) {
  const correlationId = request.headers.get(CORRELATION_HEADER) ?? createCorrelationId();
  const baseUrl = process.env.AI_SERVER_BASE_URL ?? DEFAULT_AI_SERVER_URL;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3500);

  try {
    const response = await fetch(`${baseUrl}/health/ready`, {
      cache: 'no-store',
      signal: controller.signal,
      headers: { [CORRELATION_HEADER]: correlationId },
    });
    const upstreamCorrelationId = response.headers.get(CORRELATION_HEADER) ?? correlationId;
    const details = await response.json().catch(() => null);

    return Response.json(
      {
        state: response.ok ? 'ready' : 'degraded',
        upstreamStatus: response.status,
        checkedAt: new Date().toISOString(),
        correlationId: upstreamCorrelationId,
        details,
      },
      {
        status: response.ok ? 200 : 503,
        headers: { [CORRELATION_HEADER]: upstreamCorrelationId },
      },
    );
  } catch (error) {
    const timeoutError = error instanceof DOMException && error.name === 'AbortError';
    return Response.json(
      {
        state: 'offline',
        code: timeoutError ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNREACHABLE',
        message: timeoutError
          ? 'AI 서버 응답 시간이 초과되었습니다.'
          : 'AI 서버에 연결할 수 없습니다.',
        requestId: correlationId,
      },
      { status: 503, headers: { [CORRELATION_HEADER]: correlationId } },
    );
  } finally {
    clearTimeout(timeout);
  }
}
