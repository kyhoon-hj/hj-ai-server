import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import { requestLogsApi, usageApi } from '../public/api.js';

const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));
function renderContext() {
  const state = { usageDays: 7, usageEndpoint: '/conversation/v1/turns', requestLogApps: [], requestLogs: [], requestLogNextCursor: null,
    requestLogFilters: { days: 30, period: 'month', appId: '', appcode: '', endpoint: '/conversation/v1/turns', modelId: '', status: 'unknown', requestId: '', errorCode: '' },
  };
  const context = vm.createContext({ state, URLSearchParams, requestLogsApi });
  vm.runInContext([
    section('function escapeHtml(', 'function showToast('),
    section('function metricValue(', 'async function renderUsage('),
    section('function requestLogListMarkup(', 'async function loadRequestLogs('),
  ].join('\n'), context);
  return context;
}

test('renders separate month and rolling ranges with bounded quota states and trace links', () => {
  const context = renderContext();
  const measurement = { value: 0, measuredRequests: 1 };
  const metrics = { requestCount: 1, appCount: 1, tokens: { total: measurement },
    latency: { averageMs: 0, p50Ms: 0, p95Ms: 0, measuredRequests: 1 },
    outcome: { successRate: null, measuredRequests: 0 }, measurement: { outcomeUnmeasuredRequests: 1 },
    embeddings: { operations: 0, indexOperations: 0, searchOperations: 0 },
  };
  context.summary = metrics;
  context.series = { points: [{ date: '2026-09-18', requestCount: 1 }] };
  context.breakdown = { apps: [{ ...metrics, appcode: 'APP', appname: '<private>' }],
    dimensions: [{ ...metrics, dimension: 'model', value: 'unknown' }],
  };
  context.monthly = { period: { key: '2026-09' }, apps: [], limits: {
    requests: { used: 1, reserved: 0, limit: 0, remaining: 0, utilizationPercent: null, unmeasuredRequests: 0 },
    tokens: { used: 0, reserved: 0, limit: null, remaining: null, utilizationPercent: null, unmeasuredRequests: 1 },
  } };
  const html = vm.runInContext('usageMarkup(summary, series, breakdown, monthly)', context);
  assert.match(html, /이번 달 사용량·한도 \(UTC 2026-09\)/);
  assert.match(html, /최근 7일 운영 지표/);
  assert.match(html, /사용 불가\(0 한도\)/);
  assert.match(html, /무제한/);
  assert.match(html, /p50 0 ms · p95 0 ms/);
  assert.match(html, /&lt;private&gt;/);
  assert.doesNotMatch(html, /<private>|NaN|undefined/);
  const links = [...html.matchAll(/href="([^"]+)" data-link/g)].map((match) => new URL(match[1].replaceAll('&amp;', '&'), 'http://localhost'));
  assert.ok(links.some((link) => link.searchParams.get('period') === 'month'));
  assert.ok(links.some((link) => link.searchParams.get('appcode') === 'APP' && link.searchParams.get('days') === '7'));
  assert.ok(links.some((link) => link.searchParams.get('modelId') === 'unknown' && link.searchParams.get('endpoint') === '/conversation/v1/turns'));
});

test('renders Family/recovery and unknown outcomes without labeling them failures; export preserves filters', () => {
  const context = renderContext();
  context.state.requestLogs = ['conversation', 'recovery'].map((source, index) => ({
    id: `${source}:id`, source, occurredAt: '2026-09-18T00:00:00Z', requestId: null,
    app: { appname: 'Family', appcode: 'APP' }, endpoint: '/conversation/v1/turns', status: 'unknown',
    result: 'usage_recovered', errorCode: null, latencyMs: null, tokens: { total: index ? null : 0 },
  }));
  const html = vm.runInContext('requestLogListMarkup()', context);
  assert.match(html, /Family 대화/);
  assert.match(html, /사용량 복구/);
  assert.doesNotMatch(html, /class="status danger"/);
  assert.match(html, /<td>0<\/td>/);
  assert.match(html, /value="month" selected/);
  const href = html.match(/href="([^"]*export\.csv[^"]*)"/)[1];
  const url = new URL(href.replaceAll('&amp;', '&'), 'http://localhost');
  assert.equal(url.searchParams.get('period'), 'month');
  assert.equal(url.searchParams.get('endpoint'), '/conversation/v1/turns');
  assert.equal(url.searchParams.get('status'), 'unknown');
});

test('monthly and endpoint-filtered usage use the intended API paths', async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  const paths = [];
  globalThis.fetch = async (path) => { paths.push(path); return new Response('{}'); };
  await usageApi.monthly();
  await usageApi.summary(7, '/conversation/v1/turns');
  assert.equal(paths[0], '/console-api/v1/usage/monthly');
  const url = new URL(paths[1], 'http://localhost');
  assert.equal(url.searchParams.get('days'), '7');
  assert.equal(url.searchParams.get('endpoint'), '/conversation/v1/turns');
});
