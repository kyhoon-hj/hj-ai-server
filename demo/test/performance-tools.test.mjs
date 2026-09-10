import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePerformanceLoad, comparePerformanceReports, validatePerformanceReport } from '../public/performance-tools.js';
const report = (overrides = {}) => ({ type: 'performance', operationId: 'knowledge.answers', baseUrl: 'http://local', serverCommit: 'a', configuration: { total: 20, concurrency: 2, body: { maxTokens: 256, query: 'q' } }, summary: { latencyMs: { p95: 100 }, successRate: 90, throughputPerSecond: 2, tokens: { averagePerRequest: 10 } }, ...overrides });

test('legacy failure measurements remain unknown and timeout policy differences are exposed', () => {
  const current = report();
  current.configuration.timeoutMs = 1000;
  current.configuration.retryPolicy = 'none';
  current.summary.outcomes = { rateLimited: 0 };
  const comparison = comparePerformanceReports(report(), current);
  assert.deepEqual(comparison.differences, ['HTTP 타임아웃', '데모 재시도 정책']);
  const metric = comparison.metrics.find((item) => item.label === 'HTTP 429');
  assert.equal(metric.baseline, null); assert.equal(metric.current, 0); assert.equal(metric.delta, null);
});

test('presets are authoritative and custom load is bounded', () => {
  assert.deepEqual(resolvePerformanceLoad({ preset: 'smoke', total: 200, concurrency: 20 }), { preset: 'smoke', total: 5, concurrency: 1 });
  assert.deepEqual(resolvePerformanceLoad({ preset: 'baseline' }), { preset: 'baseline', total: 20, concurrency: 2 });
  assert.deepEqual(resolvePerformanceLoad({ preset: 'burst' }), { preset: 'burst', total: 50, concurrency: 5 });
  assert.deepEqual(resolvePerformanceLoad({ total: 7, concurrency: 3 }), { preset: 'custom', total: 7, concurrency: 3 });
});
test('invalid presets, non-integers and out-of-range requests are rejected before calls', () => {
  for (const input of [{ preset: '__proto__' }, { total: NaN }, { total: 1.5 }, { total: 201 }, { total: 0 }, { total: '5' }, { concurrency: 21 }, { total: 2, concurrency: 3 }]) assert.throws(() => resolvePerformanceLoad(input));
});
test('comparison calculates current-minus-baseline and preserves missing telemetry', () => {
  const current = report({ summary: { latencyMs: { p95: 80 }, successRate: 95, throughputPerSecond: 3, tokens: { averagePerRequest: 12 } } });
  const compared = comparePerformanceReports(report(), current);
  assert.deepEqual(compared.differences, []);
  assert.equal(compared.metrics.find((m) => m.label === '전체 p95').delta, -20);
  assert.equal(compared.metrics.find((m) => m.label === '전체 p95').changePercent, -20);
  assert.equal(compared.metrics.find((m) => m.label === '성공률').delta, 5);
  assert.equal(compared.metrics.find((m) => m.label === '생성 p95').delta, null);
});
test('a zero baseline does not produce infinity or invented percentages', () => {
  const baseline = report({ summary: { latencyMs: { p95: 0 }, successRate: 0 } });
  const compared = comparePerformanceReports(baseline, report());
  assert.equal(compared.metrics[0].delta, 90);
  assert.equal(compared.metrics[0].changePercent, null);
});
test('condition comparison ignores key ordering but exposes workload and target changes', () => {
  const current = report({ baseUrl: 'http://different', configuration: { total: 50, concurrency: 5, body: { query: 'q', maxTokens: 256 } } });
  assert.deepEqual(comparePerformanceReports(report(), current).differences, ['서버 URL', '요청 수', '동시성']);
});
test('imports reject unrelated reports and invalid summary values', () => {
  for (const value of [null, {}, { ...report(), type: 'performance-comparison' }, report({ summary: { latencyMs: { p95: -1 }, successRate: 100 } }), report({ summary: { latencyMs: { p95: 1 }, successRate: 101 } })]) assert.throws(() => validatePerformanceReport(value));
});
