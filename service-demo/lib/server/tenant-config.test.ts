import { afterEach, describe, expect, it } from 'vitest';
import { getAnswerEndpoint } from './tenant-config';

afterEach(() => {
  delete process.env.AI_SERVER_BASE_URL;
  delete process.env.AI_SERVER_API_PREFIX;
});

describe('AI Server answer endpoint', () => {
  it('uses the current root-level public contract by default', () => {
    expect(getAnswerEndpoint()).toBe('http://127.0.0.1:11000/knowledge/answers');
  });

  it('supports deployments with a configured global prefix', () => {
    process.env.AI_SERVER_BASE_URL = 'https://ai.example.test/';
    process.env.AI_SERVER_API_PREFIX = '/v1/';
    expect(getAnswerEndpoint()).toBe('https://ai.example.test/v1/knowledge/answers');
  });
});

describe('AI Server knowledge admin configuration', () => {
  it('requires both the tenant app id and server-only operator key', async () => {
    const { getKnowledgeAdminConfig } = await import('./tenant-config');
    process.env.AI_SERVER_APP_ID_STORE_A = 'app-a';
    process.env.AI_SERVER_KNOWLEDGE_OPERATOR_KEY = 'operator-only';
    expect(getKnowledgeAdminConfig('STORE_A')).toEqual({ baseUrl: 'http://127.0.0.1:11000', appId: 'app-a', operatorKey: 'operator-only' });
    delete process.env.AI_SERVER_KNOWLEDGE_OPERATOR_KEY;
    expect(getKnowledgeAdminConfig('STORE_A')).toBeNull();
    delete process.env.AI_SERVER_APP_ID_STORE_A;
  });
});
