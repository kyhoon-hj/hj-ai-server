import 'dotenv/config';
import { Client } from 'pg';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const source = new URL(process.env.DATABASE_URL ?? '');
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
    [fileURLToPath(new URL(relativePath, import.meta.url)), ...args],
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
      },
      stdio: 'inherit',
      timeout: 120000,
    },
  );
  if (result.error || result.status !== 0)
    throw new Error('Isolated queue test subprocess failed.');
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
  if (process.argv.includes('--docker')) {
    run('./run-docker-shutdown.mjs', []);
  } else
    run('../node_modules/jest/bin/jest.js', [
      '--config',
      './test/jest-e2e.json',
      '--runInBand',
      'knowledge-(queue-http|vector|worker-restart|app-shutdown|lease).e2e-spec.ts',
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
