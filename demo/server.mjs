
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  collectTotalTokens,
  evaluateExpectation,
  evaluateKnowledgeLifecycleStep,
  evaluatePolicyMatrixSearch,
  evaluateKnowledgeUploadRejection,
  identifyServerTarget,
  normalizeBaseUrl,
  percentile,
  renderPath,
} from './lib.mjs';
import { findOperation, operations } from './catalog.mjs';
import { requireStandardPort } from '../config/standard-ports.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const publicRoot = join(root, 'public');
const scenarioPath = join(root, 'scenarios', 'core.json');
const fixtureManifestPath = join(root, 'fixtures', 'manifest.json');
const reportRoot = join(root, 'reports');
const port = requireStandardPort('validationDemo', process.env.DEMO_PORT);
const host = process.env.DEMO_HOST ?? '127.0.0.1';
const maxBodyBytes = 40 * 1024 * 1024;
const knowledgeMaxFileSizeMb = Number(process.env.KNOWLEDGE_MAX_FILE_SIZE_MB ?? 30);
const demoAppDefinitions = [
  {
    appcode: 'hj-ai-demo-store-a',
    appname: 'HJ AI 검증 STORE_A',
    fixtures: ['store-a-policy.md', 'store-a-products.csv'],
    parserFixtures: ['store-a-returns-guide.pdf', 'store-a-service-manual.docx', 'store-a-inventory.xlsx'],
    productCodes: ['STORE_A'],
  },
  {
    appcode: 'hj-ai-demo-store-b',
    appname: 'HJ AI 검증 STORE_B',
    fixtures: ['store-b-policy.md'],
    parserFixtures: [],
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
  adminKey: process.env.AI_SERVER_ADMIN_API_KEY ?? process.env.ADMIN_API_KEY ?? '',
  operatorKey: process.env.AI_SERVER_KNOWLEDGE_OPERATOR_API_KEY ?? process.env.KNOWLEDGE_OPERATOR_API_KEY ?? '',
  swaggerPath: (process.env.AI_SERVER_SWAGGER_PATH ?? 'api-docs').replace(/^\/+|\/+$/g, ''),
  corsAllowedOrigin: process.env.AI_SERVER_CORS_ALLOWED_ORIGIN ?? 'http://127.0.0.1:11001',
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
    swaggerPath: runtime.swaggerPath,
    corsAllowedOrigin: runtime.corsAllowedOrigin,
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
  const headers = { accept: 'application/json', 'x-correlation-id': randomUUID(), ...(options.headers ?? {}) };
  if (options.appkey) headers.appkey = options.appkey;
  if (options.adminKey) headers['x-admin-key'] = options.adminKey;
  const init = { method: options.method ?? 'GET', headers, signal: AbortSignal.timeout(runtime.timeoutMs) };
  if (options.formData) {
    init.body = options.formData;
  } else if (options.body !== undefined) {
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
  return {
    status: response.status,
    ok: response.ok,
    body,
    correlationId: response.headers.get('x-correlation-id'),
    accessControlAllowOrigin: response.headers.get('access-control-allow-origin'),
    accessControlAllowCredentials: response.headers.get('access-control-allow-credentials'),
  };
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
  const profile = { id: app.id, appcode: app.appcode, appkey: app.appkey, fileIds: [], parserFixtures: {} };
  demoProfiles.set(profile.appcode, profile);
  return profile;
}

async function ensureParserFixture(profile, definition, descriptor, existingFiles) {
  let file = existingFiles.find((candidate) => candidate.originalName === descriptor.name);
  if (!file) {
    const fixtureBody = await readFile(join(root, 'fixtures', descriptor.name));
    const formData = new FormData();
    formData.append('file', new Blob([fixtureBody], { type: descriptor.contentType }), descriptor.name);
    file = requireUpstream(
      await callOperatorUpstream(`/admin/v1/knowledge/apps/${profile.id}/files`, {
        method: 'POST',
        formData,
      }),
      `${descriptor.name} 업로드`,
    );
    existingFiles.unshift(file);
  }

  const indexed = requireUpstream(
    await callOperatorUpstream(`/admin/v1/knowledge/apps/${profile.id}/files/${file.id}/reindex`, { method: 'POST' }),
    `${descriptor.name} parser·인덱싱`,
  );
  requireUpstream(
    await callOperatorUpstream(`/admin/v1/knowledge/apps/${profile.id}/files/${file.id}/policy`, {
      method: 'PATCH',
      body: {
        accessLevel: 'PUBLIC',
        businessStatus: 'PUBLISHED',
        productCodes: definition.productCodes,
      },
    }),
    `${descriptor.name} 공개 정책 적용`,
  );

  profile.fileIds.push(file.id);
  profile.parserFixtures[descriptor.name] = {
    fileId: file.id,
    chunkCount: indexed.chunkCount,
  };
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
    const existingFiles = requireUpstream(
      await callOperatorUpstream(`/admin/v1/knowledge/apps/${profile.id}/files`),
      `${definition.appcode} 파일 목록 조회`,
    );
    for (const fixtureName of definition.parserFixtures) {
      const descriptor = manifest.parserFixtures.find((candidate) => candidate.name === fixtureName);
      if (!descriptor) throw new Error(`manifest에 parser fixture가 없습니다: ${fixtureName}`);
      await ensureParserFixture(profile, definition, descriptor, existingFiles);
    }
    profiles.push(profile);
  }
  runtime.appkey = demoProfiles.get('hj-ai-demo-store-a').appkey;
  runtime.updatedAt = new Date().toISOString();
  const report = {
    type: 'setup',
    ...(await reportContext('2.0.0')),
    startedAt,
    profiles: profiles.map((profile) => ({
      id: profile.id,
      appcode: profile.appcode,
      fileIds: profile.fileIds,
      parserFixtures: profile.parserFixtures,
      status: 'ready',
    })),
  };
  report.reportFile = await saveReport('setup', report);
  return report;
}

async function runParserRegressionScenario() {
  const startedAt = new Date().toISOString();
  const storeA = demoProfiles.get('hj-ai-demo-store-a');
  if (!storeA) throw Object.assign(new Error('먼저 STORE_A 검증 환경을 준비해야 합니다.'), { statusCode: 409 });
  const manifest = JSON.parse(await readFile(fixtureManifestPath, 'utf8'));
  const tests = [];
  const check = async (id, name, execute) => {
    try {
      const passed = await execute();
      tests.push({ id, name, passed: Boolean(passed), reasons: passed ? [] : ['기대 조건을 충족하지 않았습니다.'] });
    } catch (error) {
      tests.push({ id, name, passed: false, reasons: [error.message] });
    }
  };

  for (const [index, descriptor] of manifest.parserFixtures.entries()) {
    const fixture = storeA.parserFixtures[descriptor.name];
    await check(`PAR-${String(index * 2 + 1).padStart(3, '0')}`, `${descriptor.name} parser metadata와 chunk 수가 일치한다`, async () => {
      if (!fixture) return false;
      const detail = await callOperatorUpstream(`/admin/v1/knowledge/apps/${storeA.id}/files/${fixture.fileId}`);
      if (!detail.ok) return false;
      const parsed = detail.body.metadata?.parsed;
      const sheetsMatch = !descriptor.sheetNames || descriptor.sheetNames.every((sheetName) => parsed?.sheetNames?.includes(sheetName));
      const pagesMatch = !descriptor.pageCount || parsed?.pageCount === descriptor.pageCount;
      return detail.body.status === 'indexed'
        && detail.body._count?.chunks >= descriptor.minimumChunkCount
        && parsed?.parser === descriptor.parser
        && parsed?.sourceType === descriptor.sourceType
        && sheetsMatch
        && pagesMatch;
    });

    await check(`PAR-${String(index * 2 + 2).padStart(3, '0')}`, `${descriptor.name} 고유 표식을 검색할 수 있다`, async () => {
      if (!fixture) return false;
      const result = await callUpstream('/knowledge/search', {
        method: 'POST',
        appkey: storeA.appkey,
        body: {
          query: descriptor.searchMarker,
          limit: 20,
          scoreThreshold: -1,
          filters: { accessLevels: ['PUBLIC'], businessStatuses: ['PUBLISHED'] },
        },
      });
      return result.ok && result.body.matches.some((match) =>
        match.fileId === fixture.fileId
        && match.content.includes(descriptor.searchMarker)
        && match.metadata?.sourceType === descriptor.sourceType,
      );
    });
  }

  const summary = { total: tests.length, passed: tests.filter((test) => test.passed).length, failed: tests.filter((test) => !test.passed).length };
  const report = {
    type: 'parser-regression',
    ...(await reportContext('1.0.0')),
    startedAt,
    finishedAt: new Date().toISOString(),
    summary,
    results: tests,
  };
  report.reportFile = await saveReport('parser-regression', report);
  return report;
}

function lifecycleEvidence(step, body, fileId) {
  if (!body || typeof body !== 'object') return { bodyType: typeof body };
  if (step === 'policy') {
    return {
      fileId: body.id,
      accessLevel: body.accessLevel,
      businessStatus: body.businessStatus,
      productCodes: body.productCodes,
    };
  }
  if (step === 'search') {
    return {
      count: body.count,
      matchedFileIds: body.matches?.map((match) => match.fileId) ?? [],
    };
  }
  if (step === 'answer') {
    return {
      answerable: body.answerable,
      retrieval: body.retrieval,
      sourceFileIds: body.sources?.map((source) => source.fileId) ?? [],
    };
  }
  return {
    fileId: body.id ?? body.fileId ?? fileId,
    status: body.status,
    chunkCount: body.chunkCount ?? body._count?.chunks,
    archivedAt: body.metadata?.archivedAt,
    deleteObjectRequested: body.metadata?.deleteObjectRequested,
    deletedObject: body.metadata?.deletedObject,
    objectCleanupStatus: body.metadata?.objectCleanupStatus,
  };
}

async function runKnowledgeLifecycleScenario() {
  assertLocalDemoMutation();
  const startedAt = new Date().toISOString();
  const storeA = demoProfiles.get('hj-ai-demo-store-a');
  if (!storeA) throw Object.assign(new Error('먼저 STORE_A 검증 환경을 준비해야 합니다.'), { statusCode: 409 });
  if (!runtime.operatorKey) throw Object.assign(new Error('지식 운영자 credential 설정이 필요합니다.'), { statusCode: 400 });

  const marker = `KNW-LIFE-${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`;
  const productCode = 'LIFECYCLE';
  const fileName = `knowledge-lifecycle-${marker.toLowerCase()}.md`;
  const content = [
    `검증 표식: ${marker}`,
    `상품 코드: ${productCode}`,
    `고객응대 정책: ${marker} 상품은 구매 후 30일 이내 영수증과 함께 서비스 데스크에서 교환할 수 있습니다.`,
  ].join('\n');
  const results = [];
  let fileId = null;
  let indexedChunkCount = null;
  let reindexedChunkCount = null;
  let archivedAt = null;

  const runStep = async (id, name, step, execute, context = {}) => {
    try {
      const body = requireUpstream(await execute(), name);
      const reasons = evaluateKnowledgeLifecycleStep(step, body, { fileId, marker, productCode, ...context });
      results.push({ id, name, passed: reasons.length === 0, skipped: false, reasons, evidence: lifecycleEvidence(step, body, fileId) });
      return body;
    } catch (error) {
      results.push({ id, name, passed: false, skipped: false, reasons: [error.message] });
      return null;
    }
  };
  const skipStep = (id, name) => {
    results.push({ id, name, passed: false, skipped: true, reasons: ['업로드 파일 ID가 없어 실행하지 않았습니다.'] });
  };

  const formData = new FormData();
  formData.append('file', new Blob([Buffer.from(content)], { type: 'text/markdown' }), fileName);
  const uploaded = await runStep('LIFE-001', 'multipart 파일 업로드가 uploaded 상태를 반환한다', 'upload', () =>
    callOperatorUpstream(`/admin/v1/knowledge/apps/${storeA.id}/files`, { method: 'POST', formData }),
  );
  fileId = uploaded?.id ?? null;

  if (fileId) {
    const indexed = await runStep('LIFE-002', '업로드 파일을 chunk와 embedding으로 인덱싱한다', 'index', () =>
      callOperatorUpstream(`/admin/v1/knowledge/apps/${storeA.id}/files/${fileId}/index`, { method: 'POST' }),
    );
    indexedChunkCount = indexed?.chunkCount ?? null;
    await runStep('LIFE-003', 'PUBLIC/PUBLISHED/productCode 정책을 적용한다', 'policy', () =>
      callOperatorUpstream(`/admin/v1/knowledge/apps/${storeA.id}/files/${fileId}/policy`, {
        method: 'PATCH',
        body: { accessLevel: 'PUBLIC', businessStatus: 'PUBLISHED', productCodes: [productCode] },
      }),
    );
    await runStep('LIFE-004', '정책 filter 검색에서 업로드 문서와 고유 표식을 찾는다', 'search', () =>
      callUpstream('/knowledge/search', {
        method: 'POST',
        appkey: storeA.appkey,
        body: {
          query: marker,
          limit: 20,
          scoreThreshold: -1,
          filters: {
            accessLevels: ['PUBLIC'],
            businessStatuses: ['PUBLISHED'],
            productCodes: [productCode],
          },
        },
      }),
    );
    await runStep('LIFE-005', '제품 답변이 업로드 문서를 근거 source로 반환한다', 'answer', () =>
      callUpstream('/knowledge/answers', {
        method: 'POST',
        appkey: storeA.appkey,
        body: {
          query: `${marker} 상품의 교환 정책을 알려주세요.`,
          limit: 20,
          scoreThreshold: -1,
          strict: true,
          includeSources: true,
          maxTokens: 256,
          filters: {
            accessLevels: ['PUBLIC'],
            businessStatuses: ['PUBLISHED'],
            productCodes: [productCode],
          },
        },
      }),
    );
    const reindexed = await runStep(
      'LIFE-006',
      '인덱싱된 파일을 같은 chunk 수로 재인덱싱한다',
      'reindex',
      () => callOperatorUpstream(
        `/admin/v1/knowledge/apps/${storeA.id}/files/${fileId}/reindex`,
        { method: 'POST' },
      ),
      { expectedChunkCount: indexedChunkCount },
    );
    reindexedChunkCount = reindexed?.chunkCount ?? null;
    await runStep(
      'LIFE-007',
      '재인덱싱을 중복 실행해도 chunk 수가 유지된다',
      'reindex',
      () => callOperatorUpstream(
        `/admin/v1/knowledge/apps/${storeA.id}/files/${fileId}/reindex`,
        { method: 'POST' },
      ),
      { expectedChunkCount: reindexedChunkCount },
    );
    await runStep('LIFE-008', '중복 재인덱싱 후 정책 filter 검색 결과를 유지한다', 'search', () =>
      callUpstream('/knowledge/search', {
        method: 'POST',
        appkey: storeA.appkey,
        body: {
          query: marker,
          limit: 20,
          scoreThreshold: -1,
          filters: {
            accessLevels: ['PUBLIC'],
            businessStatuses: ['PUBLISHED'],
            productCodes: [productCode],
          },
        },
      }),
    );
    const cleaned = await runStep('LIFE-009', '검증 파일의 chunk와 S3 원본을 정리한다', 'cleanup', () =>
      callOperatorUpstream(`/admin/v1/knowledge/apps/${storeA.id}/files/${fileId}`, {
        method: 'DELETE',
        query: { deleteObject: true },
      }),
    );
    archivedAt = cleaned?.metadata?.archivedAt ?? null;
    await runStep(
      'LIFE-010',
      '정리를 중복 실행해도 archive와 S3 삭제 완료 상태를 유지한다',
      'cleanup-repeat',
      () => callOperatorUpstream(
        `/admin/v1/knowledge/apps/${storeA.id}/files/${fileId}`,
        {
          method: 'DELETE',
          query: { deleteObject: true },
        },
      ),
      { archivedAt },
    );
  } else {
    skipStep('LIFE-002', '업로드 파일을 chunk와 embedding으로 인덱싱한다');
    skipStep('LIFE-003', 'PUBLIC/PUBLISHED/productCode 정책을 적용한다');
    skipStep('LIFE-004', '정책 filter 검색에서 업로드 문서와 고유 표식을 찾는다');
    skipStep('LIFE-005', '제품 답변이 업로드 문서를 근거 source로 반환한다');
    skipStep('LIFE-006', '인덱싱된 파일을 같은 chunk 수로 재인덱싱한다');
    skipStep('LIFE-007', '재인덱싱을 중복 실행해도 chunk 수가 유지된다');
    skipStep('LIFE-008', '중복 재인덱싱 후 정책 filter 검색 결과를 유지한다');
    skipStep('LIFE-009', '검증 파일의 chunk와 S3 원본을 정리한다');
    skipStep('LIFE-010', '정리를 중복 실행해도 archive와 S3 삭제 완료 상태를 유지한다');
  }

  const report = {
    type: 'knowledge-lifecycle',
    ...(await reportContext('2.0.0')),
    startedAt,
    finishedAt: new Date().toISOString(),
    fixture: { fileName, marker, productCode },
    summary: {
      total: results.length,
      passed: results.filter((item) => item.passed).length,
      failed: results.filter((item) => !item.passed && !item.skipped).length,
      skipped: results.filter((item) => item.skipped).length,
    },
    results,
  };
  report.reportFile = await saveReport('knowledge-lifecycle', report);
  return report;
}

async function runKnowledgePolicyMatrixScenario() {
  assertLocalDemoMutation();
  const startedAt = new Date().toISOString();
  const storeA = demoProfiles.get('hj-ai-demo-store-a');
  if (!storeA) throw Object.assign(new Error('먼저 STORE_A 검증 환경을 준비해야 합니다.'), { statusCode: 409 });
  if (!runtime.operatorKey) throw Object.assign(new Error('지식 운영자 credential 설정이 필요합니다.'), { statusCode: 400 });

  const marker = `KNW-MATRIX-${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`;
  const productCode = 'MATRIX_PRODUCT';
  const mismatchProductCode = 'OTHER_PRODUCT';
  const now = new Date();
  const activeAt = now.toISOString();
  const past = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const future = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  const fileName = `knowledge-policy-matrix-${marker.toLowerCase()}.md`;
  const results = [];
  let fileId = null;

  const record = (id, name, reasons, evidence = {}) => {
    results.push({ id, name, passed: reasons.length === 0, skipped: false, reasons, evidence });
  };
  const fail = (id, name, error) => record(id, name, [error.message]);
  const applyPolicy = async (id, name, policy) => {
    try {
      const body = requireUpstream(await callOperatorUpstream(`/admin/v1/knowledge/apps/${storeA.id}/files/${fileId}/policy`, { method: 'PATCH', body: policy }), name);
      const reasons = [];
      for (const key of ['accessLevel', 'businessStatus']) {
        if (policy[key] !== undefined && body[key] !== policy[key]) reasons.push(`${key} is ${body[key] ?? 'missing'}, expected ${policy[key]}`);
      }
      if (policy.productCodes && JSON.stringify(body.productCodes) !== JSON.stringify(policy.productCodes)) reasons.push('productCodes do not match policy');
      record(id, name, reasons, { fileId: body.id, accessLevel: body.accessLevel, businessStatus: body.businessStatus, productCodes: body.productCodes, effectiveFrom: body.effectiveFrom, effectiveTo: body.effectiveTo });
    } catch (error) { fail(id, name, error); }
  };
  const searchCase = async (id, name, expectedVisible, filters) => {
    try {
      const body = requireUpstream(await callUpstream('/knowledge/search', {
        method: 'POST',
        appkey: storeA.appkey,
        body: { query: marker, limit: 20, scoreThreshold: -1, filters },
      }), name);
      const reasons = evaluatePolicyMatrixSearch(body, fileId, expectedVisible);
      record(id, name, reasons, { expectedVisible, count: body.count, matchedFileIds: body.matches?.map((match) => match.fileId) ?? [], filters });
    } catch (error) { fail(id, name, error); }
  };

  try {
    const content = `검증 표식: ${marker}\n상품 코드: ${productCode}\n정책 matrix 자동 검증 전용 문서입니다.`;
    const formData = new FormData();
    formData.append('file', new Blob([Buffer.from(content)], { type: 'text/markdown' }), fileName);
    try {
      const uploaded = requireUpstream(await callOperatorUpstream(`/admin/v1/knowledge/apps/${storeA.id}/files`, { method: 'POST', formData }), '정책 matrix 파일 업로드');
      fileId = uploaded.id ?? null;
      record('MATRIX-001', '정책 matrix 파일을 DRAFT/INTERNAL 기본값으로 업로드한다', fileId && uploaded.status === 'uploaded' ? [] : ['uploaded file id or status is invalid'], { fileId, status: uploaded.status, accessLevel: uploaded.accessLevel, businessStatus: uploaded.businessStatus });
    } catch (error) { fail('MATRIX-001', '정책 matrix 파일을 DRAFT/INTERNAL 기본값으로 업로드한다', error); }

    if (!fileId) {
      for (let index = 2; index <= 16; index += 1) results.push({ id: `MATRIX-${String(index).padStart(3, '0')}`, name: '선행 업로드 실패로 건너뜀', passed: false, skipped: true, reasons: ['업로드 파일 ID가 없습니다.'] });
    } else {
      try {
        const indexed = requireUpstream(await callOperatorUpstream(`/admin/v1/knowledge/apps/${storeA.id}/files/${fileId}/index`, { method: 'POST' }), '정책 matrix 파일 인덱싱');
        record('MATRIX-002', '정책 matrix 파일을 인덱싱한다', indexed.status === 'indexed' && indexed.chunkCount > 0 ? [] : ['index status or chunk count is invalid'], { fileId, status: indexed.status, chunkCount: indexed.chunkCount });
      } catch (error) { fail('MATRIX-002', '정책 matrix 파일을 인덱싱한다', error); }

      await applyPolicy('MATRIX-003', 'PUBLIC/DRAFT/productCode 정책을 적용한다', { accessLevel: 'PUBLIC', businessStatus: 'DRAFT', productCodes: [productCode], effectiveFrom: null, effectiveTo: null });
      await searchCase('MATRIX-004', 'DRAFT filter는 DRAFT 문서를 포함한다', true, { accessLevels: ['PUBLIC'], businessStatuses: ['DRAFT'], productCodes: [productCode], activeAt });
      await searchCase('MATRIX-005', 'PUBLISHED filter는 DRAFT 문서를 제외한다', false, { accessLevels: ['PUBLIC'], businessStatuses: ['PUBLISHED'], productCodes: [productCode], activeAt });

      await applyPolicy('MATRIX-006', '미래 시작일의 PUBLIC/PUBLISHED 정책을 적용한다', { accessLevel: 'PUBLIC', businessStatus: 'PUBLISHED', productCodes: [productCode], effectiveFrom: future, effectiveTo: null });
      await searchCase('MATRIX-007', '시작일 전에는 PUBLISHED 문서를 제외한다', false, { accessLevels: ['PUBLIC'], businessStatuses: ['PUBLISHED'], productCodes: [productCode], activeAt });

      await applyPolicy('MATRIX-008', '현재 유효한 PUBLIC/PUBLISHED 기간 정책을 적용한다', { accessLevel: 'PUBLIC', businessStatus: 'PUBLISHED', productCodes: [productCode], effectiveFrom: past, effectiveTo: future });
      await searchCase('MATRIX-009', '유효 기간과 productCode가 일치하면 문서를 포함한다', true, { accessLevels: ['PUBLIC'], businessStatuses: ['PUBLISHED'], productCodes: [productCode], activeAt });
      await searchCase('MATRIX-010', 'productCode가 불일치하면 문서를 제외한다', false, { accessLevels: ['PUBLIC'], businessStatuses: ['PUBLISHED'], productCodes: [mismatchProductCode], activeAt });

      await applyPolicy('MATRIX-011', '종료된 PUBLIC/PUBLISHED 기간 정책을 적용한다', { accessLevel: 'PUBLIC', businessStatus: 'PUBLISHED', productCodes: [productCode], effectiveFrom: null, effectiveTo: past });
      await searchCase('MATRIX-012', '종료일 이후에는 문서를 제외한다', false, { accessLevels: ['PUBLIC'], businessStatuses: ['PUBLISHED'], productCodes: [productCode], activeAt });

      await applyPolicy('MATRIX-013', '현재 유효한 PUBLIC/RETIRED 정책을 적용한다', { accessLevel: 'PUBLIC', businessStatus: 'RETIRED', productCodes: [productCode], effectiveFrom: past, effectiveTo: future });
      await searchCase('MATRIX-014', 'RETIRED 문서는 PUBLISHED filter에서 제외된다', false, { accessLevels: ['PUBLIC'], businessStatuses: ['PUBLISHED'], productCodes: [productCode], activeAt });

      await applyPolicy('MATRIX-015', 'INTERNAL/PUBLISHED 정책을 적용한다', { accessLevel: 'INTERNAL', businessStatus: 'PUBLISHED', productCodes: [productCode], effectiveFrom: past, effectiveTo: future });
      await searchCase('MATRIX-016', 'PUBLIC 전용 app은 INTERNAL 문서를 요청해도 제외한다', false, { accessLevels: ['INTERNAL'], businessStatuses: ['PUBLISHED'], productCodes: [productCode], activeAt });
    }
  } finally {
    if (fileId) {
      try {
        const cleaned = requireUpstream(await callOperatorUpstream(`/admin/v1/knowledge/apps/${storeA.id}/files/${fileId}`, { method: 'DELETE', query: { deleteObject: true } }), '정책 matrix 파일 정리');
        record('MATRIX-CLEANUP', '정책 matrix 파일의 chunk와 S3 원본을 정리한다', cleaned.status === 'archived' && cleaned._count?.chunks === 0 && cleaned.metadata?.objectCleanupStatus === 'completed' ? [] : ['cleanup state is incomplete'], { fileId, status: cleaned.status, chunkCount: cleaned._count?.chunks, objectCleanupStatus: cleaned.metadata?.objectCleanupStatus });
      } catch (error) { fail('MATRIX-CLEANUP', '정책 matrix 파일의 chunk와 S3 원본을 정리한다', error); }
    }
  }

  const report = {
    type: 'knowledge-policy-matrix',
    ...(await reportContext('1.0.0')),
    startedAt,
    finishedAt: new Date().toISOString(),
    fixture: { fileName, marker, productCode, activeAt },
    summary: {
      total: results.length,
      passed: results.filter((item) => item.passed).length,
      failed: results.filter((item) => !item.passed && !item.skipped).length,
      skipped: results.filter((item) => item.skipped).length,
    },
    results,
  };
  report.reportFile = await saveReport('knowledge-policy-matrix', report);
  return report;
}

async function runKnowledgeIndexJobScenario() {
  assertLocalDemoMutation();
  const startedAt = new Date().toISOString();
  const storeA = demoProfiles.get('hj-ai-demo-store-a');
  if (!storeA) throw Object.assign(new Error('먼저 STORE_A 검증 환경을 준비해야 합니다.'), { statusCode: 409 });
  if (!runtime.operatorKey) throw Object.assign(new Error('지식 운영자 credential 설정이 필요합니다.'), { statusCode: 400 });

  const marker = `INDEX-JOB-${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`;
  const fileName = `knowledge-index-job-${marker.toLowerCase()}.md`;
  const idempotencyKey = `demo-${marker}`;
  const results = [];
  const observedStatuses = [];
  let fileId = null;
  let jobId = null;

  const record = (id, name, reasons, evidence = {}) => {
    results.push({ id, name, passed: reasons.length === 0, skipped: false, reasons, evidence });
  };
  const fail = (id, name, error) => record(id, name, [error.message]);

  try {
    const formData = new FormData();
    formData.append('file', new Blob([Buffer.from(`검증 표식: ${marker}\n비동기 인덱싱 작업 검증 전용 문서입니다.`)], { type: 'text/markdown' }), fileName);
    try {
      const uploaded = requireUpstream(await callOperatorUpstream(`/admin/v1/knowledge/apps/${storeA.id}/files`, { method: 'POST', formData }), '비동기 검증 파일 업로드');
      fileId = uploaded.id ?? null;
      record('INDEX-JOB-001', '비동기 검증 파일을 업로드한다', fileId && uploaded.status === 'uploaded' ? [] : ['uploaded file id or status is invalid'], { fileId, status: uploaded.status });
    } catch (error) { fail('INDEX-JOB-001', '비동기 검증 파일을 업로드한다', error); }

    if (fileId) {
      try {
        const submitted = requireUpstream(await callOperatorUpstream(`/admin/v1/knowledge/apps/${storeA.id}/files/${fileId}/index-jobs`, {
          method: 'POST',
          headers: { 'idempotency-key': idempotencyKey },
        }), '비동기 인덱싱 작업 제출');
        jobId = submitted.id ?? null;
        if (submitted.status && !observedStatuses.includes(submitted.status)) observedStatuses.push(submitted.status);
        record('INDEX-JOB-002', '인덱싱 작업을 202 비동기 큐에 제출한다', jobId && ['queued', 'processing', 'completed'].includes(submitted.status) ? [] : ['job id or initial status is invalid'], { jobId, status: submitted.status, attempt: submitted.attempt });
      } catch (error) { fail('INDEX-JOB-002', '인덱싱 작업을 202 비동기 큐에 제출한다', error); }

      if (jobId) {
        try {
          const duplicate = requireUpstream(await callOperatorUpstream(`/admin/v1/knowledge/apps/${storeA.id}/files/${fileId}/index-jobs`, {
            method: 'POST',
            headers: { 'idempotency-key': idempotencyKey },
          }), '동일 작업 중복 제출');
          record('INDEX-JOB-003', '동일 idempotency key는 같은 작업을 반환한다', duplicate.id === jobId ? [] : ['duplicate request created a different job'], { jobId, duplicateJobId: duplicate.id, status: duplicate.status });
        } catch (error) { fail('INDEX-JOB-003', '동일 idempotency key는 같은 작업을 반환한다', error); }

        try {
          let terminal = null;
          for (let poll = 0; poll < 120; poll += 1) {
            const current = requireUpstream(await callOperatorUpstream(`/admin/v1/knowledge/apps/${storeA.id}/index-jobs/${jobId}`), '인덱싱 작업 상태 조회');
            if (current.status && !observedStatuses.includes(current.status)) observedStatuses.push(current.status);
            if (['completed', 'failed'].includes(current.status)) {
              terminal = current;
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 250));
          }
          const reasons = [];
          if (!terminal) reasons.push('30초 안에 terminal 상태에 도달하지 못했습니다.');
          else {
            if (terminal.status !== 'completed') reasons.push(`final status is ${terminal.status}, expected completed`);
            if (terminal.attempt !== 1) reasons.push(`attempt is ${terminal.attempt}, expected 1`);
            if (!terminal.completedAt) reasons.push('completedAt is missing');
          }
          record('INDEX-JOB-004', '작업 상태를 조회해 완료와 1회 시도를 확인한다', reasons, { jobId, observedStatuses, finalStatus: terminal?.status ?? null, attempt: terminal?.attempt ?? null, completedAt: terminal?.completedAt ?? null });
        } catch (error) { fail('INDEX-JOB-004', '작업 상태를 조회해 완료와 1회 시도를 확인한다', error); }
      } else {
        results.push({ id: 'INDEX-JOB-003', name: '동일 idempotency key는 같은 작업을 반환한다', passed: false, skipped: true, reasons: ['작업 ID가 없습니다.'] });
        results.push({ id: 'INDEX-JOB-004', name: '작업 상태를 조회해 완료와 1회 시도를 확인한다', passed: false, skipped: true, reasons: ['작업 ID가 없습니다.'] });
      }
    } else {
      for (const [id, name] of [
        ['INDEX-JOB-002', '인덱싱 작업을 202 비동기 큐에 제출한다'],
        ['INDEX-JOB-003', '동일 idempotency key는 같은 작업을 반환한다'],
        ['INDEX-JOB-004', '작업 상태를 조회해 완료와 1회 시도를 확인한다'],
      ]) results.push({ id, name, passed: false, skipped: true, reasons: ['업로드 파일 ID가 없습니다.'] });
    }
  } finally {
    if (fileId) {
      try {
        const cleaned = requireUpstream(await callOperatorUpstream(`/admin/v1/knowledge/apps/${storeA.id}/files/${fileId}`, { method: 'DELETE', query: { deleteObject: true } }), '비동기 검증 파일 정리');
        record('INDEX-JOB-CLEANUP', '검증 파일과 검색 조각을 정리한다', cleaned.status === 'archived' && cleaned._count?.chunks === 0 ? [] : ['cleanup state is incomplete'], { fileId, status: cleaned.status, chunkCount: cleaned._count?.chunks, objectCleanupStatus: cleaned.metadata?.objectCleanupStatus });
      } catch (error) { fail('INDEX-JOB-CLEANUP', '검증 파일과 검색 조각을 정리한다', error); }
    }
  }

  const report = {
    type: 'knowledge-index-job',
    ...(await reportContext('1.0.0')),
    startedAt,
    finishedAt: new Date().toISOString(),
    fixture: { fileName, marker },
    summary: {
      total: results.length,
      passed: results.filter((item) => item.passed).length,
      failed: results.filter((item) => !item.passed && !item.skipped).length,
      skipped: results.filter((item) => item.skipped).length,
    },
    results,
  };
  report.reportFile = await saveReport('knowledge-index-job', report);
  return report;
}

async function runKnowledgeFileRejectionScenario() {
  assertLocalDemoMutation();
  const startedAt = new Date().toISOString();
  const storeA = demoProfiles.get('hj-ai-demo-store-a');
  if (!storeA) throw Object.assign(new Error('먼저 STORE_A 검증 환경을 준비해야 합니다.'), { statusCode: 409 });
  if (!runtime.operatorKey) throw Object.assign(new Error('지식 운영자 credential 설정이 필요합니다.'), { statusCode: 400 });
  if (!Number.isInteger(knowledgeMaxFileSizeMb) || knowledgeMaxFileSizeMb < 1 || knowledgeMaxFileSizeMb > 100) {
    throw Object.assign(new Error('KNOWLEDGE_MAX_FILE_SIZE_MB는 AI Server와 동일한 1~100 정수여야 합니다.'), { statusCode: 400 });
  }

  const oversizedBytes = knowledgeMaxFileSizeMb * 1024 * 1024 + 1;
  const cases = [
    { id: 'REJECT-001', name: '확장자와 MIME이 불일치한 위장 파일을 거절한다', fileName: 'disguised.txt', contentType: 'application/pdf', body: Buffer.from('%PDF-1.7 disguised'), expectation: { status: 400, code: 'VALIDATION_ERROR', messageIncludes: 'MIME' } },
    { id: 'REJECT-002', name: 'signature가 손상된 PDF를 거절한다', fileName: 'corrupted.pdf', contentType: 'application/pdf', body: Buffer.from('not a PDF'), expectation: { status: 400, code: 'VALIDATION_ERROR', messageIncludes: 'signature' } },
    { id: 'REJECT-003', name: 'signature가 손상된 DOCX를 거절한다', fileName: 'corrupted.docx', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', body: Buffer.from('not a DOCX'), expectation: { status: 400, code: 'VALIDATION_ERROR', messageIncludes: 'signature' } },
    { id: 'REJECT-004', name: 'signature가 손상된 XLSX를 거절한다', fileName: 'corrupted.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', body: Buffer.from('not an XLSX'), expectation: { status: 400, code: 'VALIDATION_ERROR', messageIncludes: 'signature' } },
    { id: 'REJECT-005', name: '빈 파일을 거절한다', fileName: 'empty.md', contentType: 'text/markdown', body: Buffer.alloc(0), expectation: { status: 400, code: 'VALIDATION_ERROR', messageIncludes: '빈 파일' } },
    { id: 'REJECT-006', name: '공백만 있는 문서를 거절한다', fileName: 'blank.md', contentType: 'text/markdown', body: Buffer.from('  \r\n\t'), expectation: { status: 400, code: 'VALIDATION_ERROR', messageIncludes: '빈 파일' } },
    { id: 'REJECT-007', name: `${knowledgeMaxFileSizeMb}MB 제한을 초과한 파일을 거절한다`, fileName: 'oversized.md', contentType: 'text/markdown', body: Buffer.alloc(oversizedBytes, 0x61), expectation: { status: 413, code: 'PAYLOAD_TOO_LARGE' } },
  ];

  const results = [];
  for (const testCase of cases) {
    try {
      const formData = new FormData();
      formData.append('file', new Blob([testCase.body], { type: testCase.contentType }), testCase.fileName);
      const response = await callOperatorUpstream(`/admin/v1/knowledge/apps/${storeA.id}/files`, { method: 'POST', formData });
      const reasons = evaluateKnowledgeUploadRejection(response, testCase.expectation);
      results.push({
        id: testCase.id,
        name: testCase.name,
        passed: reasons.length === 0,
        skipped: false,
        reasons,
        evidence: { fileName: testCase.fileName, bytes: testCase.body.length, status: response.status, code: response.body?.code, requestId: response.body?.requestId, correlationId: response.correlationId },
      });
    } catch (error) {
      results.push({ id: testCase.id, name: testCase.name, passed: false, skipped: false, reasons: [error.message] });
    }
  }

  const report = {
    type: 'knowledge-file-rejection',
    ...(await reportContext('1.0.0')),
    startedAt,
    finishedAt: new Date().toISOString(),
    fixture: { knowledgeMaxFileSizeMb, oversizedBytes },
    summary: { total: results.length, passed: results.filter((item) => item.passed).length, failed: results.filter((item) => !item.passed).length, skipped: 0 },
    results,
  };
  report.reportFile = await saveReport('knowledge-file-rejection', report);
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
  await check('TEN-007', 'STORE_A Answer sources에 STORE_B 근거가 노출되지 않는다', async () => {
    const result = await callUpstream('/knowledge/answers', {
      method: 'POST',
      appkey: storeA.appkey,
      body: {
        query: '디지털 상품과 고객 주문 제작 상품의 환불 정책을 알려주세요.',
        limit: 20,
        scoreThreshold: -1,
        strict: true,
        includeSources: true,
        includeSourceContent: true,
        maxTokens: 256,
      },
    });
    const sources = Array.isArray(result.body?.sources) ? result.body.sources : [];
    return result.ok && sources.length > 0 && sources.every((source) => storeA.fileIds.includes(source.fileId)) && !sources.some((source) => storeB.fileIds.includes(source.fileId));
  });
  await check('TEN-008', 'STORE_B Answer sources에 STORE_A 근거가 노출되지 않는다', async () => {
    const result = await callUpstream('/knowledge/answers', {
      method: 'POST',
      appkey: storeB.appkey,
      body: {
        query: 'STORE_A의 오전 10시 운영과 구매 후 7일 환불 정책을 알려주세요.',
        limit: 20,
        scoreThreshold: -1,
        strict: true,
        includeSources: true,
        includeSourceContent: true,
        maxTokens: 256,
      },
    });
    const sources = Array.isArray(result.body?.sources) ? result.body.sources : [];
    return result.ok && sources.length > 0 && sources.every((source) => storeB.fileIds.includes(source.fileId)) && !sources.some((source) => storeA.fileIds.includes(source.fileId));
  });
  const report = {
    type: 'tenant-isolation',
    ...(await reportContext('1.1.0')),
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

async function runHttpExposureScenario() {
  const startedAt = new Date().toISOString();
  const tests = [];
  const check = async (id, name, execute) => {
    try {
      const passed = await execute();
      tests.push({ id, name, passed: Boolean(passed), reasons: passed ? [] : ['기대 조건을 충족하지 않았습니다.'] });
    } catch (error) {
      tests.push({ id, name, passed: false, reasons: [error.message] });
    }
  };
  await check('HTTP-SEC-001', 'Swagger 문서 경로가 기본 운영 정책에서 닫혀 있다', async () => {
    const result = await callUpstream(`/${runtime.swaggerPath}`);
    return result.status === 404;
  });
  await check('HTTP-SEC-002', '허용되지 않은 Origin에 CORS 허용 헤더를 반환하지 않는다', async () => {
    const result = await callUpstream('/health/live', {
      headers: { origin: 'https://untrusted.invalid' },
    });
    return result.status === 200 && result.accessControlAllowOrigin === null;
  });
  await check('HTTP-SEC-003', '허용되지 않은 preflight에 CORS 허용 Origin을 반환하지 않는다', async () => {
    const result = await callUpstream('/health/live', {
      method: 'OPTIONS',
      headers: {
        origin: 'https://untrusted.invalid',
        'access-control-request-method': 'GET',
      },
    });
    return result.accessControlAllowOrigin === null;
  });
  await check('HTTP-SEC-004', 'allowlist Origin에만 credential CORS 헤더를 반환한다', async () => {
    const result = await callUpstream('/health/live', {
      headers: { origin: runtime.corsAllowedOrigin },
    });
    return result.status === 200 && result.accessControlAllowOrigin === runtime.corsAllowedOrigin && result.accessControlAllowCredentials === 'true';
  });
  const report = {
    type: 'http-exposure',
    ...(await reportContext('1.0.0')),
    startedAt,
    swaggerPath: runtime.swaggerPath,
    corsAllowedOrigin: runtime.corsAllowedOrigin,
    summary: { total: tests.length, passed: tests.filter((test) => test.passed).length, failed: tests.filter((test) => !test.passed).length },
    results: tests,
  };
  report.reportFile = await saveReport('http-exposure', report);
  return report;
}

async function runInternalExposureScenario() {
  const startedAt = new Date().toISOString();
  const storeA = demoProfiles.get('hj-ai-demo-store-a');
  if (!storeA) throw Object.assign(new Error('먼저 STORE_A 검증 환경을 준비해야 합니다.'), { statusCode: 409 });
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
  await check('INT-001', 'Legacy Bedrock 설정 조회는 appkey가 있어도 404다', async () => {
    const result = await callUpstream('/bedrock/config', { appkey: storeA.appkey });
    return result.status === 404;
  });
  await check('INT-002', 'Legacy Bedrock 모델 조회는 appkey가 있어도 404다', async () => {
    const result = await callUpstream('/bedrock/models', { appkey: storeA.appkey });
    return result.status === 404;
  });
  await check('INT-003', 'Legacy 텍스트 지식 쓰기는 validation 전에 404다', async () => {
    const result = await callUpstream('/knowledge/texts', { method: 'POST', appkey: storeA.appkey, body: {} });
    return result.status === 404;
  });
  await check('INT-004', 'Legacy 지식 업로드는 파일 처리 전에 404다', async () => {
    const result = await callUpstream('/knowledge/files', { method: 'POST', appkey: storeA.appkey, body: {} });
    return result.status === 404;
  });
  await check('INT-005', 'test-tables는 플랫폼 관리자에게도 운영에서 404다', async () => {
    const result = await callAdminUpstream('/test-tables');
    return result.status === 404;
  });
  await check('INT-006', '플랫폼 관리자는 Bedrock 운영 설정을 조회한다', async () => {
    const result = await callAdminUpstream('/admin/v1/bedrock/config');
    return result.status === 200;
  });
  await check('INT-007', '지식 운영자는 Bedrock 운영 설정에 접근할 수 없다', async () => {
    const result = await callUpstream('/admin/v1/bedrock/config', { adminKey: runtime.operatorKey });
    return result.status === 403;
  });
  await check('INT-008', '지식 운영자 API는 계속 사용할 수 있다', async () => {
    const result = await callOperatorUpstream(`/admin/v1/knowledge/apps/${storeA.id}/files`);
    return result.status === 200;
  });
  const report = {
    type: 'internal-exposure',
    ...(await reportContext('1.0.0')),
    startedAt,
    summary: { total: tests.length, passed: tests.filter((test) => test.passed).length, failed: tests.filter((test) => !test.passed).length },
    results: tests,
  };
  report.reportFile = await saveReport('internal-exposure', report);
  return report;
}

async function runCredentialLifecycleScenario() {
  assertLocalDemoMutation();
  const startedAt = new Date().toISOString();
  const storeB = demoProfiles.get('hj-ai-demo-store-b');
  if (!storeB) throw Object.assign(new Error('먼저 STORE_B 검증 환경을 준비해야 합니다.'), { statusCode: 409 });
  if (!runtime.adminKey) throw Object.assign(new Error('관리자 credential 설정이 필요합니다.'), { statusCode: 400 });
  const tests = [];
  const check = async (id, name, execute) => {
    try {
      const passed = await execute();
      tests.push({ id, name, passed: Boolean(passed), reasons: passed ? [] : ['기대 조건을 충족하지 않았습니다.'] });
    } catch (error) {
      tests.push({ id, name, passed: false, reasons: [error.message] });
    }
  };
  await check('LIFE-001', '현재 appkey에 미래 만료 시각이 있다', async () => {
    const result = await callAdminUpstream(`/app-info/${storeB.id}`);
    return result.status === 200 && Date.parse(result.body.appkeyExpiresAt) > Date.now();
  });
  const previousKey = storeB.appkey;
  await check('LIFE-002', 'grace period 중 이전 키와 새 키를 함께 허용한다', async () => {
    const rotated = requireUpstream(
      await callAdminUpstream(`/app-info/${storeB.id}/appkey`, {
        method: 'POST',
        body: { gracePeriodSeconds: 2, ttlDays: 90 },
      }),
      'grace appkey 회전',
    );
    storeB.appkey = rotated.appkey;
    const oldResult = await callUpstream('/knowledge/files', { appkey: previousKey });
    const newResult = await callUpstream('/knowledge/files', { appkey: storeB.appkey });
    return oldResult.status === 200 && newResult.status === 200 && Date.parse(rotated.previousAppkeyValidUntil) > Date.now();
  });
  await new Promise((resolve) => setTimeout(resolve, 2200));
  await check('LIFE-003', 'grace period 종료 후 이전 키를 즉시 거절한다', async () => {
    const oldResult = await callUpstream('/knowledge/files', { appkey: previousKey });
    const newResult = await callUpstream('/knowledge/files', { appkey: storeB.appkey });
    return oldResult.status === 401 && newResult.status === 200;
  });
  await check('LIFE-004', 'appkey 회전 감사 이벤트를 조회할 수 있다', async () => {
    const result = await callAdminUpstream('/admin/v1/security/audit-events', {
      query: { eventType: 'APPKEY_ROTATED', appId: storeB.id, limit: 10 },
    });
    return result.status === 200 && Array.isArray(result.body) && result.body.some((event) => event.eventType === 'APPKEY_ROTATED' && event.appId === storeB.id && event.metadata?.gracePeriodSeconds === 2);
  });
  const report = {
    type: 'credential-lifecycle',
    ...(await reportContext('1.0.0')),
    startedAt,
    summary: { total: tests.length, passed: tests.filter((test) => test.passed).length, failed: tests.filter((test) => !test.passed).length },
    results: tests,
  };
  report.reportFile = await saveReport('credential-lifecycle', report);
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
  const report = { type: 'cleanup', ...(await reportContext('2.0.0')), startedAt, cleaned };
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
      if (typeof input.swaggerPath === 'string' && input.swaggerPath.trim()) runtime.swaggerPath = input.swaggerPath.trim().replace(/^\/+|\/+$/g, '');
      if (typeof input.corsAllowedOrigin === 'string' && input.corsAllowedOrigin.trim()) runtime.corsAllowedOrigin = input.corsAllowedOrigin.trim().replace(/\/+$/, '');
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
    if (request.method === 'POST' && url.pathname === '/api/demo/http-exposure-validation') {
      return sendJson(response, 200, await runHttpExposureScenario());
    }
    if (request.method === 'POST' && url.pathname === '/api/demo/internal-exposure-validation') {
      const input = await readJson(request);
      if (input.confirmValidation !== true) throw Object.assign(new Error('운영 API 경계 검증은 confirmValidation=true가 필요합니다.'), { statusCode: 400 });
      return sendJson(response, 200, await runInternalExposureScenario());
    }
    if (request.method === 'POST' && url.pathname === '/api/demo/credential-lifecycle-validation') {
      const input = await readJson(request);
      if (input.confirmValidation !== true) throw Object.assign(new Error('credential 수명주기 검증은 confirmValidation=true가 필요합니다.'), { statusCode: 400 });
      return sendJson(response, 200, await runCredentialLifecycleScenario());
    }
    if (request.method === 'POST' && url.pathname === '/api/demo/parser-regression-validation') {
      const input = await readJson(request);
      if (input.confirmValidation !== true) throw Object.assign(new Error('parser 회귀 검증은 confirmValidation=true가 필요합니다.'), { statusCode: 400 });
      return sendJson(response, 200, await runParserRegressionScenario());
    }
    if (request.method === 'POST' && url.pathname === '/api/demo/knowledge-lifecycle-validation') {
      const input = await readJson(request);
      if (input.confirmValidation !== true) throw Object.assign(new Error('지식 생명주기 검증은 confirmValidation=true가 필요합니다.'), { statusCode: 400 });
      return sendJson(response, 200, await runKnowledgeLifecycleScenario());
    }
    if (request.method === 'POST' && url.pathname === '/api/demo/knowledge-policy-matrix-validation') {
      const input = await readJson(request);
      if (input.confirmValidation !== true) throw Object.assign(new Error('지식 정책 matrix 검증은 confirmValidation=true가 필요합니다.'), { statusCode: 400 });
      return sendJson(response, 200, await runKnowledgePolicyMatrixScenario());
    }
    if (request.method === 'POST' && url.pathname === '/api/demo/knowledge-index-job-validation') {
      const input = await readJson(request);
      if (input.confirmValidation !== true) throw Object.assign(new Error('비동기 인덱싱 작업 검증은 confirmValidation=true가 필요합니다.'), { statusCode: 400 });
      return sendJson(response, 200, await runKnowledgeIndexJobScenario());
    }
    if (request.method === 'POST' && url.pathname === '/api/demo/knowledge-file-rejection-validation') {
      const input = await readJson(request);
      if (input.confirmValidation !== true) throw Object.assign(new Error('지식 파일 거절 검증은 confirmValidation=true가 필요합니다.'), { statusCode: 400 });
      return sendJson(response, 200, await runKnowledgeFileRejectionScenario());
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
