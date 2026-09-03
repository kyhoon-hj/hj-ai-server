import { CORRELATION_HEADER, createCorrelationId } from '@/lib/api-client';
import { isAuthorizedServiceAgent } from '@/lib/server/agent-auth';

export async function GET(request: Request) {
  const correlationId = request.headers.get(CORRELATION_HEADER) ?? createCorrelationId();
  if (!isAuthorizedServiceAgent(request)) {
    return Response.json(
      { statusCode: 403, code: 'SERVICE_AGENT_REQUIRED', message: '상담원 권한이 필요합니다.', requestId: correlationId },
      { status: 403, headers: { [CORRELATION_HEADER]: correlationId } },
    );
  }
  return Response.json(
    { active: true, role: 'agent', capabilities: ['review:read'], requestId: correlationId },
    { headers: { [CORRELATION_HEADER]: correlationId } },
  );
}
