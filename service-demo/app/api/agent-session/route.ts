import { CORRELATION_HEADER, createCorrelationId } from '@/lib/api-client';
import { LOCAL_AGENT_COOKIE } from '@/lib/server/agent-auth';

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);

export async function POST(request: Request) {
  const correlationId = request.headers.get(CORRELATION_HEADER) ?? createCorrelationId();
  const token = process.env.SERVICE_DEMO_LOCAL_AGENT_TOKEN?.trim();
  const url = new URL(request.url);
  const sameOrigin = request.headers.get('origin') === url.origin || request.headers.get('sec-fetch-site') === 'same-origin';
  if (!token || !LOCAL_HOSTS.has(url.hostname) || !sameOrigin) {
    return Response.json(
      { statusCode: 404, code: 'LOCAL_AGENT_SESSION_UNAVAILABLE', message: '로컬 상담원 세션을 사용할 수 없습니다.', requestId: correlationId },
      { status: 404, headers: { [CORRELATION_HEADER]: correlationId } },
    );
  }
  return Response.json(
    { active: true, requestId: correlationId },
    { headers: { [CORRELATION_HEADER]: correlationId, 'set-cookie': `${LOCAL_AGENT_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800` } },
  );
}
