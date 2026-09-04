import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import assert from 'node:assert/strict';

const url = new URL(process.env.DATABASE_URL ?? '');
assert.equal(process.env.RUN_QUEUE_HTTP_E2E, 'true');
assert.match(url.pathname, /^\/queue_e2e_[a-f0-9]{32}$/);
const name = `hj-shutdown-test-${randomUUID()}`;
const database = new Client({ connectionString: url.toString() });
const dockerUrl = new URL(url);
dockerUrl.hostname = 'host.docker.internal';
const env = {
  ...process.env,
  DATABASE_URL: dockerUrl.toString(),
  RUN_QUEUE_HTTP_E2E: 'true',
  APPKEY_JWT_SECRET: randomUUID(),
  ADMIN_API_KEY: randomUUID(),
  KNOWLEDGE_OPERATOR_API_KEY: randomUUID(),
  AWS_REGION: 'us-west-2',
  AWS_S3_REGION: 'us-west-2',
  AWS_S3_BUCKET: 'unused',
  BEDROCK_MODEL_ID: 'unused',
  BEDROCK_EMBEDDING_MODEL_ID: 'unused',
  KNOWLEDGE_INDEX_WORKER_ENABLED: 'true',
};
function docker(args) {
  const result = spawnSync('docker', args, {
    env,
    encoding: 'utf8',
    timeout: 30000,
  });
  if (result.error || result.status !== 0)
    throw new Error(`Docker operation failed: ${args[0]}`);
  return result.stdout.trim();
}
let created = false;
try {
  await database.connect();
  const image =
    process.env.DOCKER_SHUTDOWN_TEST_IMAGE ||
    docker(['inspect', '--format', '{{.Image}}', 'hj_ai_server-app-1']);
  const mount = (relative, target) => [
    '--mount',
    `type=bind,source=${fileURLToPath(new URL(relative, import.meta.url))},target=${target},readonly`,
  ];
  const keys = [
    'DATABASE_URL',
    'RUN_QUEUE_HTTP_E2E',
    'APPKEY_JWT_SECRET',
    'ADMIN_API_KEY',
    'KNOWLEDGE_OPERATOR_API_KEY',
    'AWS_REGION',
    'AWS_S3_REGION',
    'AWS_S3_BUCKET',
    'BEDROCK_MODEL_ID',
    'BEDROCK_EMBEDDING_MODEL_ID',
    'KNOWLEDGE_INDEX_WORKER_ENABLED',
  ];
  docker([
    'run',
    '--detach',
    '--name',
    name,
    ...keys.flatMap((key) => ['--env', key]),
    ...mount('../dist', '/app/dist'),
    ...mount('./fixtures/container-shutdown-main.cjs', '/app/dist/src/main.js'),
    ...mount(
      '../config/start-container.mjs',
      '/app/config/start-container.mjs',
    ),
    image,
    'node',
    'config/start-container.mjs',
  ]);
  created = true;
  const deadline = Date.now() + 60000;
  let ready = false;
  while (Date.now() < deadline) {
    const logs = docker(['logs', name]);
    if (
      logs.includes('DOCKER_SHUTDOWN_JOB_STARTED') &&
      logs.includes('DOCKER_SHUTDOWN_HTTP_READY')
    ) {
      ready = true;
      break;
    }
    if (docker(['inspect', '--format', '{{.State.Running}}', name]) !== 'true')
      break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.equal(
    ready,
    true,
    'Container did not reach active job and HTTP ready state',
  );
  docker(['stop', '--time', '20', name]);
  assert.equal(
    docker(['inspect', '--format', '{{.State.ExitCode}}', name]),
    '0',
  );
  const result = await database.query(
    'SELECT status, attempt, error_code, lease_expires_at FROM knowledge_index_job WHERE appcode = $1 ORDER BY requested_at',
    ['DOCKER_SHUTDOWN'],
  );
  assert.equal(result.rows.length, 2);
  assert.deepEqual(result.rows[0], {
    status: 'queued',
    attempt: 1,
    error_code: 'UPSTREAM_TIMEOUT',
    lease_expires_at: null,
  });
  assert.deepEqual(result.rows[1], {
    status: 'queued',
    attempt: 0,
    error_code: null,
    lease_expires_at: null,
  });
  console.log(
    'PASS: Docker SIGTERM forwarded, active job persisted, next job untouched, exit code 0.',
  );
} finally {
  if (created) {
    docker(['rm', '--force', name]);
    console.log(`Removed test container: ${name}`);
  }
  await database.end();
}
