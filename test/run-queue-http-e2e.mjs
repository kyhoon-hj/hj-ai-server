import 'dotenv/config';
import { Client } from 'pg';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const source = new URL(process.env.DATABASE_URL ?? '');
const liveAws = process.argv.includes('--live-aws');
const liveNetwork = process.argv.includes('--live-network');
const compiledSoak = process.argv.includes('--multiprocess-soak-compiled');
const multiprocessSoak = compiledSoak || process.argv.includes('--multiprocess-soak');
const extendedLoad = process.argv.includes('--network-load-extended');
const networkLoad = extendedLoad || process.argv.includes('--network-load');
const extendedRag = process.argv.includes('--rag-quality-extended');
const adversarialRag = process.argv.includes('--rag-quality-adversarial');
const repeatRag = process.argv.includes('--rag-quality-repeatability');
const performanceBaseline = process.argv.includes('--performance-baseline');
const ragQuality = performanceBaseline || repeatRag || adversarialRag || extendedRag || process.argv.includes('--rag-quality') || process.argv.includes('--rag-quality-v2');
if (!['localhost', '127.0.0.1', '[::1]'].includes(source.hostname)) {
  throw new Error('Queue HTTP E2E requires a local PostgreSQL host.');
}
const database = `queue_e2e_${randomUUID().replaceAll('-', '')}`;
const target = new URL(source);
target.pathname = `/${database}`;
target.search = '';
const admin = new Client({ connectionString: source.toString() });
let created = false;
const cwd = fileURLToPath(new URL('..', import.meta.url));
function run(relativePath, args) {
  const result = spawnSync(
    process.execPath,
    [...(relativePath.endsWith('.ts') ? ['-r', 'ts-node/register'] : []), fileURLToPath(new URL(relativePath, import.meta.url)), ...args],
    {
      cwd,
      env: {
        ...process.env,
        DATABASE_URL: target.toString(),
        RUN_QUEUE_HTTP_E2E: 'true',
        RUN_KNOWLEDGE_FAULT_E2E: 'true',
        KNOWLEDGE_INDEX_WORKER_ENABLED: 'true',
        KNOWLEDGE_INDEX_RETRY_DELAY_MS: '100',
        ADMIN_API_KEY: randomUUID(),
        RUN_AWS_LIFECYCLE_E2E: liveAws ? 'true' : 'false',
        RUN_AWS_NETWORK_E2E: liveNetwork ? 'true' : 'false',
        RUN_NETWORK_LOAD_E2E: networkLoad ? 'true' : 'false',
        RUN_EXTENDED_LOAD_E2E: extendedLoad ? 'true' : 'false',
        RUN_MULTIPROCESS_SOAK: multiprocessSoak ? 'true' : 'false',
        RUN_RAG_QUALITY_E2E: ragQuality ? 'true' : 'false',
        RUN_PERFORMANCE_BASELINE: performanceBaseline ? 'true' : 'false',
        RAG_EVAL_CORPUS: performanceBaseline || repeatRag || adversarialRag || extendedRag || process.argv.includes('--rag-quality-v2') ? 'quality-v2' : 'original',
        RAG_EVAL_DATASET: repeatRag ? 'repeatability' : adversarialRag ? 'adversarial' : extendedRag ? 'extended' : 'golden',
      },
      stdio: 'inherit',
      timeout: ragQuality ? 660000 : multiprocessSoak ? 480000 : liveAws || liveNetwork || extendedLoad ? 300000 : 120000,
    },
  );
  if (result.error || result.status !== 0)
    throw new Error(`Isolated queue test subprocess failed: status=${result.status}, signal=${result.signal}, error=${result.error?.message ?? 'none'}`);
}
try {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${database}"`);
  created = true;
  // PostgreSQL 18 may configure a separately installed pgvector per database.
  for (const setting of ['extension_control_path', 'dynamic_library_path']) {
    const result = await admin.query(
      'SELECT setting FROM pg_settings WHERE name = $1',
      [setting],
    );
    if (result.rows.length) {
      const value = result.rows[0].setting.replaceAll("'", "''");
      await admin.query(
        `ALTER DATABASE "${database}" SET ${setting} TO '${value}'`,
      );
    }
  }
  console.log(`Created isolated database: ${database}`);
  run('../node_modules/prisma/build/index.js', ['migrate', 'deploy']);
  if (multiprocessSoak) {
    run(compiledSoak ? '../work/soak-build/test/multiprocess-soak.js' : './multiprocess-soak.ts', []);
  } else if (ragQuality) {
    run('../node_modules/jest/bin/jest.js', [
      '--config',
      './test/jest-e2e.json',
      '--runInBand',
      'rag-quality-live.e2e-spec.ts',
    ]);
  } else if (liveNetwork) {
    run('./aws-network-live.ts', []);
  } else if (networkLoad) {
    run('../node_modules/jest/bin/jest.js', ['--config', './test/jest-e2e.json', '--runInBand', 'knowledge-network.e2e-spec.ts', '--testNamePattern', 'bounded load']);
  } else if (process.argv.includes('--network')) {
    run('../node_modules/jest/bin/jest.js', ['--config', './test/jest-e2e.json', '--runInBand', 'knowledge-network.e2e-spec.ts']);
  } else if (liveAws) {
    run('../node_modules/jest/bin/jest.js', [
      '--config',
      './test/jest-e2e.json',
      '--runInBand',
      'knowledge-aws-live.e2e-spec.ts',
    ]);
  } else if (process.argv.includes('--docker')) {
    run('./run-docker-shutdown.mjs', []);
  } else
    run('../node_modules/jest/bin/jest.js', [
      '--config',
      './test/jest-e2e.json',
      '--runInBand',
      'knowledge-(queue-http|vector|worker-restart|app-shutdown|lease|network).e2e-spec.ts',
      'knowledge-index-job.fault-e2e-spec.ts',
    ]);
} finally {
  // Drop only the exact random database created by this invocation, never the source DB.
  if (
    created &&
    /^queue_e2e_[a-f0-9]{32}$/.test(database) &&
    source.pathname !== `/${database}`
  ) {
    await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);
    console.log(`Removed isolated test database: ${database}`);
  }
  await admin.end();
}
