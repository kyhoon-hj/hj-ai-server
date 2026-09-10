import { CORRELATION_HEADER } from '@/lib/api-client';
import type { TenantId } from '@/lib/knowledge-contract';
import { AI_SERVER_USER_AGENT, getKnowledgeAdminConfig } from './tenant-config';

export interface AdminUpstreamResult {
  response: Response;
  payload: unknown;
  correlationId: string;
}

export async function callKnowledgeAdmin(
  tenantId: TenantId,
  path: string,
  correlationId: string,
  init: RequestInit = {},
): Promise<AdminUpstreamResult | null> {
  const config = getKnowledgeAdminConfig(tenantId);
  if (!config) return null;
  const headers = new Headers(init.headers);
  headers.set('user-agent', AI_SERVER_USER_AGENT);
  headers.set('x-admin-key', config.operatorKey);
  headers.set(CORRELATION_HEADER, correlationId);
  try {
    const response = await fetch(
      `${config.baseUrl}/admin/v1/knowledge/apps/${encodeURIComponent(config.appId)}${path}`,
      {
        ...init,
        headers,
        signal: init.signal ?? AbortSignal.timeout(60_000),
      },
    );
    return {
      response,
      payload: await response.json().catch(() => null),
      correlationId: response.headers.get(CORRELATION_HEADER) ?? correlationId,
    };
  } catch (error) {
    const name =
      error && typeof error === 'object' && 'name' in error ? error.name : '';
    const timeout = name === 'TimeoutError' || name === 'AbortError';
    const payload = {
      code: timeout ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNREACHABLE',
      message: timeout
        ? '작업 상태 응답 시간이 초과되었습니다. 잠시 후 다시 확인해주세요.'
        : 'AI 서버에 연결할 수 없습니다.',
      requestId: correlationId,
    };
    return {
      response: Response.json(payload, { status: timeout ? 504 : 503 }),
      payload,
      correlationId,
    };
  }
}
