import { describe, expect, it } from 'vitest';
import { sanitizeAnswerSource, toAnswerResult } from './knowledge-contract';

describe('knowledge answer browser contract', () => {
  it('keeps only display-safe source metadata', () => {
    const source = sanitizeAnswerSource({
      chunkId: 'chunk-1',
      fileId: 'file-1',
      fileName: '교환 정책.pdf',
      score: 0.91,
      metadata: { pageNumber: 3, productCode: 'POWER-01', internalBucket: 'private', credential: 'secret' },
    }, 0);
    expect(source).toEqual({ id: 'file-1', name: '교환 정책.pdf', score: 0.91, sourceType: 'KNOWLEDGE_DOCUMENT', page: 3, productCode: 'POWER-01' });
    expect(JSON.stringify(source)).not.toContain('private');
    expect(JSON.stringify(source)).not.toContain('secret');
  });

  it('requires at least one source before showing an answer as grounded', () => {
    expect(toAnswerResult({ answer: '추측 답변', answerable: true, sources: [] }, 'req-1', '질문')).toMatchObject({ answerable: false, sources: [], requestId: 'req-1' });
  });
});
