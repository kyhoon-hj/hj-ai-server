import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

const source = await readFile(
  new URL('../public/app.js', import.meta.url),
  'utf8',
);
const section = (start, end) =>
  source.slice(source.indexOf(start), source.indexOf(end));

function context() {
  const sandbox = vm.createContext({ URLSearchParams });
  vm.runInContext(
    [
      section('function escapeHtml(', 'function showToast('),
      section('function homeLimitCopy(', 'function metricValue('),
    ].join('\n'),
    sandbox,
  );
  return sandbox;
}

test('홈은 당월 지표·최근 오류·Key 만료와 M5 색인 계약을 표시한다', () => {
  const sandbox = context();
  sandbox.monthly = {
    period: { key: '2026-09' },
    limits: {
      requests: { used: 6, reserved: 1, committed: 7, remaining: 3, limit: 10 },
      tokens: { used: 800, reserved: 100, committed: 900, remaining: null, limit: null },
    },
    outcome: { successRate: 80, measuredRequests: 5 },
    latency: { p95Ms: 321, measuredRequests: 5 },
  };
  sandbox.apps = [
    {
      id: '11111111-1111-4111-8111-111111111111',
      appname: '<지원 앱>',
      appcode: 'SUPPORT',
      appkeyExpiresAt: '2026-09-30T00:00:00.000Z',
    },
  ];
  sandbox.errors = [
    {
      id: 'knowledge:22222222-2222-4222-8222-222222222222',
      app: { appname: '지원 앱' },
      endpoint: '/knowledge/answers',
      errorCode: 'MODEL_ERROR',
      occurredAt: '2026-09-22T01:00:00.000Z',
    },
  ];
  const html = vm.runInContext(
    `homeMarkup(monthly, apps, errors, { items: [{ id: 'alert-1', metric: 'TOKENS', thresholdPercent: 90, limitValue: 1000, observedValue: 900, severity: 'warning', createdAt: '2026-09-22T01:00:00.000Z' }] }, {}, Date.parse('2026-09-23T00:00:00.000Z'))`,
    sandbox,
  );

  assert.match(html, /UTC 2026-09/);
  assert.match(html, /잔여 3 \/ 한도 10/);
  assert.match(html, /무제한/);
  assert.match(html, /80%/);
  assert.match(html, /321 ms/);
  assert.match(html, /MODEL_ERROR/);
  assert.match(html, /Token 한도 90% 도달/);
  assert.match(html, /읽기 전용/);
  assert.match(html, /usage:read/);
  assert.match(html, /7일 남음/);
  assert.match(html, /knowledge-index-failures-v1/);
  assert.match(html, /failedJobs/);
  assert.match(html, /현재는 미측정 상태/);
  assert.doesNotMatch(html, /<지원 앱>|undefined|NaN/);
});

test('홈은 빈 오류·Key와 미측정 지표를 0으로 꾸미지 않는다', () => {
  const sandbox = context();
  sandbox.monthly = {
    period: { key: '2026-09' },
    limits: {
      requests: { used: 0, reserved: 0, committed: 0, remaining: 0, limit: 0 },
      tokens: { used: 0, reserved: 0, committed: 0, remaining: null, limit: 100 },
    },
    outcome: { successRate: null, measuredRequests: 0 },
    latency: { p95Ms: null, measuredRequests: 0 },
  };
  const html = vm.runInContext(
    'homeMarkup(monthly, [], [], { items: [] }, {}, Date.now())',
    sandbox,
  );

  assert.match(html, /사용 불가 \(0 한도\)/);
  assert.match(html, /잔여 미측정/);
  assert.match(html, /이번 달 오류가 없습니다/);
  assert.match(html, /만료일이 설정된 Key가 없습니다/);
  assert.match(html, /이번 달 사용량 알림이 없습니다/);
  assert.match(html, /미측정/);
});

test('홈은 부가 정보 오류를 전체 화면 실패로 바꾸지 않는다', () => {
  const sandbox = context();
  sandbox.monthly = {
    period: { key: '2026-09' },
    limits: {
      requests: { used: 1, reserved: 0, committed: 1, remaining: 9, limit: 10 },
      tokens: { used: 0, reserved: 0, committed: 0, remaining: null, limit: null },
    },
    outcome: { successRate: null, measuredRequests: 0 },
    latency: { p95Ms: null, measuredRequests: 0 },
  };
  const html = vm.runInContext(
    'homeMarkup(monthly, [], [], { items: [] }, { apps: true, errors: true, alerts: true })',
    sandbox,
  );

  assert.match(html, /이번 달 요청/);
  assert.equal((html.match(/정보를 불러오지 못했습니다/g) ?? []).length, 3);
  assert.match(html, /다시 시도/);
});

test('홈 route와 기존 월·앱·실패 로그 API가 연결된다', () => {
  assert.match(source, /return \{ name: 'home' \}/);
  assert.match(source, /usageApi\.monthly\(\)/);
  assert.match(source, /usageApi\.alerts\(\)/);
  assert.match(source, /Promise\.allSettled/);
  assert.match(source, /appsApi\.list\(\)/);
  assert.match(
    source,
    /requestLogsApi\.list\(\{ period: 'month', status: 'failed', limit: 5 \}\)/,
  );
  assert.match(source, /if \(current\.name === 'home'\) await renderHome\(\)/);
});
