import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

const source = new URL(process.env.DATABASE_URL ?? '');
if (!['localhost', '127.0.0.1', '[::1]'].includes(source.hostname)) {
  throw new Error('Console browser fixture requires a local PostgreSQL host.');
}

const database = `console_browser_${randomUUID().replaceAll('-', '')}`;
const target = new URL(source);
target.pathname = `/${database}`;
target.search = '';
const root = fileURLToPath(new URL('..', import.meta.url));
const admin = new Client({ connectionString: source.toString() });
const children = [];
let created = false;
let cleaning = false;
let releaseFixture;
const fixtureStopped = new Promise((resolve) => {
  releaseFixture = resolve;
});

function run(relativePath, args, env = {}) {
  const child = spawn(process.execPath, [relativePath, ...args], {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: 'inherit',
  });
  children.push(child);
  child.once('exit', (code, signal) => {
    if (!cleaning) {
      process.stderr.write(
        `Console browser fixture child exited unexpectedly: ${relativePath} code=${code} signal=${signal}\n`,
      );
      void cleanup(1);
    }
  });
  return child;
}

function migrate() {
  const result = spawnSync(
    process.execPath,
    ['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
    {
      cwd: root,
      env: { ...process.env, DATABASE_URL: target.toString() },
      stdio: 'inherit',
      timeout: 120_000,
    },
  );
  if (result.error || result.status !== 0) {
    throw new Error(
      `Console browser fixture migration failed: status=${result.status}, error=${result.error?.message ?? 'none'}`,
    );
  }
}

async function waitFor(url, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { redirect: 'manual' });
      if (response.status >= 200 && response.status < 500) return;
      lastError = new Error(`${label} returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `${label} did not become ready: ${lastError?.message ?? 'unknown error'}`,
  );
}

async function cleanup(exitCode) {
  if (cleaning) return;
  cleaning = true;
  for (const child of children) {
    if (child.exitCode === null) child.kill('SIGTERM');
  }
  await Promise.all(
    children.map(
      (child) =>
        new Promise((resolve) => {
          if (child.exitCode !== null) resolve();
          else child.once('exit', resolve);
        }),
    ),
  );
  if (
    created &&
    /^console_browser_[a-f0-9]{32}$/.test(database) &&
    source.pathname !== `/${database}`
  ) {
    await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);
    process.stdout.write(`Removed isolated database: ${database}\n`);
  }
  await admin.end();
  process.exitCode = exitCode;
  releaseFixture();
}

process.once('SIGINT', () => void cleanup(0));
process.once('SIGTERM', () => void cleanup(0));

try {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${database}"`);
  created = true;
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
  process.stdout.write(`Created isolated database: ${database}\n`);
  migrate();

  run('dist/src/main.js', [], {
    DATABASE_URL: target.toString(),
    NODE_ENV: 'development',
    ENABLE_CONSOLE_DEV_IDENTITY: 'true',
    KNOWLEDGE_INDEX_WORKER_ENABLED: 'false',
    PORT: '11000',
  });
  run('console-web/server.mjs', [], {
    AI_SERVER_ORIGIN: 'http://127.0.0.1:11000',
    CONSOLE_WEB_PORT: '11003',
  });

  await waitFor('http://127.0.0.1:11000/health/live', 'AI Server');
  await waitFor('http://127.0.0.1:11003/console/apps', 'Console Web');
  process.stdout.write(
    `CONSOLE_BROWSER_FIXTURE_READY http://127.0.0.1:11003/console/apps database=${database}\n`,
  );
  await fixtureStopped;
} catch (error) {
  process.stderr.write(`${error?.stack ?? error}\n`);
  await cleanup(1);
}
