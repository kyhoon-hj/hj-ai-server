import { afterEach, describe, expect, it } from 'vitest';
import { POST } from '@/app/api/manager-session/route';

afterEach(() => delete process.env.SERVICE_DEMO_LOCAL_MANAGER_TOKEN);

describe('local manager session', () => {
  it('issues an HttpOnly cookie only for an explicit same-origin local preview', async () => {
    process.env.SERVICE_DEMO_LOCAL_MANAGER_TOKEN = 'local-secret-token';
    const response = await POST(new Request('http://127.0.0.1:11002/api/manager-session', { method: 'POST', headers: { origin: 'http://127.0.0.1:11002' } }));
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain('service_demo_manager=local-secret-token; HttpOnly; SameSite=Strict');
  });

  it('fails closed outside the local same-origin preview', async () => {
    process.env.SERVICE_DEMO_LOCAL_MANAGER_TOKEN = 'local-secret-token';
    const response = await POST(new Request('https://service.example/api/manager-session', { method: 'POST', headers: { origin: 'https://service.example' } }));
    expect(response.status).toBe(404);
  });
});
