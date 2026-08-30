import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/answers/route';
import { CORRELATION_HEADER } from '@/lib/api-client';

const requestId = '11111111-1111-4111-8111-111111111111';

function answerRequest(body: unknown) {
  return new Request('http://service-demo.test/api/answers', {
    method: 'POST',
    headers: { 'content-type': 'application/json', [CORRELATION_HEADER]: requestId },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.AI_SERVER_APPKEY_STORE_A;
  delete process.env.AI_SERVER_APPKEY_STORE_B;
});

describe('answers BFF', () => {
  it('rejects unknown tenants before contacting the AI Server', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const response = await POST(answerRequest({ tenantId: 'STORE_X', query: '질문' }));
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails safely without exposing configuration when the tenant key is absent', async () => {
    const response = await POST(answerRequest({ tenantId: 'STORE_A', query: '운영시간' }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ statusCode: 503, code: 'SERVICE_DEMO_NOT_CONFIGURED', message: '현재 AI 상담 연결을 준비 중입니다.', requestId });
  });

  it('keeps the appkey server-side and returns a sanitized grounded answer', async () => {
    process.env.AI_SERVER_APPKEY_STORE_A = 'server-only-appkey';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      query: '운영시간', answer: '오늘은 오후 10시까지 운영합니다.', answerable: true, requestId,
      sources: [{ fileId: 'file-1', fileName: '운영시간 안내.pdf', key: 'private/s3/key', score: 0.88, metadata: { page: 2, credential: 'never-expose' } }],
    }), { status: 200, headers: { [CORRELATION_HEADER]: requestId } }));

    const response = await POST(answerRequest({ tenantId: 'STORE_A', query: '운영시간' }));
    const upstreamHeaders = new Headers(fetchMock.mock.calls[0][1]?.headers);
    expect(upstreamHeaders.get('appkey')).toBe('server-only-appkey');
    const body = await response.json();
    expect(body).toMatchObject({ answerable: true, requestId, sources: [{ id: 'file-1', name: '운영시간 안내.pdf', page: 2 }] });
    expect(JSON.stringify(body)).not.toContain('server-only-appkey');
    expect(JSON.stringify(body)).not.toContain('private/s3/key');
    expect(JSON.stringify(body)).not.toContain('never-expose');
  });

  it('preserves strict no-answer without inventing sources', async () => {
    process.env.AI_SERVER_APPKEY_STORE_B = 'server-only-appkey-b';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ answer: '등록된 자료에서 확인할 수 없습니다.', answerable: false, sources: [], requestId }), { status: 200, headers: { [CORRELATION_HEADER]: requestId } }));
    const response = await POST(answerRequest({ tenantId: 'STORE_B', query: '다음 입고일' }));
    expect(await response.json()).toMatchObject({ answerable: false, sources: [], requestId });
  });
});
