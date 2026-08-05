import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collectTotalTokens,
  evaluateExpectation,
  normalizeBaseUrl,
  percentile,
  renderPath,
} from '../lib.mjs';

test('base URL을 정규화한다', () => {
  assert.equal(normalizeBaseUrl('http://localhost:3000/'), 'http://localhost:3000');
  assert.throws(() => normalizeBaseUrl('file:///tmp/server'));
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
