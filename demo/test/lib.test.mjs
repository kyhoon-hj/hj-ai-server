import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collectTotalTokens,
  evaluateKnowledgeLifecycleStep,
  evaluateKnowledgeUploadRejection,
  evaluateExpectation,
  identifyServerTarget,
  normalizeBaseUrl,
  percentile,
  renderPath,
} from '../lib.mjs';

test('base URL을 정규화한다', () => {
  assert.equal(normalizeBaseUrl('http://localhost:11000/'), 'http://localhost:11000');
  assert.throws(() => normalizeBaseUrl('file:///tmp/server'));
});

test('현재 URL에 해당하는 서버 환경을 식별한다', () => {
  const targets = [
    { id: 'local', url: 'http://127.0.0.1:11000' },
    { id: 'production', url: 'https://ai.hjshub.com' },
  ];
  assert.equal(identifyServerTarget('http://127.0.0.1:11000/', targets), 'local');
  assert.equal(identifyServerTarget('https://ai.hjshub.com', targets), 'production');
  assert.equal(identifyServerTarget('https://staging.example.com', targets), 'custom');
});

test('경로 파라미터를 안전하게 렌더링한다', () => {
  assert.equal(renderPath('/knowledge/files/:id', { id: 'a/b' }), '/knowledge/files/a%2Fb');
  assert.throws(() => renderPath('/knowledge/files/:id'));
});

test('percentile과 token 합계를 계산한다', () => {
  assert.equal(percentile([10, 20, 30, 40], 0.95), 40);
  assert.equal(collectTotalTokens({ usage: { totalTokens: 17 } }), 17);
});

test('계약 기대값을 평가한다', () => {
  const result = { status: 200, body: { ok: true }, headers: { correlationId: 'id' } };
  assert.equal(evaluateExpectation(result, { statuses: [200], bodyIncludes: 'ok', correlationId: true }).passed, true);
  assert.equal(evaluateExpectation(result, { statuses: [400] }).passed, false);
});

test('지식 생명주기 단계별 응답 계약을 평가한다', () => {
  const context = { fileId: 'file-1', marker: 'LIFE-MARKER', productCode: 'LIFECYCLE' };

  assert.deepEqual(evaluateKnowledgeLifecycleStep('upload', { id: 'file-1', status: 'uploaded' }), []);
  assert.deepEqual(
    evaluateKnowledgeLifecycleStep('index', { fileId: 'file-1', status: 'indexed', chunkCount: 1 }, context),
    [],
  );
  assert.deepEqual(
    evaluateKnowledgeLifecycleStep(
      'policy',
      { id: 'file-1', accessLevel: 'PUBLIC', businessStatus: 'PUBLISHED', productCodes: ['LIFECYCLE'] },
      context,
    ),
    [],
  );
  assert.deepEqual(
    evaluateKnowledgeLifecycleStep(
      'search',
      { matches: [{ fileId: 'file-1', content: 'LIFE-MARKER 교환 정책' }] },
      context,
    ),
    [],
  );
  assert.deepEqual(
    evaluateKnowledgeLifecycleStep('answer', { answerable: true, sources: [{ fileId: 'file-1' }] }, context),
    [],
  );
  assert.deepEqual(
    evaluateKnowledgeLifecycleStep(
      'cleanup',
      { id: 'file-1', status: 'archived', _count: { chunks: 0 }, metadata: { deletedObject: true } },
      context,
    ),
    [],
  );
  assert.match(
    evaluateKnowledgeLifecycleStep('answer', { answerable: false, sources: [] }, context).join(' '),
    /not grounded.*missing from answer sources/,
  );
});

test('지식 파일 거절 응답의 상태·오류 코드·correlation 계약을 평가한다', () => {
  const correlationId = '86c75f09-2ea5-4ffd-9fa4-84b8887823fb';
  assert.deepEqual(
    evaluateKnowledgeUploadRejection(
      { status: 400, correlationId, body: { statusCode: 400, code: 'VALIDATION_ERROR', message: '빈 파일은 업로드할 수 없습니다.', requestId: correlationId } },
      { status: 400, code: 'VALIDATION_ERROR', messageIncludes: '빈 파일' },
    ),
    [],
  );
  assert.match(
    evaluateKnowledgeUploadRejection(
      { status: 400, correlationId: null, body: { statusCode: 400, code: 'INTERNAL_ERROR' } },
      { status: 413, code: 'PAYLOAD_TOO_LARGE' },
    ).join(' '),
    /status 400.*statusCode 400.*INTERNAL_ERROR.*requestId.*correlation-id/,
  );
});
