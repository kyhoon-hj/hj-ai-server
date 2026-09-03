import { CORRELATION_HEADER } from '@/lib/api-client';
import type { TenantId } from '@/lib/knowledge-contract';
import { getKnowledgeAdminConfig } from './tenant-config';

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
  headers.set('x-admin-key', config.operatorKey);
  headers.set(CORRELATION_HEADER, correlationId);
  const response = await fetch(`${config.baseUrl}/admin/v1/knowledge/apps/${encodeURIComponent(config.appId)}${path}`, {
    ...init,
    headers,
    signal: init.signal ?? AbortSignal.timeout(60_000),
  });
  return {
    response,
    payload: await response.json().catch(() => null),
    correlationId: response.headers.get(CORRELATION_HEADER) ?? correlationId,
  };
}
