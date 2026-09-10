import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve } from 'node:path';

if (process.env.RUN_PERFORMANCE_BASELINE !== 'true' || !process.env.RAG_EVAL_BASE_URL || !process.env.RAG_EVAL_APPKEY_STORE_A) throw new Error('Isolated live baseline runner configuration required.');
const target = new URL(process.env.RAG_EVAL_BASE_URL);
if (!['127.0.0.1', 'localhost'].includes(target.hostname)) throw new Error('Local isolated server required.');
const probe = createServer();
await new Promise((resolveReady, reject) => { probe.once('error', reject); probe.listen(11001, '127.0.0.1', resolveReady); });
await new Promise((done) => probe.close(done));
const child = spawn(process.execPath, [resolve('demo/server.mjs')], {
  windowsHide: true, stdio: ['ignore', 'pipe', 'inherit'],
  env: { ...process.env, DEMO_PORT: '11001', DEMO_HOST: '127.0.0.1', AI_SERVER_BASE_URL: target.toString(), AI_SERVER_APPKEY: process.env.RAG_EVAL_APPKEY_STORE_A, AI_SERVER_ADMIN_API_KEY: '', AI_SERVER_KNOWLEDGE_OPERATOR_API_KEY: '', ADMIN_API_KEY: '', KNOWLEDGE_OPERATOR_API_KEY: '' },
});
const exited = new Promise((done) => child.once('exit', done));
try {
  await new Promise((ready, reject) => {
    const deadline = setTimeout(() => reject(new Error('Demo startup timed out')), 10000);
    child.stdout.on('data', (chunk) => { if (chunk.toString().includes('Demo Console:')) { clearTimeout(deadline); ready(); } });
    child.once('error', (error) => { clearTimeout(deadline); reject(error); });
    child.once('exit', () => { clearTimeout(deadline); reject(new Error('Demo startup failed')); });
  });
  const response = await fetch('http://127.0.0.1:11001/api/performance/run', {
    method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(180000),
    body: JSON.stringify({ preset: 'smoke', operationId: 'knowledge.answers', body: { query: 'STORE_A에서 상품을 교환하거나 환불하려면 어떤 조건을 충족해야 하나요?', strict: true, includeSources: true, maxTokens: 256, temperature: 0 } }),
  });
  if (!response.ok) throw new Error(`Demo baseline failed: HTTP ${response.status}`);
  const report = await response.json();
  report.baselineContext = { liveAws: true, region: process.env.AWS_REGION, modelId: process.env.BEDROCK_MODEL_ID, embeddingModelId: process.env.BEDROCK_EMBEDDING_MODEL_ID, corpus: 'quality-v2/store-a-policy.md', warmupRequests: 0 };
  process.stdout.write(JSON.stringify(report, null, 2));
} finally { child.kill(); await exited; }
