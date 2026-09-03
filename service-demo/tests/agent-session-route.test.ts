import { afterEach, describe, expect, it } from 'vitest';
import { POST } from '@/app/api/agent-session/route';

afterEach(() => delete process.env.SERVICE_DEMO_LOCAL_AGENT_TOKEN);

describe('local agent session', () => {
  it('issues a separate HttpOnly cookie for same-origin local preview', async () => {
    process.env.SERVICE_DEMO_LOCAL_AGENT_TOKEN = 'agent-local-token';
    const response = await POST(new Request('http://127.0.0.1:11002/api/agent-session', { method: 'POST', headers: { origin: 'http://127.0.0.1:11002' } }));
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain('service_demo_agent=agent-local-token; HttpOnly; SameSite=Strict');
  });

  it('fails closed outside the local preview', async () => {
    process.env.SERVICE_DEMO_LOCAL_AGENT_TOKEN = 'agent-local-token';
    const response = await POST(new Request('https://service.example/api/agent-session', { method: 'POST', headers: { origin: 'https://service.example' } }));
    expect(response.status).toBe(404);
  });
});
