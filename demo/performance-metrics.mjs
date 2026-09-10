import { percentile } from './lib.mjs';

const numeric = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const sum = (values) => values.reduce((total, value) => total + value, 0);
const round = (value) => Math.round(value * 100) / 100;
// Counts describe the demo's final HTTP outcomes, not hidden SDK attempts.
export function summarizeRequestOutcomes(results) {
  const outcomes = { success: 0, rateLimited: 0, timeout: 0, transportError: 0, httpError: 0 };
  for (const result of results) {
    if (result.ok) outcomes.success++;
    else if (result.status === 429) outcomes.rateLimited++;
    else if (result.status === 0 && result.body?.code === 'DEMO_UPSTREAM_TIMEOUT') outcomes.timeout++;
    else if (result.status === 0) outcomes.transportError++;
    else outcomes.httpError++;
  }
  return { outcomes: { ...outcomes, failed: results.length - outcomes.success },
    retries: { scope: 'demo-http', attempts: results.length, retryCount: 0, serverSdkAttempts: null,
      note: '데모는 요청당 한 번 호출합니다. 서버 SDK 측정은 summary.awsRequest와 summary.sdk에서 관측 범위별로 확인합니다. 타임아웃 뒤 서버 처리 완료 여부는 알 수 없습니다.' } };
}
function distribution(values) {
  return {
    measuredRequests: values.length,
    average: values.length ? round(sum(values) / values.length) : null,
    p50: values.length ? percentile(values, .5) : null,
    p95: values.length ? percentile(values, .95) : null,
  };
}

// Missing telemetry stays unknown: old servers, HTTP failures and no-invocation
// responses must not silently lower the measured latency/token averages.
export function summarizeAiPerformance(results, requestedMaxTokens) {
  const bodies = results.map((result) => result.body ?? {});
  const tokenValues = (camel, legacy) => bodies.map((body) => {
    const usage = body.usage ?? body;
    return usage[camel] ?? usage[legacy];
  }).filter(numeric);
  const inputs = tokenValues('inputTokens', 'inputtokens');
  const outputs = tokenValues('outputTokens', 'outputtokens');
  const totals = tokenValues('totalTokens', 'totaltokens');
  const effective = bodies.map((body) => body.performance?.maxTokens).filter(numeric);
  return {
    awsRequest: {
      attempts: distribution(bodies.map((body) => body.awsRequest?.attempts).filter(numeric)),
      retryCount: distribution(bodies.map((body) => body.awsRequest?.retryCount).filter(numeric)),
      totalRetryDelayMs: distribution(bodies.map((body) => body.awsRequest?.totalRetryDelayMs).filter(numeric)),
      completeRequests: bodies.filter((body) => body.awsRequest?.complete === true).length,
      reportedRequests: bodies.filter((body) => body.awsRequest?.scope === 'request-wrapped-aws-operations').length,
    },
    sdk: Object.fromEntries(['generation', 'failed-call'].map((scope) => {
      const records = bodies.map((body) => body.sdk).filter((sdk) => sdk?.scope === scope);
      return [scope, {
        attempts: distribution(records.map((sdk) => sdk.attempts).filter(numeric)),
        retryCount: distribution(records.map((sdk) => sdk.retryCount).filter(numeric)),
        totalRetryDelayMs: distribution(records.map((sdk) => sdk.totalRetryDelayMs).filter(numeric)),
      }];
    })),
    timings: {
      retrievalMs: distribution(bodies.map((body) => body.performance?.retrievalMs).filter(numeric)),
      generationMs: distribution(bodies.map((body) => body.performance?.generationMs).filter(numeric)),
    },
    tokens: {
      input: inputs.length ? sum(inputs) : null,
      output: outputs.length ? sum(outputs) : null,
      total: totals.length ? sum(totals) : null,
      measuredRequests: { input: inputs.length, output: outputs.length, total: totals.length },
      averagePerRequest: totals.length ? round(sum(totals) / totals.length) : null,
      outputPerRequest: distribution(outputs),
    },
    maxTokens: {
      requested: numeric(requestedMaxTokens) ? requestedMaxTokens : null,
      effective: [...new Set(effective)].sort((a, b) => a - b),
      measuredRequests: effective.length,
    },
  };
}
