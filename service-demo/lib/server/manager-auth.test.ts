import { afterEach, describe, expect, it } from 'vitest';
import { isAuthorizedKnowledgeManager } from './manager-auth';

afterEach(() => {
  delete process.env.SERVICE_DEMO_MANAGER_EMAILS;
  delete process.env.SERVICE_DEMO_LOCAL_MANAGER_TOKEN;
});

describe('isAuthorizedKnowledgeManager', () => {
  it('requires a platform-authenticated email on the server allowlist', () => {
    process.env.SERVICE_DEMO_MANAGER_EMAILS = 'manager@example.test, second@example.test';
    expect(isAuthorizedKnowledgeManager(new Request('http://service.test', { headers: { 'oai-authenticated-user-email': 'manager@example.test' } }))).toBe(true);
    expect(isAuthorizedKnowledgeManager(new Request('http://service.test', { headers: { 'oai-authenticated-user-email': 'customer@example.test' } }))).toBe(false);
    expect(isAuthorizedKnowledgeManager(new Request('http://service.test'))).toBe(false);
  });

  it('accepts the HttpOnly local-preview session token without weakening the email allowlist', () => {
    process.env.SERVICE_DEMO_LOCAL_MANAGER_TOKEN = 'local-secret-token';
    expect(isAuthorizedKnowledgeManager(new Request('http://service.test', { headers: { cookie: 'service_demo_manager=local-secret-token' } }))).toBe(true);
    expect(isAuthorizedKnowledgeManager(new Request('http://service.test', { headers: { cookie: 'service_demo_manager=wrong-token' } }))).toBe(false);
  });
});
