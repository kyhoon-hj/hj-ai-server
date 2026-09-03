import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for the knowledge fault E2E test.');
}

const parsed = new URL(databaseUrl);
if (!['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)) {
  throw new Error(
    `Fault E2E is restricted to a local PostgreSQL host, received ${parsed.hostname}.`,
  );
}

const jestPath = fileURLToPath(
  new URL('../node_modules/jest/bin/jest.js', import.meta.url),
);
const result = spawnSync(
  process.execPath,
  [
    jestPath,
    '--config',
    './test/jest-e2e.json',
    '--runInBand',
    'knowledge-index-job.fault-e2e-spec.ts',
  ],
  {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: {
      ...process.env,
      RUN_KNOWLEDGE_FAULT_E2E: 'true',
    },
    stdio: 'inherit',
  },
);

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
