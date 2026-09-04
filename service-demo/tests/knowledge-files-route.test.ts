import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DELETE, GET, PATCH, POST } from '@/app/api/knowledge/files/route';
import { CORRELATION_HEADER } from '@/lib/api-client';

const requestId = '22222222-2222-4222-8222-222222222222';
const upstreamFile = {
  id: 'file-1',
  appcode: 'private-appcode',
  bucket: 'private-bucket',
  key: 'private/key',
  originalName: 'policy.md',
  mimetype: 'text/markdown',
  size: 123,
  status: 'indexed',
  businessStatus: 'PUBLISHED',
  accessLevel: 'PUBLIC',
  productCodes: [],
  indexedAt: '2026-08-31T00:00:00.000Z',
  createdAt: '2026-08-31T00:00:00.000Z',
  updatedAt: '2026-08-31T00:00:00.000Z',
  _count: { chunks: 2 },
};
const upstreamJob = {
  id: '33333333-3333-4333-8333-333333333333',
  fileId: 'file-1',
  appcode: 'private-appcode',
  operation: 'index',
  status: 'queued',
  attempt: 0,
  maxAttempts: 3,
  idempotencyKey: 'private-idempotency-key',
  errorCode: null,
  errorMessage: null,
  retryable: false,
  nextAttemptAt: null,
  requestedAt: '2026-08-31T00:00:00.000Z',
  startedAt: null,
  completedAt: null,
};

beforeEach(() => {
  process.env.AI_SERVER_APP_ID_STORE_A = 'app-a';
  process.env.AI_SERVER_KNOWLEDGE_OPERATOR_KEY = 'operator-only';
  process.env.SERVICE_DEMO_MANAGER_EMAILS = 'manager@example.test';
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.AI_SERVER_APP_ID_STORE_A;
  delete process.env.AI_SERVER_KNOWLEDGE_OPERATOR_KEY;
  delete process.env.SERVICE_DEMO_MANAGER_EMAILS;
});

describe('knowledge files BFF', () => {
  it.each([['TimeoutError', 504, 'UPSTREAM_TIMEOUT'], ['TypeError', 503, 'KNOWLEDGE_ADMIN_REQUEST_FAILED']] as const)(
    'normalizes %s without exposing upstream details', async (name, status, code) => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(Object.assign(new Error('PRIVATE_OPERATOR_KEY_OR_URL'), { name }));
      const response = await GET(new Request('http://service.test/api/knowledge/files?tenantId=STORE_A&jobId=job-1', { headers: { [CORRELATION_HEADER]: requestId, 'oai-authenticated-user-email': 'manager@example.test' } }));
      expect(response.status).toBe(status);
      expect(response.headers.get(CORRELATION_HEADER)).toBe(requestId);
      const body = await response.json();
      expect(body).toMatchObject({ code, requestId });
      expect(JSON.stringify(body)).not.toContain('PRIVATE_OPERATOR');
    },
  );
  it('lists sanitized tenant files without exposing the operator key or storage path', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify([upstreamFile]), {
          status: 200,
          headers: { [CORRELATION_HEADER]: requestId },
        }),
      );
    const response = await GET(
      new Request('http://service.test/api/knowledge/files?tenantId=STORE_A', {
        headers: {
          [CORRELATION_HEADER]: requestId,
          'oai-authenticated-user-email': 'manager@example.test',
        },
      }),
    );
    const body = (await response.json()) as {
      tenantId: string;
      files: Array<{ id: string; name: string; chunkCount: number }>;
    };
    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'http://127.0.0.1:11000/admin/v1/knowledge/apps/app-a/files',
    );
    expect(headers.get('x-admin-key')).toBe('operator-only');
    expect(body).toMatchObject({
      tenantId: 'STORE_A',
      files: [{ id: 'file-1', name: 'policy.md', chunkCount: 2 }],
    });
    expect(JSON.stringify(body)).not.toContain('operator-only');
    expect(JSON.stringify(body)).not.toContain('private-bucket');
    expect(JSON.stringify(body)).not.toContain('private/key');
  });

  it('uploads, publishes, and queues a supported file in one user action', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ...upstreamFile,
            status: 'uploaded',
            _count: { chunks: 0 },
          }),
          { status: 201 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(upstreamFile), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(upstreamJob), {
          status: 202,
          headers: { [CORRELATION_HEADER]: requestId },
        }),
      );
    const form = new FormData();
    form.set('tenantId', 'STORE_A');
    form.set(
      'file',
      new File(['# policy'], 'policy.md', { type: 'text/markdown' }),
    );
    const response = await POST(
      new Request('http://service.test/api/knowledge/files', {
        method: 'POST',
        body: form,
        headers: {
          [CORRELATION_HEADER]: requestId,
          'oai-authenticated-user-email': 'manager@example.test',
        },
      }),
    );
    expect(response.status).toBe(202);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1][0]).toBe(
      'http://127.0.0.1:11000/admin/v1/knowledge/apps/app-a/files/file-1/policy',
    );
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      method: 'PATCH',
      body: JSON.stringify({
        accessLevel: 'PUBLIC',
        businessStatus: 'PUBLISHED',
      }),
    });
    expect(fetchMock.mock.calls[2][0]).toBe(
      'http://127.0.0.1:11000/admin/v1/knowledge/apps/app-a/files/file-1/index-jobs',
    );
    const jobHeaders = new Headers(fetchMock.mock.calls[2][1]?.headers);
    expect(jobHeaders.get('idempotency-key')).toBe(`upload-${requestId}`);
    const body = (await response.json()) as {
      file: { name: string };
      job: { id: string; status: string; canRetry: boolean };
    };
    expect(body).toMatchObject({
      file: { name: 'policy.md' },
      job: { id: upstreamJob.id, status: 'queued', canRetry: false },
    });
    expect(JSON.stringify(body)).not.toContain('private-appcode');
    expect(JSON.stringify(body)).not.toContain('private-idempotency-key');
  });

  it('returns a sanitized indexing job status', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            ...upstreamJob,
            status: 'failed',
            attempt: 1,
            retryable: true,
            errorMessage: 'private S3 path',
          }),
          { status: 200 },
        ),
      );
    const response = await GET(
      new Request(
        `http://service.test/api/knowledge/files?tenantId=STORE_A&jobId=${upstreamJob.id}`,
        { headers: { 'oai-authenticated-user-email': 'manager@example.test' } },
      ),
    );
    const body = (await response.json()) as {
      job: { status: string; attempt: number; canRetry: boolean };
    };
    expect(fetchMock.mock.calls[0][0]).toBe(
      `http://127.0.0.1:11000/admin/v1/knowledge/apps/app-a/index-jobs/${upstreamJob.id}`,
    );
    expect(body.job).toMatchObject({
      status: 'failed',
      attempt: 1,
      canRetry: true,
    });
    expect(JSON.stringify(body)).not.toContain('private S3 path');
  });

  it('queues reindex and retries failed jobs through tenant-scoped endpoints', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ...upstreamJob, operation: 'reindex' }), {
          status: 202,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ ...upstreamJob, status: 'queued', attempt: 1 }),
          { status: 202 },
        ),
      );
    const headers = {
      'content-type': 'application/json',
      'oai-authenticated-user-email': 'manager@example.test',
      [CORRELATION_HEADER]: requestId,
    };
    const reindexResponse = await PATCH(
      new Request('http://service.test/api/knowledge/files', {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          tenantId: 'STORE_A',
          fileId: 'file-1',
          action: 'reindex',
        }),
      }),
    );
    const retryResponse = await PATCH(
      new Request('http://service.test/api/knowledge/files', {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          tenantId: 'STORE_A',
          jobId: upstreamJob.id,
          action: 'retry-job',
        }),
      }),
    );
    expect(reindexResponse.status).toBe(202);
    expect(retryResponse.status).toBe(202);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'http://127.0.0.1:11000/admin/v1/knowledge/apps/app-a/files/file-1/reindex-jobs',
    );
    expect(fetchMock.mock.calls[1][0]).toBe(
      `http://127.0.0.1:11000/admin/v1/knowledge/apps/app-a/index-jobs/${upstreamJob.id}/retry`,
    );
  });

  it('does not index an uploaded file when publishing its customer access policy fails', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ...upstreamFile,
            status: 'uploaded',
            _count: { chunks: 0 },
          }),
          { status: 201 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'policy failed' }), {
          status: 400,
        }),
      );
    const form = new FormData();
    form.set('tenantId', 'STORE_A');
    form.set(
      'file',
      new File(['# policy'], 'policy.md', { type: 'text/markdown' }),
    );
    const response = await POST(
      new Request('http://service.test/api/knowledge/files', {
        method: 'POST',
        body: form,
        headers: { 'oai-authenticated-user-email': 'manager@example.test' },
      }),
    );
    expect(response.status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).endsWith('/index')),
    ).toBe(false);
  });

  it('rejects unsupported files before contacting the AI Server', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const form = new FormData();
    form.set('tenantId', 'STORE_A');
    form.set('file', new File(['binary'], 'script.exe'));
    const response = await POST(
      new Request('http://service.test/api/knowledge/files', {
        method: 'POST',
        body: form,
        headers: { 'oai-authenticated-user-email': 'manager@example.test' },
      }),
    );
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('archives only a file inside the selected tenant app', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ ...upstreamFile, status: 'archived' }), {
          status: 200,
        }),
      );
    const response = await DELETE(
      new Request('http://service.test/api/knowledge/files', {
        method: 'DELETE',
        headers: {
          'content-type': 'application/json',
          'oai-authenticated-user-email': 'manager@example.test',
        },
        body: JSON.stringify({ tenantId: 'STORE_A', fileId: 'file-1' }),
      }),
    );
    expect(response.status).toBe(200);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'http://127.0.0.1:11000/admin/v1/knowledge/apps/app-a/files/file-1',
    );
  });

  it('rejects write and list access without an authorized manager identity', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const response = await GET(
      new Request('http://service.test/api/knowledge/files?tenantId=STORE_A'),
    );
    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
