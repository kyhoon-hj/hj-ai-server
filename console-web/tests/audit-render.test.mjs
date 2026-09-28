import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

const [source, html] = await Promise.all([
  readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
  readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
]);
const section = (start, end) =>
  source.slice(source.indexOf(start), source.indexOf(end));

function context() {
  const state = {
    auditEvents: [],
    auditApps: [{ id: 'app-1', appname: '<관리 앱>' }],
    auditFilters: {
      days: 30,
      eventType: '',
      appId: '',
      worksUserId: '',
    },
    auditNextCursor: null,
  };
  const sandbox = vm.createContext({ state });
  vm.runInContext(
    [
      section('function escapeHtml(', 'function showToast('),
      section('function shortId(', 'function credentialCard('),
      section('const auditEventLabels', 'function requestLogDetailMarkup('),
    ].join('\n'),
    sandbox,
  );
  return sandbox;
}

test('감사 화면은 안전한 projection과 필터를 렌더링한다', () => {
  const sandbox = context();
  sandbox.state.auditEvents = [
    {
      id: 'event-1',
      eventType: 'CONSOLE_APPKEY_ROTATED',
      actor: {
        type: 'console-user',
        worksUserId: '22222222-2222-4222-8222-222222222222',
        consoleIdentityId: '11111111-1111-4111-8111-111111111111',
      },
      app: {
        id: '33333333-3333-4333-8333-333333333333',
        appcode: '<APP_A>',
      },
      requestId: 'request-1',
      details: { credentialId: '<credential>', gracePeriodSeconds: 300 },
      createdAt: '2026-09-28T01:00:00.000Z',
    },
  ];

  const output = vm.runInContext('auditMarkup()', sandbox);
  assert.match(output, /활동·보안 감사/);
  assert.match(output, /API Key 회전/);
  assert.match(output, /credentialId/);
  assert.match(output, /Works 사용자 ID/);
  assert.match(output, /metadata only/);
  assert.doesNotMatch(output, /<APP_A>|<credential>|undefined|NaN/);
});

test('감사 메뉴·route·권한 API가 연결되고 원문 필드는 사용하지 않는다', () => {
  assert.match(html, /href="\/console\/audit" data-link/);
  assert.match(source, /return \{ name: 'audit' \}/);
  assert.match(source, /auditApi\.list/);
  assert.match(source, /id="audit-filters"/);
  assert.match(source, /data-action="load-more-audit"/);
  assert.doesNotMatch(source, /item\.metadata|consoleSessionIdHash/);
});
