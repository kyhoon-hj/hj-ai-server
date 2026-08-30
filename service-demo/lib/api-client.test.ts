import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiFailure, CORRELATION_HEADER, apiRequest, normalizeApiFailure } from './api-client';

afterEach(() => vi.restoreAllMocks());
describe('common API client', () => {
  it('forwards a UUID correlation ID and accepts the response', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json', [CORRELATION_HEADER]: '11111111-1111-4111-8111-111111111111' } }));
    await expect(apiRequest<{ ok: boolean }>('/api/test')).resolves.toEqual({ ok: true });
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get(CORRELATION_HEADER)).toMatch(/^[0-9a-f-]{36}$/);
  });
  it('normalizes unavailable responses as retryable', () => expect(normalizeApiFailure(503, { code: 'DEPENDENCY_UNAVAILABLE', message: '잠시 후 다시 시도', requestId: 'req-1' }, 'fallback')).toMatchObject({ kind: 'unavailable', correlationId: 'req-1', retryable: true }));
  it('keeps permission failures non-retryable', () => { const failure = normalizeApiFailure(403, null, 'req-2'); expect(failure).toBeInstanceOf(ApiFailure); expect(failure).toMatchObject({ kind: 'unauthorized', correlationId: 'req-2', retryable: false }); });
});
