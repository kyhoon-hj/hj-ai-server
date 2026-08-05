
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { collectTotalTokens, evaluateExpectation, identifyServerTarget, normalizeBaseUrl, percentile, renderPath } from './lib.mjs';
import { findOperation, operations } from './catalog.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const publicRoot = join(root, 'public');
const scenarioPath = join(root, 'scenarios', 'core.json');
const fixtureManifestPath = join(root, 'fixtures', 'manifest.json');
const reportRoot = join(root, 'reports');
const port = Number(process.env.DEMO_PORT ?? 3200);
const host = process.env.DEMO_HOST ?? '127.0.0.1';
const maxBodyBytes = 40 * 1024 * 1024;
const demoAppDefinitions = [
  {
    appcode: 'hj-ai-demo-store-a',
    appname: 'HJ AI 검증 STORE_A',
    fixtures: ['store-a-policy.md', 'store-a-products.csv'],
    productCodes: ['STORE_A'],
  },
  {
    appcode: 'hj-ai-demo-store-b',
    appname: 'HJ AI 검증 STORE_B',
    fixtures: ['store-b-policy.md'],
    productCodes: ['STORE_B'],
  },
];
const serverTargets = [
  {
    id: 'local',
    label: '로컬',
    url: normalizeBaseUrl(process.env.AI_SERVER_LOCAL_URL ?? 'http://127.0.0.1:11000'),
  },
  {
    id: 'production',
    label: '운영',
    url: normalizeBaseUrl(process.env.AI_SERVER_PRODUCTION_URL ?? 'https://ai.hjshub.com'),
  },
];

const runtime = {
  baseUrl: normalizeBaseUrl(process.env.AI_SERVER_BASE_URL ?? serverTargets[0].url),
  appkey: process.env.AI_SERVER_APPKEY ?? '',
  adminKey: process.env.AI_SERVER_ADMIN_API_KEY ?? '',
  operatorKey: process.env.AI_SERVER_KNOWLEDGE_OPERATOR_API_KEY ?? '',
  timeoutMs: Number(process.env.AI_SERVER_TIMEOUT_MS ?? 30000),
  updatedAt: new Date().toISOString(),
};

function readLocalServerCommit() {
  try {
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: join(root, '..'),
      encoding: 'utf8',
      windowsHide: true,
    }).trim();
    const worktree = execFileSync('git', ['status', '--porcelain'], {
      cwd: join(root, '..'),
      encoding: 'utf8',
      windowsHide: true,
    }).trim();
    return worktree ? `${commit}-dirty` : commit;
  } catch {
    return 'unknown';
  }
}

const demoProfiles = new Map();

async function reportContext(scenarioVersion = null) {
  const fixtureManifest = JSON.parse(await readFile(fixtureManifestPath, 'utf8'));
  const environment = identifyServerTarget(runtime.baseUrl, serverTargets);
  return {
    environment,
    baseUrl: runtime.baseUrl,
    serverCommit: process.env.AI_SERVER_COMMIT ?? (environment === 'local' ? readLocalServerCommit() : 'unknown'),
    scenarioVersion,
    fixtureVersion: fixtureManifest.version,
  };
}

function publicConfig() {
  return {
    baseUrl: runtime.baseUrl,
    activeTarget: identifyServerTarget(runtime.baseUrl, serverTargets),
    targets: serverTargets,
    hasAppkey: Boolean(runtime.appkey),
    hasAdminKey: Boolean(runtime.adminKey),
    hasOperatorKey: Boolean(runtime.operatorKey),
    timeoutMs: runtime.timeoutMs,
    updatedAt: runtime.updatedAt,
  };
}

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function sendJson(response, status, body) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(body, null, 2));
}

async function readBuffer(request, limit = maxBodyBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('요청 본문이 너무 큽니다.'), { statusCode: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(request) {
  const buffer = await readBuffer(request, 2 * 1024 * 1024);
  if (buffer.length === 0) return {};
  try {
    return JSON.parse(buffer.toString('utf8'));
  } catch {
    throw Object.assign(new Error('유효한 JSON 본문이 필요합니다.'), { statusCode: 400 });
  }
}

function buildUrl(path, query = {}) {
  const url = new URL(`${runtime.baseUrl}${path}`);
  Object.entries(query ?? {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  });
  return url;
}

async function invoke(operation, options = {}) {
  const path = renderPath(operation.path, options.params);
  const url = buildUrl(path, options.query);
  const headers = { accept: 'application/json' };
  const sendAppkey = options.sendAppkey ?? ![false, 'admin', 'operator'].includes(operation.auth);
  const sendAdminKey = options.sendAdminKey ?? operation.auth === 'admin';
  const sendOperatorKey = options.sendOperatorKey ?? operation.auth === 'operator';
  if (sendAppkey && runtime.appkey) headers.appkey = runtime.appkey;
  if (sendAdminKey) {
    const adminKey = options.adminKey ?? runtime.adminKey;
    if (adminKey) headers['x-admin-key'] = adminKey;
  }
  if (sendOperatorKey) {
    const operatorKey = options.operatorKey ?? runtime.operatorKey;
    if (operatorKey) headers['x-admin-key'] = operatorKey;
  }
  if (options.correlationId) headers['x-correlation-id'] = options.correlationId;
  const init = {
    method: operation.method,
    headers,
    signal: AbortSignal.timeout(runtime.timeoutMs),
  };
  if (!['GET', 'HEAD'].includes(operation.method) && options.body !== undefined) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(options.body);
  }
  const startedAt = performance.now();
  try {
    const upstream = await fetch(url, init);
    const durationMs = Math.round((performance.now() - startedAt) * 100) / 100;
    const contentType = upstream.headers.get('content-type') ?? '';
    const text = await upstream.text();
    let body = text;
    if (contentType.includes('json') && text) {
      try { body = JSON.parse(text); } catch { body = text; }
    }
    return {
      operationId: operation.id,
      request: { method: operation.method, path: `${url.pathname}${url.search}`, body: options.body },
      status: upstream.status,
      ok: upstream.ok,
      durationMs,
      headers: {
        correlationId: upstream.headers.get('x-correlation-id'),
        contentType,
      },
      body,
    };
  } catch (error) {
    return {
      operationId: operation.id,
      request: { method: operation.method, path: `${url.pathname}${url.search}`, body: options.body },
      status: 0,
      ok: false,
      durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
      headers: {},
      body: { code: error.name === 'TimeoutError' ? 'DEMO_UPSTREAM_TIMEOUT' : 'DEMO_UPSTREAM_ERROR', message: error.message },
    };
  }
}

async function callUpstream(path, options = {}) {
  const url = buildUrl(path, options.query);
  const headers = { accept: 'application/json', 'x-correlation-id': randomUUID() };
  if (options.appkey) headers.appkey = options.appkey;
  if (options.adminKey) headers['x-admin-key'] = options.adminKey;
  const init = { method: options.method ?? 'GET', headers, signal: AbortSignal.timeout(runtime.timeoutMs) };
  if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(options.body);
  }
  const response = await fetch(url, init);
  const contentType = response.headers.get('content-type') ?? '';
  const text = await response.text();
  let body = text;
  if (contentType.includes('json') && text) {
    try { body = JSON.parse(text); } catch { body = text; }
  }
  return { status: response.status, ok: response.ok, body, correlationId: response.headers.get('x-correlation-id') };
}

function callAdminUpstream(path, options = {}) {
  if (!runtime.adminKey) {
    throw Object.assign(new Error('관리자 credential 설정이 필요합니다.'), { statusCode: 400 });
  }
  return callUpstream(path, { ...options, adminKey: runtime.adminKey });
}

function callOperatorUpstream(path, options = {}) {
  if (!runtime.operatorKey) {
    throw Object.assign(new Error('지식 운영자 credential 설정이 필요합니다.'), { statusCode: 400 });
  }
  return callUpstream(path, { ...options, adminKey: runtime.operatorKey });
}

function requireUpstream(result, action) {
  if (result.ok) return result.body;
  const upstreamMessage = result.body && typeof result.body === 'object' ? result.body.message : undefined;
  throw Object.assign(new Error(`${action} 실패: HTTP ${result.status}${upstreamMessage ? ` · ${upstreamMessage}` : ''}`), { statusCode: 502 });
}

function assertLocalDemoMutation() {
  const target = identifyServerTarget(runtime.baseUrl, serverTargets);
  if (target !== 'local' && process.env.DEMO_ALLOW_NON_LOCAL_MUTATIONS !== 'true') {
    throw Object.assign(new Error('검증 데이터 변경은 기본적으로 로컬 AI Server에서만 허용됩니다.'), { statusCode: 403 });
  }
}

async function ensureDemoProfile(definition, fixtureVersion) {
  const appList = requireUpstream(await callAdminUpstream('/app-info'), 'AppInfo 목록 조회');
  const existing = appList.find((app) => app.appcode === definition.appcode);
  if (existing && existing.status !== 'active') {
    requireUpstream(await callAdminUpstream(`/app-info/${existing.id}`, { method: 'PATCH', body: { status: 'active' } }), '데모 앱 활성 복원');
  }
  const appResult = existing
    ? await callAdminUpstream(`/app-info/${existing.id}/appkey`, { method: 'POST' })
    : await callAdminUpstream('/app-info', {
        method: 'POST',
        body: {
          appname: definition.appname,
          appcode: definition.appcode,
          allowedAccessLevels: ['PUBLIC'],
          status: 'active',
          maxStorageMb: 100,
          monthlyTokenLimit: 1000000,
          metadata: { purpose: 'ai-server-validation-demo', fixtureVersion },
        },
      });
  const app = requireUpstream(appResult, existing ? '데모 appkey 회전' : '데모 앱 생성');
  const profile = { id: app.id, appcode: app.appcode, appkey: app.appkey, fileIds: [] };
  demoProfiles.set(profile.appcode, profile);
  return profile;
}

async function setupDemoEnvironment() {
  assertLocalDemoMutation();
  if (!runtime.adminKey || !runtime.operatorKey) {
    throw Object.assign(new Error('관리자와 지식 운영자 credential 설정이 필요합니다.'), { statusCode: 400 });
  }
  const startedAt = new Date().toISOString();
  const manifest = JSON.parse(await readFile(fixtureManifestPath, 'utf8'));
  const profiles = [];
  for (const definition of demoAppDefinitions) {
    const profile = await ensureDemoProfile(definition, manifest.version);
    for (const fixtureName of definition.fixtures) {
      const content = await readFile(join(root, 'fixtures', fixtureName), 'utf8');
      const created = requireUpstream(
        await callOperatorUpstream(`/admin/v1/knowledge/apps/${profile.id}/texts`, {
          method: 'POST',
          body: {
            originalName: fixtureName,
            content,
            accessLevel: 'PUBLIC',
            businessStatus: 'PUBLISHED',
            productCodes: definition.productCodes,
            metadata: { source: 'versioned-demo-fixture', fixtureVersion: manifest.version, tenant: definition.appcode },
          },
        }),
        `${definition.appcode} fixture 등록`,
      );
      profile.fileIds.push(created.fileId);
    }
    profiles.push(profile);
  }
  runtime.appkey = demoProfiles.get('hj-ai-demo-store-a').appkey;
  runtime.updatedAt = new Date().toISOString();
  const report = {
    type: 'setup',
    ...(await reportContext('1.0.0')),
    startedAt,
    profiles: profiles.map((profile) => ({ id: profile.id, appcode: profile.appcode, fileIds: profile.fileIds, status: 'ready' })),
  };
  report.reportFile = await saveReport('setup', report);
  return report;
}

async function runTenantIsolationScenario() {
  assertLocalDemoMutation();
  const startedAt = new Date().toISOString();
  const storeA = demoProfiles.get('hj-ai-demo-store-a');
  const storeB = demoProfiles.get('hj-ai-demo-store-b');
  if (!storeA || !storeB) throw Object.assign(new Error('먼저 STORE_A/STORE_B 검증 환경을 준비해야 합니다.'), { statusCode: 409 });
  const tests = [];
  const check = async (id, name, execute) => {
    try {
      const passed = await execute();
      tests.push({ id, name, passed: Boolean(passed), reasons: passed ? [] : ['기대 조건을 충족하지 않았습니다.'] });
    } catch (error) {
      tests.push({ id, name, passed: false, reasons: [error.message] });
    }
  };
  await check('TEN-001', 'STORE_A 키로 STORE_B 파일 상세에 접근할 수 없다', async () => {
    const result = await callUpstream(`/knowledge/files/${storeB.fileIds[0]}`, { appkey: storeA.appkey });
    return result.status === 404;
  });
  await check('TEN-002', 'STORE_A 파일 목록에 STORE_B 파일이 노출되지 않는다', async () => {
    const result = await callUpstream('/knowledge/files', { appkey: storeA.appkey });
    return result.ok && !result.body.some((file) => storeB.fileIds.includes(file.id));
  });
  await check('TEN-003', 'STORE_A 검색에 STORE_B 근거가 노출되지 않는다', async () => {
    const result = await callUpstream('/knowledge/search', {
      method: 'POST',
      appkey: storeA.appkey,
      body: { query: '디지털 상품과 고객 주문 제작 상품 환불', limit: 20, scoreThreshold: -1, filters: { accessLevels: ['PUBLIC'], businessStatuses: ['PUBLISHED'] } },
    });
    return result.ok && !result.body.matches.some((match) => storeB.fileIds.includes(match.fileId));
  });
  await check('TEN-004', '변조된 appkey를 거절한다', async () => {
    const replacement = storeA.appkey.endsWith('x') ? 'y' : 'x';
    const result = await callUpstream('/knowledge/files', { appkey: `${storeA.appkey.slice(0, -1)}${replacement}` });
    return result.status === 401;
  });
  await check('TEN-005', '키 회전 후 이전 STORE_B 키는 폐기된다', async () => {
    const oldKey = storeB.appkey;
    const rotated = requireUpstream(await callAdminUpstream(`/app-info/${storeB.id}/appkey`, { method: 'POST' }), 'STORE_B appkey 회전');
    storeB.appkey = rotated.appkey;
    const oldResult = await callUpstream('/knowledge/files', { appkey: oldKey });
    const newResult = await callUpstream('/knowledge/files', { appkey: storeB.appkey });
    return oldResult.status === 401 && newResult.status === 200;
  });
  await check('TEN-006', '비활성 STORE_B 키는 403으로 거절된다', async () => {
    requireUpstream(await callAdminUpstream(`/app-info/${storeB.id}`, { method: 'PATCH', body: { status: 'inactive' } }), 'STORE_B 비활성화');
    try {
      const result = await callUpstream('/knowledge/files', { appkey: storeB.appkey });
      return result.status === 403;
    } finally {
      requireUpstream(await callAdminUpstream(`/app-info/${storeB.id}`, { method: 'PATCH', body: { status: 'active' } }), 'STORE_B 활성 복원');
    }
  });
  const report = {
    type: 'tenant-isolation',
    ...(await reportContext('1.0.0')),
    startedAt,
    summary: { total: tests.length, passed: tests.filter((test) => test.passed).length, failed: tests.filter((test) => !test.passed).length },
    results: tests,
  };
  report.reportFile = await saveReport('tenant-isolation', report);
  return report;
}

async function runRbacScenario() {
  assertLocalDemoMutation();
  const startedAt = new Date().toISOString();
  const storeA = demoProfiles.get('hj-ai-demo-store-a');
  const storeB = demoProfiles.get('hj-ai-demo-store-b');
  if (!storeA || !storeB) throw Object.assign(new Error('먼저 STORE_A/STORE_B 검증 환경을 준비해야 합니다.'), { statusCode: 409 });
  if (!runtime.adminKey || !runtime.operatorKey) throw Object.assign(new Error('관리자와 지식 운영자 credential 설정이 필요합니다.'), { statusCode: 400 });
  const tests = [];
  const check = async (id, name, execute) => {
    try {
      const passed = await execute();
      tests.push({ id, name, passed: Boolean(passed), reasons: passed ? [] : ['기대 조건을 충족하지 않았습니다.'] });
    } catch (error) {
      tests.push({ id, name, passed: false, reasons: [error.message] });
    }
  };
  await check('RBAC-001', '지식 운영자는 AppInfo에 접근할 수 없다', async () => {
    const result = await callUpstream('/app-info', { adminKey: runtime.operatorKey });
    return result.status === 403;
  });
  await check('RBAC-002', '플랫폼 관리자는 지식 운영 API에 접근할 수 있다', async () => {
    const result = await callUpstream(`/admin/v1/knowledge/apps/${storeA.id}/files`, { adminKey: runtime.adminKey });
    return result.status === 200;
  });
  await check('RBAC-003', '지식 운영자는 지식 운영 API에 접근할 수 있다', async () => {
    const result = await callOperatorUpstream(`/admin/v1/knowledge/apps/${storeA.id}/files`);
    return result.status === 200;
  });
  await check('RBAC-004', '외부 appkey는 지식 운영 API에 접근할 수 없다', async () => {
    const result = await callUpstream(`/admin/v1/knowledge/apps/${storeA.id}/files`, { appkey: storeA.appkey });
    return result.status === 401;
  });
  await check('RBAC-005', 'credential이 없으면 지식 운영 API에 접근할 수 없다', async () => {
    const result = await callUpstream(`/admin/v1/knowledge/apps/${storeA.id}/files`);
    return result.status === 401;
  });
  await check('RBAC-006', '지식 운영자는 명시된 다른 앱도 운영할 수 있다', async () => {
    const result = await callOperatorUpstream(`/admin/v1/knowledge/apps/${storeB.id}/files`);
    return result.status === 200;
  });
  const report = {
    type: 'rbac',
    ...(await reportContext('1.0.0')),
    startedAt,
    summary: { total: tests.length, passed: tests.filter((test) => test.passed).length, failed: tests.filter((test) => !test.passed).length },
    results: tests,
  };
  report.reportFile = await saveReport('rbac', report);
  return report;
}

async function cleanupDemoEnvironment() {
  assertLocalDemoMutation();
  const startedAt = new Date().toISOString();
  const appList = requireUpstream(await callAdminUpstream('/app-info'), 'AppInfo 목록 조회');
  const cleaned = [];
  for (const definition of demoAppDefinitions) {
    const app = appList.find((candidate) => candidate.appcode === definition.appcode);
    if (!app) continue;
    const files = requireUpstream(await callOperatorUpstream(`/admin/v1/knowledge/apps/${app.id}/files`), 'cleanup 파일 목록 조회');
    for (const file of files) {
      requireUpstream(await callOperatorUpstream(`/admin/v1/knowledge/apps/${app.id}/files/${file.id}`, { method: 'DELETE', query: { deleteObject: true } }), 'fixture 보관·원본 삭제');
    }
    requireUpstream(await callAdminUpstream(`/app-info/${app.id}`, { method: 'DELETE' }), '데모 앱 삭제');
    cleaned.push({ appcode: definition.appcode, archivedFiles: files.length, appDeleted: true });
  }
  demoProfiles.clear();
  runtime.appkey = '';
  runtime.updatedAt = new Date().toISOString();
  const report = { type: 'cleanup', ...(await reportContext('1.0.0')), startedAt, cleaned };
  report.reportFile = await saveReport('cleanup', report);
  return report;
}

function publicDemoState() {
  return {
    ready: demoAppDefinitions.every((definition) => demoProfiles.has(definition.appcode)),
    profiles: [...demoProfiles.values()].map((profile) => ({ id: profile.id, appcode: profile.appcode, fileCount: profile.fileIds.length })),
  };
}

async function saveReport(prefix, report) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const name = `${prefix}-${stamp}.json`;
  await writeFile(join(reportRoot, name), JSON.stringify(report, null, 2), 'utf8');
  return name;
}

async function runContractScenario() {
  const scenario = JSON.parse(await readFile(scenarioPath, 'utf8'));
  const results = [];
  for (const scenarioTest of scenario.tests) {
    if (scenarioTest.requiresAppkey && !runtime.appkey) {
      results.push({ ...scenarioTest, skipped: true, passed: false, reasons: ['appkey가 설정되지 않았습니다.'] });
      continue;
    }
    if (scenarioTest.requiresAdminKey && !runtime.adminKey) {
      results.push({ ...scenarioTest, skipped: true, passed: false, reasons: ['관리자 credential이 설정되지 않았습니다.'] });
      continue;
    }
    const operation = findOperation(scenarioTest.operationId);
    const result = await invoke(operation, {
      body: scenarioTest.body,
      correlationId: scenarioTest.correlationId,
      sendAppkey: scenarioTest.sendAppkey,
      sendAdminKey: scenarioTest.sendAdminKey,
      adminKey: scenarioTest.adminKey,
      sendOperatorKey: scenarioTest.sendOperatorKey,
      operatorKey: scenarioTest.operatorKey,
    });
    const evaluation = evaluateExpectation(result, scenarioTest.expect);
    results.push({ id: scenarioTest.id, name: scenarioTest.name, ...evaluation, result });
  }
  const report = {
    type: 'contract',
    scenario: scenario.name,
    ...(await reportContext(scenario.version)),
    startedAt: new Date().toISOString(),
    summary: {
      total: results.length,
      passed: results.filter((item) => item.passed).length,
      failed: results.filter((item) => !item.passed && !item.skipped).length,
      skipped: results.filter((item) => item.skipped).length,
    },
    results,
  };
  report.reportFile = await saveReport('contract', report);
  return report;
}

async function runPerformance(input) {
  const operation = findOperation(input.operationId);
  if (!operation?.performanceSafe) throw Object.assign(new Error('성능 시험이 허용된 operation이 아닙니다.'), { statusCode: 400 });
  if (operation.auth !== false && !runtime.appkey) throw Object.assign(new Error('appkey 설정이 필요합니다.'), { statusCode: 400 });
  const total = Math.min(200, Math.max(1, Number(input.total ?? 20)));
  const concurrency = Math.min(20, Math.max(1, Number(input.concurrency ?? 1)));
  const body = structuredClone(input.body ?? {});
  if (['bedrock.converse', 'knowledge.rag', 'knowledge.answers'].includes(operation.id) && body.maxTokens === undefined) {
    body.maxTokens = 512;
  }
  const startedAt = performance.now();
  const results = new Array(total);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= total) return;
      results[index] = await invoke(operation, { body, query: input.query });
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, total) }, worker));
  const elapsedMs = performance.now() - startedAt;
  const latencies = results.map((result) => result.durationMs);
  const statusCounts = {};
  for (const result of results) statusCounts[result.status] = (statusCounts[result.status] ?? 0) + 1;
  const totalTokens = results.reduce((sum, result) => sum + collectTotalTokens(result.body), 0);
  const report = {
    type: 'performance',
    ...(await reportContext()),
    operationId: operation.id,
    startedAt: new Date().toISOString(),
    configuration: { total, concurrency, body, query: input.query ?? {} },
    summary: {
      elapsedMs: Math.round(elapsedMs * 100) / 100,
      throughputPerSecond: Math.round((total / (elapsedMs / 1000)) * 100) / 100,
      successRate: Math.round((results.filter((result) => result.ok).length / total) * 10000) / 100,
      statusCounts,
      latencyMs: {
        min: Math.min(...latencies),
        average: Math.round((latencies.reduce((sum, value) => sum + value, 0) / total) * 100) / 100,
        p50: percentile(latencies, 0.5),
        p95: percentile(latencies, 0.95),
        p99: percentile(latencies, 0.99),
        max: Math.max(...latencies),
      },
      tokens: { total: totalTokens, averagePerRequest: Math.round((totalTokens / total) * 100) / 100 },
    },
    samples: results.slice(0, 10),
  };
  report.reportFile = await saveReport('performance', report);
  return report;
}

async function serveStatic(request, response, pathname) {
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filePath = normalize(join(publicRoot, relative));
  if (filePath !== publicRoot && !filePath.startsWith(`${publicRoot}${sep}`)) return false;
  try {
    const content = await readFile(filePath);
    response.writeHead(200, { 'content-type': mimeTypes[extname(filePath)] ?? 'application/octet-stream' });
    response.end(content);
    return true;
  } catch {
    return false;
  }
}

export const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`);
  try {
    if (request.method === 'GET' && url.pathname === '/api/config') {
      return sendJson(response, 200, publicConfig());
    }
    if (request.method === 'PUT' && url.pathname === '/api/config') {
      const input = await readJson(request);
      if (input.baseUrl) runtime.baseUrl = normalizeBaseUrl(input.baseUrl);
      if (typeof input.appkey === 'string' && input.appkey.trim()) runtime.appkey = input.appkey.trim();
      if (typeof input.adminKey === 'string' && input.adminKey.trim()) runtime.adminKey = input.adminKey.trim();
      if (typeof input.operatorKey === 'string' && input.operatorKey.trim()) runtime.operatorKey = input.operatorKey.trim();
      if (input.clearAppkey === true) runtime.appkey = '';
      if (input.clearAdminKey === true) runtime.adminKey = '';
      if (input.clearOperatorKey === true) runtime.operatorKey = '';
      if (input.timeoutMs !== undefined) runtime.timeoutMs = Math.min(120000, Math.max(1000, Number(input.timeoutMs)));
      runtime.updatedAt = new Date().toISOString();
      return sendJson(response, 200, publicConfig());
    }
    if (request.method === 'GET' && url.pathname === '/api/catalog') return sendJson(response, 200, operations);
    if (request.method === 'GET' && url.pathname === '/api/demo/state') return sendJson(response, 200, publicDemoState());
    if (request.method === 'POST' && url.pathname === '/api/demo/setup') {
      const input = await readJson(request);
      if (input.confirmSetup !== true) throw Object.assign(new Error('검증 환경 생성은 confirmSetup=true가 필요합니다.'), { statusCode: 400 });
      return sendJson(response, 200, await setupDemoEnvironment());
    }
    if (request.method === 'POST' && url.pathname === '/api/demo/tenant-validation') {
      const input = await readJson(request);
      if (input.confirmValidation !== true) throw Object.assign(new Error('테넌트 검증은 confirmValidation=true가 필요합니다.'), { statusCode: 400 });
      return sendJson(response, 200, await runTenantIsolationScenario());
    }
    if (request.method === 'POST' && url.pathname === '/api/demo/rbac-validation') {
      const input = await readJson(request);
      if (input.confirmValidation !== true) throw Object.assign(new Error('RBAC 검증은 confirmValidation=true가 필요합니다.'), { statusCode: 400 });
      return sendJson(response, 200, await runRbacScenario());
    }
    if (request.method === 'POST' && url.pathname === '/api/demo/cleanup') {
      const input = await readJson(request);
      if (input.confirmCleanup !== true || input.confirmation !== 'DELETE_DEMO_DATA') throw Object.assign(new Error('정리는 confirmCleanup=true와 confirmation=DELETE_DEMO_DATA가 필요합니다.'), { statusCode: 400 });
      return sendJson(response, 200, await cleanupDemoEnvironment());
    }
    if (request.method === 'POST' && url.pathname === '/api/invoke') {
      const input = await readJson(request);
      const operation = findOperation(input.operationId);
      if (!operation || operation.upload || operation.download) throw Object.assign(new Error('지원하지 않는 operation입니다.'), { statusCode: 400 });
      if (operation.destructive && input.confirmDestructive !== true) throw Object.assign(new Error('파괴적 요청은 confirmDestructive=true가 필요합니다.'), { statusCode: 400 });
      return sendJson(response, 200, await invoke(operation, input));
    }
    if (request.method === 'POST' && url.pathname === '/api/upload') {
      const operation = findOperation(url.searchParams.get('operationId'));
      if (!operation?.upload) throw Object.assign(new Error('업로드 operation이 필요합니다.'), { statusCode: 400 });
      const credential = operation.auth === 'operator' ? runtime.operatorKey : runtime.appkey;
      if (!credential) throw Object.assign(new Error(operation.auth === 'operator' ? '지식 운영자 credential 설정이 필요합니다.' : 'appkey 설정이 필요합니다.'), { statusCode: 400 });
      const body = await readBuffer(request);
      let params = {};
      try { params = JSON.parse(url.searchParams.get('params') ?? '{}'); } catch { throw Object.assign(new Error('업로드 경로 파라미터는 유효한 JSON이어야 합니다.'), { statusCode: 400 }); }
      const upstream = await fetch(buildUrl(renderPath(operation.path, params)), {
        method: 'POST',
        headers: { 'content-type': request.headers['content-type'], [operation.auth === 'operator' ? 'x-admin-key' : 'appkey']: credential, 'x-correlation-id': randomUUID() },
        body,
        signal: AbortSignal.timeout(runtime.timeoutMs),
      });
      const text = await upstream.text();
      let parsed = text;
      try { parsed = JSON.parse(text); } catch {}
      return sendJson(response, 200, { status: upstream.status, ok: upstream.ok, headers: { correlationId: upstream.headers.get('x-correlation-id') }, body: parsed });
    }
    if (request.method === 'GET' && url.pathname === '/api/download') {
      if (!runtime.appkey) throw Object.assign(new Error('appkey 설정이 필요합니다.'), { statusCode: 400 });
      const upstream = await fetch(buildUrl('/storage/download', { key: url.searchParams.get('key') }), { headers: { appkey: runtime.appkey }, signal: AbortSignal.timeout(runtime.timeoutMs) });
      response.writeHead(upstream.status, {
        'content-type': upstream.headers.get('content-type') ?? 'application/octet-stream',
        'content-disposition': upstream.headers.get('content-disposition') ?? 'attachment; filename="download"',
      });
      if (!upstream.body) {
        response.end();
        return;
      }
      await pipeline(Readable.fromWeb(upstream.body), response);
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/scenarios/run') return sendJson(response, 200, await runContractScenario());
    if (request.method === 'POST' && url.pathname === '/api/performance/run') return sendJson(response, 200, await runPerformance(await readJson(request)));
    if (request.method === 'GET' && !url.pathname.startsWith('/api/')) {
      if (await serveStatic(request, response, url.pathname)) return;
    }
    return sendJson(response, 404, { code: 'DEMO_NOT_FOUND', message: '요청한 데모 경로를 찾을 수 없습니다.' });
  } catch (error) {
    return sendJson(response, error.statusCode ?? 500, { code: 'DEMO_ERROR', message: error.message });
  }
});

server.listen(port, host, () => {
  console.log(`HJ AI Server Demo Console: http://${host}:${port}`);
  console.log(`Target AI Server: ${runtime.baseUrl}`);
});
