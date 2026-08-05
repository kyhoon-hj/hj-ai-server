import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collectTotalTokens,
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
    { id: 'local', url: 'http://127.0.0.1:11000/ai' },
    { id: 'production', url: 'https://ai.hjshub.com' },
  ];
  assert.equal(identifyServerTarget('http://127.0.0.1:11000/ai/', targets), 'local');
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
