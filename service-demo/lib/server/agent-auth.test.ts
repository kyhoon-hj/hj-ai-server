import { afterEach, describe, expect, it } from 'vitest';
import { isAuthorizedServiceAgent } from './agent-auth';

afterEach(() => {
  delete process.env.SERVICE_DEMO_AGENT_EMAILS;
  delete process.env.SERVICE_DEMO_LOCAL_AGENT_TOKEN;
});

describe('service agent authorization', () => {
  it('accepts only an email in the agent allowlist', () => {
    process.env.SERVICE_DEMO_AGENT_EMAILS = 'agent@example.test';
    expect(isAuthorizedServiceAgent(new Request('http://service.test', { headers: { 'oai-authenticated-user-email': 'agent@example.test' } }))).toBe(true);
    expect(isAuthorizedServiceAgent(new Request('http://service.test', { headers: { 'oai-authenticated-user-email': 'manager@example.test' } }))).toBe(false);
  });

  it('uses a separate HttpOnly local-preview token', () => {
    process.env.SERVICE_DEMO_LOCAL_AGENT_TOKEN = 'agent-local-token';
    expect(isAuthorizedServiceAgent(new Request('http://service.test', { headers: { cookie: 'service_demo_agent=agent-local-token' } }))).toBe(true);
    expect(isAuthorizedServiceAgent(new Request('http://service.test', { headers: { cookie: 'service_demo_manager=agent-local-token' } }))).toBe(false);
  });
});
