import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
function run(script, args, options = {}) {
  return new Promise((done, reject) => {
    const child = spawn(process.execPath, [resolve(root, script), ...args], { cwd: root, ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', data => stdout += data);
    child.stderr.on('data', data => stderr += data);
    child.once('error', reject);
    child.once('exit', code => done({ code, stdout, stderr }));
  });
}
async function cleanup(directory) {
  assert.ok(resolve(directory).startsWith(resolve(tmpdir(), 'hj-provenance-')));
  await rm(directory, { recursive: true, force: true });
}

test('live evaluator preserves run/case/request links even for non-200 responses', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hj-provenance-'));
  const dataset = JSON.parse(await readFile(resolve(root, 'demo/fixtures/rag-golden.json'), 'utf8'));
  const files = {};
  for (const [tenant, names] of Object.entries(dataset.sources)) {
    files[tenant] = await Promise.all(names.map(async originalName => ({ originalName,
      status: 'indexed', accessLevel: 'PUBLIC', businessStatus: 'PUBLISHED',
      checksum: createHash('sha256').update(await readFile(resolve(root, 'demo/fixtures', originalName))).digest('hex'),
    })));
  }
  const receivedIds = [];
  const server = createServer((req, res) => {
    req.resume();
    res.setHeader('content-type', 'application/json');
    if (req.url === '/knowledge/files') return res.end(JSON.stringify(files[req.headers.appkey]));
    if (req.url === '/knowledge/search') return res.end(JSON.stringify({ matches: [] }));
    receivedIds.push(req.headers['x-correlation-id']);
    res.statusCode = 503;
    res.end('{}');
  });
  try {
    await new Promise(done => server.listen(0, '127.0.0.1', done));
    const env = { ...process.env, RAG_EVAL_DATASET: 'golden', RAG_EVAL_CORPUS: 'original',
      RAG_EVAL_REPORT_DIRECTORY: directory, RAG_EVAL_BASE_URL: `http://127.0.0.1:${server.address().port}` };
    for (const tenant of Object.keys(files)) env[`RAG_EVAL_APPKEY_${tenant}`] = tenant;
    const result = await run('demo/scripts/rag-quality.mjs', ['--live'], { env });
    assert.equal(result.code, 1, result.stderr);
    const report = JSON.parse(result.stdout);
    const manifest = JSON.parse(await readFile(join(directory, 'run-manifest.json'), 'utf8'));
    const responses = JSON.parse(await readFile(join(directory, 'responses.json'), 'utf8'));
    assert.equal(manifest.evaluationRunId, report.evaluationRunId);
    assert.equal(receivedIds.length, 3); // Existing three-failure stop remains intact.
    assert.equal(new Set(receivedIds).size, 3);
    assert.deepEqual(manifest.requests.map(r => r.requestId), receivedIds);
    assert.deepEqual(responses.map(r => r.requestId), receivedIds);
    assert.deepEqual(report.responseExecutionReferences.map(r => r.requestId), receivedIds);
    assert.ok(responses.every(r => r.status === 503 && r.evaluationRunId === manifest.evaluationRunId));
    assert.match(manifest.datasetSha256, /^[a-f0-9]{64}$/);
    assert.equal(report.gatePassed, false);
  } finally {
    await new Promise(done => server.close(done));
    await cleanup(directory);
  }
});

test('Git-free build fingerprints source changes and excludes environment secrets', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hj-provenance-'));
  try {
    for (const sub of ['src', 'prisma', 'scripts', 'dist']) await mkdir(join(directory, sub));
    for (const name of ['package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json', 'nest-cli.json']) await writeFile(join(directory, name), '{}');
    await writeFile(join(directory, 'src/main.ts'), 'first version');
    await writeFile(join(directory, 'prisma/schema.prisma'), 'schema');
    await writeFile(join(directory, 'scripts/stamp-build.mjs'), await readFile(resolve(root, 'scripts/stamp-build.mjs')));
    const stamp = async () => {
      const result = await run('scripts/stamp-build.mjs', [], { cwd: directory,
        env: { ...process.env, PATH: '', Path: '' } });
      assert.equal(result.code, 0, result.stderr);
      return JSON.parse(await readFile(join(directory, 'dist/build-info.json'), 'utf8'));
    };
    const first = await stamp();
    assert.equal(first.revision, null);
    assert.equal(first.workingTreeDirty, null);
    await writeFile(join(directory, '.env'), 'SECRET=not-for-artifacts');
    assert.deepEqual(await stamp(), first);
    await writeFile(join(directory, 'src/main.ts'), 'second version');
    assert.notEqual((await stamp()).sourceSha256, first.sourceSha256);
  } finally { await cleanup(directory); }
});
