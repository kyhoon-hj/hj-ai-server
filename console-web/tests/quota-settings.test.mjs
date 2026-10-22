import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import { appsApi } from '../public/api.js';

const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const sandbox = vm.createContext({});
vm.runInContext(source.slice(source.indexOf('function escapeHtml('), source.indexOf('function formatDate(')) + source.slice(source.indexOf('function parseMonthlyLimit('), source.indexOf('function detailMarkup(')), sandbox);

test('actual detail submit handler sends quota fields and leaves log filters unchanged', async () => {
  const start = source.indexOf("  if (event.target.id !== 'detail-form') return;");
  const end = source.indexOf("\n});", start);
  const values = new Map([['appname', 'Quota'], ['remark', 'Test'], ['status', 'active'], ['monthlyRequestLimit', '1'], ['monthlyTokenLimit', '10000']]);
  const calls = [];
  const element = {};
  const context = vm.createContext({
    event: { target: { id: 'detail-form', querySelector: () => element }, preventDefault() {} },
    route: () => ({ name: 'detail', appId: 'test-app' }),
    FormData: class { get(name) { return values.get(name); } },
    parseMonthlyLimit: sandbox.parseMonthlyLimit,
    appsApi: { async update(id, payload) { calls.push({ id, payload: JSON.parse(JSON.stringify(payload)) }); } },
    showToast() {}, async renderDetail() {},
  });
  await vm.runInContext(`(async () => {${source.slice(start, end)}})()`, context);
  assert.deepEqual(calls, [{ id: 'test-app', payload: { appname: 'Quota', remark: 'Test', status: 'active', monthlyRequestLimit: 1, monthlyTokenLimit: 10000 } }]);
  const filters = source.slice(source.indexOf('state.requestLogFilters = {'), start);
  assert.doesNotMatch(filters, /monthlyRequestLimit: parseMonthlyLimit/);
});

test('quota form preserves unlimited and zero and rejects invalid values', () => {
  for (const value of ['', '  ']) assert.equal(sandbox.parseMonthlyLimit(value), null);
  assert.equal(sandbox.parseMonthlyLimit('0'), 0);
  assert.equal(sandbox.parseMonthlyLimit('123'), 123);
  for (const value of ['-1', '1.5', 'NaN', 'Infinity', '2147483648']) assert.throws(() => sandbox.parseMonthlyLimit(value));
  const markup = sandbox.appLimitsMarkup({ monthlyRequestLimit: 0, monthlyTokenLimit: 500 });
  assert.match(markup, /name="monthlyRequestLimit"[^>]*value="0"/);
  assert.match(markup, /name="monthlyTokenLimit"[^>]*value="500"/);
  assert.match(markup, /UTC 매월 1일/);
});

test('saving quota sends numeric zero and null through the Console API', async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ id: 'app-1' }), { headers: { 'content-type': 'application/json' } });
  };
  await appsApi.update('app-1', { monthlyRequestLimit: sandbox.parseMonthlyLimit('0'), monthlyTokenLimit: sandbox.parseMonthlyLimit('') });
  assert.equal(calls[0].url, '/console-api/v1/apps/app-1');
  assert.equal(calls[0].options.method, 'PATCH');
  assert.deepEqual(JSON.parse(calls[0].options.body), { monthlyRequestLimit: 0, monthlyTokenLimit: null });
});
