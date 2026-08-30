import type { TenantId } from '@/lib/knowledge-contract';

const tenantEnvironmentKeys: Record<TenantId, string> = {
  STORE_A: 'AI_SERVER_APPKEY_STORE_A',
  STORE_B: 'AI_SERVER_APPKEY_STORE_B',
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
  const rawPrefix = process.env.AI_SERVER_API_PREFIX?.trim() || '/v1';
  const prefix = `/${rawPrefix.replace(/^\/+|\/+$/g, '')}`;
  return `${baseUrl}${prefix}/knowledge/answers`;
}
