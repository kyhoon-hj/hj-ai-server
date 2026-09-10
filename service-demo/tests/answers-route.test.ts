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

  it('blocks personal data before it can reach upstream logs and does not echo it', async () => {
    process.env.AI_SERVER_APPKEY_STORE_A = 'server-only-appkey';
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const sensitiveQuery = '제 전화번호 010-1234-5678로 연락해주세요';
    const response = await POST(answerRequest({ tenantId: 'STORE_A', query: sensitiveQuery }));
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    const body = await response.json();
    expect(body).toMatchObject({ code: 'SENSITIVE_DATA_NOT_ALLOWED', requestId });
    expect(JSON.stringify(body)).not.toContain('010-1234-5678');
  });

  it('keeps the appkey server-side and returns a sanitized grounded answer', async () => {
    process.env.AI_SERVER_APPKEY_STORE_A = 'server-only-appkey';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      query: '운영시간', answer: '오늘은 오후 10시까지 운영합니다.', answerable: true, requestId,
      sources: [{ fileId: 'file-1', fileName: '운영시간 안내.pdf', key: 'private/s3/key', score: 0.88, metadata: { page: 2, credential: 'never-expose' } }],
    }), { status: 200, headers: { [CORRELATION_HEADER]: requestId } }));

    const response = await POST(answerRequest({ tenantId: 'STORE_A', query: '운영시간' }));
    const upstreamHeaders = new Headers(fetchMock.mock.calls[0][1]?.headers);
    const upstreamBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(upstreamHeaders.get('appkey')).toBe('server-only-appkey');
    expect(upstreamBody).toMatchObject({ limit: 5, strict: true });
    expect(upstreamBody).toMatchObject({ answerStyle: 'detailed', maxTokens: 768 });
    expect(upstreamBody.system).toContain('등록 자료 기준');
    expect(upstreamBody).not.toHaveProperty('scoreThreshold');
    expect(upstreamBody.query).toContain('STORE_A 매장의 운영 및 영업 시간');
    const body = await response.json();
    expect(body).toMatchObject({ answerable: true, requestId, sources: [{ id: 'file-1', name: '운영시간 안내.pdf', page: 2 }] });
    expect((body as { query?: string }).query).toBe('운영시간');
    expect(JSON.stringify(body)).not.toContain('server-only-appkey');
    expect(JSON.stringify(body)).not.toContain('private/s3/key');
    expect(JSON.stringify(body)).not.toContain('never-expose');
  });

  it('preserves strict no-answer without inventing sources', async () => {
    process.env.AI_SERVER_APPKEY_STORE_B = 'server-only-appkey-b';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ answer: '등록된 자료에서 확인할 수 없습니다.', answerable: false, sources: [], requestId }), { status: 200, headers: { [CORRELATION_HEADER]: requestId } }));
    const response = await POST(answerRequest({ tenantId: 'STORE_B', query: '다음 입고일' }));
    const upstreamBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(upstreamBody).toMatchObject({ query: '다음 입고일', strict: true });
    expect(await response.json()).toMatchObject({ answerable: false, sources: [], requestId });
  });

  it('does not discard low-similarity catalog evidence and preserves the selected tenant', async () => {
    process.env.AI_SERVER_APPKEY_STORE_A = 'catalog-appkey-a';
    process.env.AI_SERVER_APPKEY_STORE_B = 'catalog-appkey-b';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      answer: '등록된 상품은 멀티탭, 건전지, 리빙박스입니다.', answerable: true,
      sources: [{ fileId: 'products-a', fileName: 'store-a-products.csv', score: 0.02984 }], requestId,
    }), { status: 200 }));
    const response = await POST(answerRequest({ tenantId: 'STORE_A', query: '상품의 종류가 뭐가 있나' }));
    const sent = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(sent).toMatchObject({ query: '상품의 종류가 뭐가 있나', limit: 5, strict: true, includeSources: true });
    expect(sent).not.toHaveProperty('scoreThreshold');
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get('appkey')).toBe('catalog-appkey-a');
    expect(await response.json()).toMatchObject({ answerable: true, sources: [{ id: 'products-a', name: 'store-a-products.csv' }] });
  });
});
