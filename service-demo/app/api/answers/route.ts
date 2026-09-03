import { CORRELATION_HEADER, createCorrelationId } from '@/lib/api-client';
import { toAnswerResult, type AnswerRequest, type UpstreamAnswer } from '@/lib/knowledge-contract';
import { expandKnowledgeQuery } from '@/lib/server/query-expansion';
import { containsSensitiveCustomerData } from '@/lib/server/sensitive-query';
import { getAnswerEndpoint, getTenantAppkey, isTenantId } from '@/lib/server/tenant-config';

const NO_ANSWER_MESSAGE = '등록된 자료에서 확인할 수 없습니다. 상담원 검토를 요청해주세요.';
const DEFAULT_SCORE_THRESHOLD = 0.35;
const EXPANDED_QUERY_SCORE_THRESHOLD = 0.4;

function errorResponse(status: number, code: string, message: string, correlationId: string) {
  return Response.json(
    { statusCode: status, code, message, requestId: correlationId },
    { status, headers: { [CORRELATION_HEADER]: correlationId } },
  );
}

export async function POST(request: Request) {
  const correlationId = request.headers.get(CORRELATION_HEADER) ?? createCorrelationId();
  const body = await request.json().catch(() => null) as Partial<AnswerRequest> | null;
  if (!body || !isTenantId(body.tenantId) || typeof body.query !== 'string') {
    return errorResponse(400, 'INVALID_ANSWER_REQUEST', '매장과 질문을 확인해주세요.', correlationId);
  }

  const query = body.query.trim();
  if (!query || query.length > 1000) {
    return errorResponse(400, 'INVALID_QUERY', '질문은 1자 이상 1,000자 이하로 입력해주세요.', correlationId);
  }
  if (containsSensitiveCustomerData(query)) {
    return errorResponse(400, 'SENSITIVE_DATA_NOT_ALLOWED', '이메일, 전화번호, 주민등록번호, 주문번호를 제외하고 질문해주세요.', correlationId);
  }

  const appkey = getTenantAppkey(body.tenantId);
  if (!appkey) {
    return errorResponse(503, 'SERVICE_DEMO_NOT_CONFIGURED', '현재 AI 상담 연결을 준비 중입니다.', correlationId);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const retrievalQuery = expandKnowledgeQuery(body.tenantId, query);
    const scoreThreshold = retrievalQuery === query ? DEFAULT_SCORE_THRESHOLD : EXPANDED_QUERY_SCORE_THRESHOLD;
    const upstream = await fetch(getAnswerEndpoint(), {
      method: 'POST',
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        appkey,
        [CORRELATION_HEADER]: correlationId,
      },
      body: JSON.stringify({
        query: retrievalQuery,
        limit: 5,
        scoreThreshold,
        answerStyle: 'concise',
        includeSources: true,
        includeSourceContent: false,
        strict: true,
        noAnswerMessage: NO_ANSWER_MESSAGE,
        maxTokens: 512,
        temperature: 0.1,
      }),
    });
    const upstreamCorrelationId = upstream.headers.get(CORRELATION_HEADER) ?? correlationId;
    const payload = await upstream.json().catch(() => null) as UpstreamAnswer | { message?: string } | null;
    if (!upstream.ok) {
      const status = upstream.status === 401 || upstream.status === 403 ? 502 : upstream.status;
      const code = upstream.status === 401 || upstream.status === 403 ? 'UPSTREAM_AUTHENTICATION_FAILED' : 'AI_SERVER_REQUEST_FAILED';
      return errorResponse(status, code, 'AI 상담 요청을 처리하지 못했습니다.', upstreamCorrelationId);
    }
    return Response.json(toAnswerResult({ ...(payload as UpstreamAnswer), query }, upstreamCorrelationId, query), {
      headers: { [CORRELATION_HEADER]: upstreamCorrelationId },
    });
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === 'AbortError';
    return errorResponse(503, timedOut ? 'AI_SERVER_TIMEOUT' : 'AI_SERVER_UNREACHABLE', timedOut ? 'AI 상담 응답 시간이 초과되었습니다.' : 'AI 상담 서버에 연결할 수 없습니다.', correlationId);
  } finally {
    clearTimeout(timeout);
  }
}
