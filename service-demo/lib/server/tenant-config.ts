import type { TenantId } from '@/lib/knowledge-contract';

export const AI_SERVER_USER_AGENT = 'HJ-Service-Demo/1.0';

const tenantEnvironmentKeys: Record<TenantId, string> = {
  STORE_A: 'AI_SERVER_APPKEY_STORE_A',
  STORE_B: 'AI_SERVER_APPKEY_STORE_B',
};

const tenantAppIdEnvironmentKeys: Record<TenantId, string> = {
  STORE_A: 'AI_SERVER_APP_ID_STORE_A',
  STORE_B: 'AI_SERVER_APP_ID_STORE_B',
};

export function isTenantId(value: unknown): value is TenantId {
  return value === 'STORE_A' || value === 'STORE_B';
}

export function getTenantAppkey(tenantId: TenantId): string | null {
  const value = process.env[tenantEnvironmentKeys[tenantId]]?.trim();
  return value || null;
}

export function getAnswerEndpoint(): string {
  const baseUrl = (process.env.AI_SERVER_BASE_URL ?? 'http://127.0.0.1:11000').replace(/\/$/, '');
  const rawPrefix = process.env.AI_SERVER_API_PREFIX?.trim() ?? '';
  const normalizedPrefix = rawPrefix.replace(/^\/+|\/+$/g, '');
  const prefix = normalizedPrefix ? `/${normalizedPrefix}` : '';
  return `${baseUrl}${prefix}/knowledge/answers`;
}

export function getKnowledgeAdminConfig(tenantId: TenantId): { baseUrl: string; appId: string; operatorKey: string } | null {
  const baseUrl = (process.env.AI_SERVER_BASE_URL ?? 'http://127.0.0.1:11000').replace(/\/$/, '');
  const appId = process.env[tenantAppIdEnvironmentKeys[tenantId]]?.trim();
  const operatorKey = process.env.AI_SERVER_KNOWLEDGE_OPERATOR_KEY?.trim();
  return appId && operatorKey ? { baseUrl, appId, operatorKey } : null;
}
