export type TenantId = 'STORE_A' | 'STORE_B';

export interface AnswerRequest {
  tenantId: TenantId;
  query: string;
}

export interface AnswerSource {
  id: string;
  name: string;
  score: number;
  sourceType: 'KNOWLEDGE_DOCUMENT' | 'SUPPORT_BOARD_APPROVED_ANSWER';
  page: number | null;
  productCode: string | null;
}

export interface AnswerResult {
  query: string;
  answer: string;
  answerable: boolean;
  sources: AnswerSource[];
  requestId: string;
  latencyMs: number;
}

export interface UpstreamAnswerSource {
  chunkId?: string;
  fileId?: string;
  fileName?: string;
  score?: number;
  sourceType?: 'KNOWLEDGE_DOCUMENT' | 'SUPPORT_BOARD_APPROVED_ANSWER';
  metadata?: Record<string, unknown> | null;
}

export interface UpstreamAnswer {
  query?: string;
  answer?: string;
  response?: string;
  answerable?: boolean;
  sources?: UpstreamAnswerSource[];
  requestId?: string;
  latencyMs?: number;
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function sanitizeAnswerSource(source: UpstreamAnswerSource, index: number): AnswerSource {
  const rawPage = source.metadata?.pageNumber ?? source.metadata?.page;
  const page = typeof rawPage === 'number' && Number.isInteger(rawPage) && rawPage > 0 ? rawPage : null;
  return {
    id: source.fileId ?? source.chunkId ?? `SOURCE_${index + 1}`,
    name: source.fileName ?? `근거 ${index + 1}`,
    score: typeof source.score === 'number' ? source.score : 0,
    sourceType: source.sourceType ?? 'KNOWLEDGE_DOCUMENT',
    page,
    productCode: optionalString(source.metadata?.productCode),
  };
}

export function toAnswerResult(payload: UpstreamAnswer, correlationId: string, query: string): AnswerResult {
  const answer = payload.answer ?? payload.response ?? '등록된 자료에서 확인할 수 없습니다.';
  const sources = (payload.sources ?? []).map(sanitizeAnswerSource);
  return {
    query: payload.query ?? query,
    answer,
    answerable: payload.answerable === true && sources.length > 0,
    sources,
    requestId: payload.requestId ?? correlationId,
    latencyMs: typeof payload.latencyMs === 'number' ? payload.latencyMs : 0,
  };
}
