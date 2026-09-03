export interface KnowledgeFileItem {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  status: string;
  businessStatus: string;
  accessLevel: string;
  productCodes: string[];
  indexedAt: string | null;
  createdAt: string;
  updatedAt: string;
  chunkCount: number;
  hasError: boolean;
}

export type KnowledgeIndexJobStatus =
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed';

export interface KnowledgeIndexJobItem {
  id: string;
  fileId: string;
  operation: 'index' | 'reindex';
  status: KnowledgeIndexJobStatus;
  attempt: number;
  maxAttempts: number;
  requestedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  retryable: boolean;
  nextAttemptAt: string | null;
  canRetry: boolean;
}

type UpstreamKnowledgeFile = {
  id?: unknown;
  originalName?: unknown;
  mimetype?: unknown;
  size?: unknown;
  status?: unknown;
  businessStatus?: unknown;
  accessLevel?: unknown;
  productCodes?: unknown;
  indexedAt?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  errorMessage?: unknown;
  _count?: { chunks?: unknown } | null;
};

type UpstreamKnowledgeIndexJob = {
  id?: unknown;
  fileId?: unknown;
  operation?: unknown;
  status?: unknown;
  attempt?: unknown;
  maxAttempts?: unknown;
  requestedAt?: unknown;
  startedAt?: unknown;
  completedAt?: unknown;
  retryable?: unknown;
  nextAttemptAt?: unknown;
};

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

export function sanitizeKnowledgeFile(
  file: UpstreamKnowledgeFile,
): KnowledgeFileItem {
  return {
    id: text(file.id),
    name: text(file.originalName, '이름 없는 문서'),
    mimeType: text(file.mimetype, 'application/octet-stream'),
    size:
      typeof file.size === 'number' && Number.isFinite(file.size)
        ? file.size
        : 0,
    status: text(file.status, 'unknown'),
    businessStatus: text(file.businessStatus, 'DRAFT'),
    accessLevel: text(file.accessLevel, 'INTERNAL'),
    productCodes: Array.isArray(file.productCodes)
      ? file.productCodes.filter(
          (value): value is string => typeof value === 'string',
        )
      : [],
    indexedAt: text(file.indexedAt) || null,
    createdAt: text(file.createdAt),
    updatedAt: text(file.updatedAt),
    chunkCount:
      typeof file._count?.chunks === 'number' ? file._count.chunks : 0,
    hasError:
      typeof file.errorMessage === 'string' && file.errorMessage.length > 0,
  };
}

export function sanitizeKnowledgeIndexJob(
  job: UpstreamKnowledgeIndexJob,
): KnowledgeIndexJobItem {
  const operation = job.operation === 'reindex' ? 'reindex' : 'index';
  const status: KnowledgeIndexJobStatus =
    job.status === 'processing' ||
    job.status === 'completed' ||
    job.status === 'failed'
      ? job.status
      : 'queued';
  const attempt =
    typeof job.attempt === 'number' && Number.isFinite(job.attempt)
      ? job.attempt
      : 0;
  const maxAttempts =
    typeof job.maxAttempts === 'number' && Number.isFinite(job.maxAttempts)
      ? job.maxAttempts
      : 3;
  return {
    id: text(job.id),
    fileId: text(job.fileId),
    operation,
    status,
    attempt,
    maxAttempts,
    requestedAt: text(job.requestedAt),
    startedAt: text(job.startedAt) || null,
    completedAt: text(job.completedAt) || null,
    retryable: job.retryable === true,
    nextAttemptAt: text(job.nextAttemptAt) || null,
    canRetry:
      status === 'failed' && job.retryable === true && attempt < maxAttempts,
  };
}
