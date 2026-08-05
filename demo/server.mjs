import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { collectTotalTokens, evaluateExpectation, normalizeBaseUrl, percentile, renderPath } from './lib.mjs';
import { findOperation, operations } from './catalog.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const publicRoot = join(root, 'public');
const scenarioPath = join(root, 'scenarios', 'core.json');
const reportRoot = join(root, 'reports');
const port = Number(process.env.DEMO_PORT ?? 3200);
const host = process.env.DEMO_HOST ?? '127.0.0.1';
const maxBodyBytes = 40 * 1024 * 1024;

const runtime = {
  baseUrl: normalizeBaseUrl(process.env.AI_SERVER_BASE_URL ?? 'http://127.0.0.1:3000'),
  appkey: process.env.AI_SERVER_APPKEY ?? '',
  timeoutMs: Number(process.env.AI_SERVER_TIMEOUT_MS ?? 30000),
  updatedAt: new Date().toISOString(),
};

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
  const sendAppkey = options.sendAppkey ?? operation.auth !== false;
  if (sendAppkey && runtime.appkey) headers.appkey = runtime.appkey;
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
    const operation = findOperation(scenarioTest.operationId);
    const result = await invoke(operation, {
      body: scenarioTest.body,
      correlationId: scenarioTest.correlationId,
      sendAppkey: scenarioTest.sendAppkey,
    });
    const evaluation = evaluateExpectation(result, scenarioTest.expect);
    results.push({ id: scenarioTest.id, name: scenarioTest.name, ...evaluation, result });
  }
  const report = {
    type: 'contract',
    scenario: scenario.name,
    baseUrl: runtime.baseUrl,
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
    baseUrl: runtime.baseUrl,
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
      return sendJson(response, 200, { baseUrl: runtime.baseUrl, hasAppkey: Boolean(runtime.appkey), timeoutMs: runtime.timeoutMs, updatedAt: runtime.updatedAt });
    }
    if (request.method === 'PUT' && url.pathname === '/api/config') {
      const input = await readJson(request);
      if (input.baseUrl) runtime.baseUrl = normalizeBaseUrl(input.baseUrl);
      if (typeof input.appkey === 'string' && input.appkey.trim()) runtime.appkey = input.appkey.trim();
      if (input.clearAppkey === true) runtime.appkey = '';
      if (input.timeoutMs !== undefined) runtime.timeoutMs = Math.min(120000, Math.max(1000, Number(input.timeoutMs)));
      runtime.updatedAt = new Date().toISOString();
      return sendJson(response, 200, { baseUrl: runtime.baseUrl, hasAppkey: Boolean(runtime.appkey), timeoutMs: runtime.timeoutMs, updatedAt: runtime.updatedAt });
    }
    if (request.method === 'GET' && url.pathname === '/api/catalog') return sendJson(response, 200, operations);
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
      if (!runtime.appkey) throw Object.assign(new Error('appkey 설정이 필요합니다.'), { statusCode: 400 });
      const body = await readBuffer(request);
      const upstream = await fetch(buildUrl(operation.path), {
        method: 'POST',
        headers: { 'content-type': request.headers['content-type'], appkey: runtime.appkey, 'x-correlation-id': randomUUID() },
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
