import { describe, expect, it } from 'vitest';
import { failedIndexJobNotice } from './index-job-notice';
import { sanitizeKnowledgeIndexJob } from './knowledge-management-contract';

describe('failed job guidance', () => {
  it('offers retry only when the job permits it', () => {
    const job = sanitizeKnowledgeIndexJob({
      status: 'failed',
      attempt: 1,
      maxAttempts: 3,
      retryable: true,
    });
    expect(failedIndexJobNotice(job, 'policy.md')).toContain(
      '다시 시도할 수 있습니다',
    );
  });
  it('does not offer retry after exhaustion', () => {
    const job = sanitizeKnowledgeIndexJob({
      status: 'failed',
      attempt: 3,
      maxAttempts: 3,
      retryable: true,
    });
    expect(failedIndexJobNotice(job, 'policy.md')).toContain(
      '재시도 횟수를 모두 사용',
    );
    expect(failedIndexJobNotice(job, 'policy.md')).not.toContain(
      '다시 시도할 수 있습니다',
    );
  });
  it('identifies permanent failures', () => {
    const job = sanitizeKnowledgeIndexJob({
      status: 'failed',
      attempt: 1,
      maxAttempts: 3,
      retryable: false,
    });
    expect(failedIndexJobNotice(job, 'policy.md')).toContain('영구 실패');
  });
});
