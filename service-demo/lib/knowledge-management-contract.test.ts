import { describe, expect, it } from 'vitest';
import {
  sanitizeKnowledgeFile,
  sanitizeKnowledgeIndexJob,
} from './knowledge-management-contract';

describe('sanitizeKnowledgeFile', () => {
  it('keeps display fields and excludes storage internals', () => {
    const result = sanitizeKnowledgeFile({
      id: 'file-1',
      originalName: 'policy.md',
      mimetype: 'text/markdown',
      size: 123,
      status: 'indexed',
      businessStatus: 'PUBLISHED',
      accessLevel: 'PUBLIC',
      productCodes: ['P-1'],
      indexedAt: '2026-08-31T00:00:00.000Z',
      createdAt: '2026-08-31T00:00:00.000Z',
      updatedAt: '2026-08-31T00:00:00.000Z',
      errorMessage: null,
      _count: { chunks: 2 },
    });
    expect(result).toMatchObject({
      id: 'file-1',
      name: 'policy.md',
      chunkCount: 2,
      hasError: false,
    });
    expect(JSON.stringify(result)).not.toContain('bucket');
    expect(JSON.stringify(result)).not.toContain('key');
  });
});

describe('sanitizeKnowledgeIndexJob', () => {
  it('allows manual retry only for a retryable failed job below its limit', () => {
    expect(
      sanitizeKnowledgeIndexJob({
        status: 'failed',
        attempt: 1,
        maxAttempts: 3,
        retryable: true,
      }),
    ).toMatchObject({ retryable: true, canRetry: true });
    expect(
      sanitizeKnowledgeIndexJob({
        status: 'failed',
        attempt: 1,
        maxAttempts: 3,
        retryable: false,
      }),
    ).toMatchObject({ retryable: false, canRetry: false });
    expect(
      sanitizeKnowledgeIndexJob({
        status: 'failed',
        attempt: 3,
        maxAttempts: 3,
        retryable: true,
      }),
    ).toMatchObject({ retryable: true, canRetry: false });
  });

  it('keeps retry scheduling state without exposing internal errors', () => {
    const result = sanitizeKnowledgeIndexJob({
      id: 'job-1',
      status: 'queued',
      attempt: 1,
      maxAttempts: 3,
      retryable: true,
      nextAttemptAt: '2026-09-03T03:00:01.000Z',
    });
    expect(result).toMatchObject({
      status: 'queued',
      retryable: true,
      nextAttemptAt: '2026-09-03T03:00:01.000Z',
      canRetry: false,
    });
    expect(JSON.stringify(result)).not.toContain('errorMessage');
  });
});
