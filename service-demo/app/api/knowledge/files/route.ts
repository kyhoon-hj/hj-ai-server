import { CORRELATION_HEADER, createCorrelationId } from '@/lib/api-client';
import { sanitizeKnowledgeFile, sanitizeKnowledgeIndexJob } from '@/lib/knowledge-management-contract';
import type { TenantId } from '@/lib/knowledge-contract';
import { callKnowledgeAdmin } from '@/lib/server/knowledge-admin-client';
import { isAuthorizedKnowledgeManager } from '@/lib/server/manager-auth';
import { isTenantId } from '@/lib/server/tenant-config';

const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(['md', 'csv', 'pdf', 'docx', 'xlsx']);

function errorResponse(status: number, code: string, message: string, correlationId: string) {
  return Response.json({ statusCode: status, code, message, requestId: correlationId }, { status, headers: { [CORRELATION_HEADER]: correlationId } });
}

function upstreamError(result: NonNullable<Awaited<ReturnType<typeof callKnowledgeAdmin>>>) {
  if (result.response.status === 504) return errorResponse(504, 'UPSTREAM_TIMEOUT', 'AI 서버 응답 시간이 초과되었습니다. 작업 상태를 다시 확인해주세요.', result.correlationId);
  const status = result.response.status === 401 || result.response.status === 403 ? 502 : result.response.status;
  const code = result.response.status === 401 || result.response.status === 403 ? 'UPSTREAM_ADMIN_AUTHENTICATION_FAILED' : 'KNOWLEDGE_ADMIN_REQUEST_FAILED';
  const message = status === 413 ? '파일은 최대 30MB까지 업로드할 수 있습니다.' : '지식 문서 요청을 처리하지 못했습니다.';
  return errorResponse(status, code, message, result.correlationId);
}

function tenantFromUrl(request: Request): TenantId | null {
  const tenantId = new URL(request.url).searchParams.get('tenantId');
  return isTenantId(tenantId) ? tenantId : null;
}

function authorizationError(request: Request, correlationId: string): Response | null {
  return isAuthorizedKnowledgeManager(request) ? null : errorResponse(403, 'KNOWLEDGE_MANAGER_REQUIRED', '매장 관리자 권한이 필요합니다.', correlationId);
}

export async function GET(request: Request) {
  const correlationId = request.headers.get(CORRELATION_HEADER) ?? createCorrelationId();
  const denied = authorizationError(request, correlationId);
  if (denied) return denied;
  const tenantId = tenantFromUrl(request);
  if (!tenantId) return errorResponse(400, 'INVALID_TENANT', '매장을 확인해주세요.', correlationId);
  const jobId = new URL(request.url).searchParams.get('jobId');
  if (jobId) {
    const result = await callKnowledgeAdmin(tenantId, `/index-jobs/${encodeURIComponent(jobId)}`, correlationId);
    if (!result) return errorResponse(503, 'KNOWLEDGE_ADMIN_NOT_CONFIGURED', '지식 관리 연결을 준비 중입니다.', correlationId);
    if (!result.response.ok) return upstreamError(result);
    return Response.json(
      { tenantId, job: sanitizeKnowledgeIndexJob(result.payload as Parameters<typeof sanitizeKnowledgeIndexJob>[0]), requestId: result.correlationId },
      { headers: { [CORRELATION_HEADER]: result.correlationId } },
    );
  }
  const result = await callKnowledgeAdmin(tenantId, '/files', correlationId);
  if (!result) return errorResponse(503, 'KNOWLEDGE_ADMIN_NOT_CONFIGURED', '지식 관리 연결을 준비 중입니다.', correlationId);
  if (!result.response.ok) return upstreamError(result);
  const files = Array.isArray(result.payload) ? result.payload.map(sanitizeKnowledgeFile) : [];
  return Response.json({ tenantId, files, requestId: result.correlationId }, { headers: { [CORRELATION_HEADER]: result.correlationId } });
}

export async function POST(request: Request) {
  const correlationId = request.headers.get(CORRELATION_HEADER) ?? createCorrelationId();
  const denied = authorizationError(request, correlationId);
  if (denied) return denied;
  const form = await request.formData().catch(() => null);
  const tenantId = form?.get('tenantId');
  const file = form?.get('file');
  if (!isTenantId(tenantId) || !(file instanceof File)) return errorResponse(400, 'INVALID_UPLOAD_REQUEST', '매장과 파일을 확인해주세요.', correlationId);
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (!file.size || file.size > MAX_UPLOAD_BYTES || !ALLOWED_EXTENSIONS.has(extension)) {
    return errorResponse(400, 'INVALID_KNOWLEDGE_FILE', 'MD, CSV, PDF, DOCX, XLSX 파일을 30MB 이하로 선택해주세요.', correlationId);
  }

  const upstreamForm = new FormData();
  upstreamForm.set('file', file, file.name);
  const uploaded = await callKnowledgeAdmin(tenantId, '/files', correlationId, { method: 'POST', body: upstreamForm });
  if (!uploaded) return errorResponse(503, 'KNOWLEDGE_ADMIN_NOT_CONFIGURED', '지식 관리 연결을 준비 중입니다.', correlationId);
  if (!uploaded.response.ok) return upstreamError(uploaded);
  const uploadedFile = sanitizeKnowledgeFile(uploaded.payload as Parameters<typeof sanitizeKnowledgeFile>[0]);
  if (!uploadedFile.id) return errorResponse(502, 'INVALID_UPSTREAM_RESPONSE', '업로드 결과를 확인하지 못했습니다.', uploaded.correlationId);

  const filePath = `/files/${encodeURIComponent(uploadedFile.id)}`;
  const published = await callKnowledgeAdmin(tenantId, `${filePath}/policy`, uploaded.correlationId, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accessLevel: 'PUBLIC', businessStatus: 'PUBLISHED' }),
  });
  if (!published) return errorResponse(503, 'KNOWLEDGE_ADMIN_NOT_CONFIGURED', '지식 관리 연결을 준비 중입니다.', uploaded.correlationId);
  if (!published.response.ok) return upstreamError(published);

  const queued = await callKnowledgeAdmin(tenantId, `${filePath}/index-jobs`, published.correlationId, {
    method: 'POST',
    headers: { 'idempotency-key': `upload-${published.correlationId}` },
  });
  if (!queued) return errorResponse(503, 'KNOWLEDGE_ADMIN_NOT_CONFIGURED', '지식 관리 연결을 준비 중입니다.', published.correlationId);
  if (!queued.response.ok) return upstreamError(queued);
  return Response.json(
    {
      tenantId,
      file: sanitizeKnowledgeFile(published.payload as Parameters<typeof sanitizeKnowledgeFile>[0]),
      job: sanitizeKnowledgeIndexJob(queued.payload as Parameters<typeof sanitizeKnowledgeIndexJob>[0]),
      requestId: queued.correlationId,
    },
    { status: 202, headers: { [CORRELATION_HEADER]: queued.correlationId } },
  );
}

export async function PATCH(request: Request) {
  const correlationId = request.headers.get(CORRELATION_HEADER) ?? createCorrelationId();
  const denied = authorizationError(request, correlationId);
  if (denied) return denied;
  const body = await request.json().catch(() => null) as { tenantId?: unknown; fileId?: unknown; jobId?: unknown; action?: unknown } | null;
  if (!body || !isTenantId(body.tenantId)) return errorResponse(400, 'INVALID_INDEX_JOB_REQUEST', '인덱싱 작업을 확인해주세요.', correlationId);
  const isReindex = body.action === 'reindex' && typeof body.fileId === 'string';
  const isRetry = body.action === 'retry-job' && typeof body.jobId === 'string';
  if (!isReindex && !isRetry) return errorResponse(400, 'INVALID_INDEX_JOB_REQUEST', '인덱싱 작업을 확인해주세요.', correlationId);
  const path = isReindex
    ? `/files/${encodeURIComponent(body.fileId as string)}/reindex-jobs`
    : `/index-jobs/${encodeURIComponent(body.jobId as string)}/retry`;
  const result = await callKnowledgeAdmin(body.tenantId, path, correlationId, {
    method: 'POST',
    headers: isReindex ? { 'idempotency-key': `reindex-${correlationId}` } : undefined,
  });
  if (!result) return errorResponse(503, 'KNOWLEDGE_ADMIN_NOT_CONFIGURED', '지식 관리 연결을 준비 중입니다.', correlationId);
  if (!result.response.ok) return upstreamError(result);
  return Response.json(
    { tenantId: body.tenantId, job: sanitizeKnowledgeIndexJob(result.payload as Parameters<typeof sanitizeKnowledgeIndexJob>[0]), requestId: result.correlationId },
    { status: 202, headers: { [CORRELATION_HEADER]: result.correlationId } },
  );
}

export async function DELETE(request: Request) {
  const correlationId = request.headers.get(CORRELATION_HEADER) ?? createCorrelationId();
  const denied = authorizationError(request, correlationId);
  if (denied) return denied;
  const body = await request.json().catch(() => null) as { tenantId?: unknown; fileId?: unknown } | null;
  if (!body || !isTenantId(body.tenantId) || typeof body.fileId !== 'string') return errorResponse(400, 'INVALID_ARCHIVE_REQUEST', '보관할 문서를 확인해주세요.', correlationId);
  const result = await callKnowledgeAdmin(body.tenantId, `/files/${encodeURIComponent(body.fileId)}`, correlationId, { method: 'DELETE' });
  if (!result) return errorResponse(503, 'KNOWLEDGE_ADMIN_NOT_CONFIGURED', '지식 관리 연결을 준비 중입니다.', correlationId);
  if (!result.response.ok) return upstreamError(result);
  return Response.json({ tenantId: body.tenantId, file: sanitizeKnowledgeFile(result.payload as Parameters<typeof sanitizeKnowledgeFile>[0]), requestId: result.correlationId }, { headers: { [CORRELATION_HEADER]: result.correlationId } });
}
