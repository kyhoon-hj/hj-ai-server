import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeAiPerformance, summarizeRequestOutcomes } from '../performance-metrics.mjs';

test('request totals average only complete measurements and preserve explicit zero', () => {
  const report = (attempts, complete) => ({ body: { awsRequest: { scope: 'request-wrapped-aws-operations', attempts, complete } } });
  const summary = summarizeAiPerformance([report(5, true), report(0, true), report(null, false), { body: {} }]);
  assert.equal(summary.awsRequest.attempts.average, 2.5);
  assert.equal(summary.awsRequest.attempts.measuredRequests, 2);
  assert.equal(summary.awsRequest.completeRequests, 2);
  assert.equal(summary.awsRequest.reportedRequests, 3);
});

test('SDK metrics separate generation and failed calls and exclude missing metadata', () => {
  const summary = summarizeAiPerformance([
    { body: { sdk: { scope: 'generation', attempts: 2, retryCount: 1, totalRetryDelayMs: 10 } } },
    { body: { sdk: { scope: 'failed-call', attempts: 3, retryCount: 2, totalRetryDelayMs: 30 } } },
    { body: {} }, { body: { sdk: { scope: 'generation', attempts: null } } },
  ]);
  assert.equal(summary.sdk.generation.attempts.measuredRequests, 1);
  assert.equal(summary.sdk.generation.attempts.p95, 2);
  assert.equal(summary.sdk['failed-call'].attempts.p95, 3);
  assert.equal(summarizeAiPerformance([{ body: {} }]).sdk.generation.attempts.p95, null);
});

test('HTTP outcomes are exclusive and server 504 is distinct from local timeout', () => {
  const summary = summarizeRequestOutcomes([
    { ok: true, status: 200 }, { ok: false, status: 429 },
    { ok: false, status: 0, body: { code: 'DEMO_UPSTREAM_TIMEOUT' } },
    { ok: false, status: 0, body: { code: 'DEMO_UPSTREAM_ERROR' } },
    { ok: false, status: 504 }, { ok: false, status: 400 },
  ]);
  assert.deepEqual(summary.outcomes, { success: 1, rateLimited: 1, timeout: 1, transportError: 1, httpError: 2, failed: 5 });
  assert.equal(summary.retries.attempts, 6);
  assert.equal(summary.retries.retryCount, 0);
  assert.equal(summary.retries.serverSdkAttempts, null);
});

test('stage and token averages use measured responses instead of missing failures', () => {
  const summary = summarizeAiPerformance([
    { body: { performance: { retrievalMs: 20, generationMs: 100, maxTokens: 256 }, usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 } } },
    { body: { performance: { retrievalMs: 40, generationMs: 200, maxTokens: 256 }, usage: { inputTokens: 20, outputTokens: 6, totalTokens: 26 } } },
    { status: 504, body: { message: 'timeout' } },
  ], 256);
  assert.deepEqual(summary.timings.retrievalMs, { measuredRequests: 2, average: 30, p50: 20, p95: 40 });
  assert.equal(summary.timings.generationMs.p95, 200);
  assert.equal(summary.tokens.input, 30);
  assert.equal(summary.tokens.output, 10);
  assert.equal(summary.tokens.total, 40);
  assert.equal(summary.tokens.averagePerRequest, 20);
  assert.deepEqual(summary.tokens.measuredRequests, { input: 2, output: 2, total: 2 });
  assert.deepEqual(summary.maxTokens, { requested: 256, effective: [256], measuredRequests: 2 });
});

test('strict no-answer records zero generation while null usage remains unknown', () => {
  const summary = summarizeAiPerformance([{ body: { performance: { retrievalMs: 12, generationMs: 0, maxTokens: 1024 }, usage: null } }]);
  assert.equal(summary.timings.generationMs.p95, 0);
  assert.equal(summary.timings.generationMs.measuredRequests, 1);
  assert.equal(summary.tokens.total, null);
  assert.equal(summary.tokens.averagePerRequest, null);
  assert.equal(summary.maxTokens.requested, null);
  assert.deepEqual(summary.maxTokens.effective, [1024]);
});

test('legacy tokens remain supported without inventing missing timings or effective maxTokens', () => {
  const summary = summarizeAiPerformance([{ body: { inputtokens: 8, outputtokens: 2, totaltokens: 10 } }], 512);
  assert.equal(summary.tokens.total, 10);
  assert.equal(summary.timings.retrievalMs.p95, null);
  assert.equal(summary.maxTokens.requested, 512);
  assert.deepEqual(summary.maxTokens.effective, []);
});

test('invalid values are excluded, but explicit zero token counts are measured', () => {
  const summary = summarizeAiPerformance([
    { body: { performance: { retrievalMs: -1, generationMs: Infinity }, usage: { inputTokens: '10', outputTokens: NaN, totalTokens: -5 } } },
    { body: { usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } } },
    { body: null },
  ], '512');
  assert.equal(summary.tokens.total, 0);
  assert.equal(summary.tokens.measuredRequests.total, 1);
  assert.equal(summary.timings.generationMs.measuredRequests, 0);
  assert.equal(summary.maxTokens.requested, null);
});
