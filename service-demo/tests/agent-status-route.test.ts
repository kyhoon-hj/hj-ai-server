import { afterEach, describe, expect, it } from 'vitest';
import { GET } from '@/app/api/agent/status/route';

afterEach(() => {
  delete process.env.SERVICE_DEMO_AGENT_EMAILS;
  delete process.env.SERVICE_DEMO_LOCAL_AGENT_TOKEN;
});

describe('agent status API', () => {
  it('returns an agent-only capability response without identity details', async () => {
    process.env.SERVICE_DEMO_AGENT_EMAILS = 'agent@example.test';
    const response = await GET(new Request('http://service.test/api/agent/status', { headers: { 'oai-authenticated-user-email': 'agent@example.test' } }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ active: true, role: 'agent', capabilities: ['review:read'] });
    expect(JSON.stringify(body)).not.toContain('agent@example.test');
  });

  it('rejects a manager identity that is not also an allowed agent', async () => {
    process.env.SERVICE_DEMO_AGENT_EMAILS = 'agent@example.test';
    const response = await GET(new Request('http://service.test/api/agent/status', { headers: { 'oai-authenticated-user-email': 'manager@example.test' } }));
    expect(response.status).toBe(403);
  });
});
