import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const LOCAL_DATABASE_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function resolveContainerDatabaseUrl(
  value,
  dockerHost = 'host.docker.internal',
) {
  if (!value) throw new Error('DATABASE_URL is required');
  const databaseUrl = new URL(value);
  if (LOCAL_DATABASE_HOSTS.has(databaseUrl.hostname)) {
    databaseUrl.hostname = dockerHost;
  }
  return databaseUrl.toString();
}

export function resolveChildExitCode(code, signal, forwardedSignal) {
  if (code !== null) return code;
  return forwardedSignal && signal === forwardedSignal ? 0 : 1;
}

function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal, child }));
  });
}

async function main() {
  const env = {
    ...process.env,
    DATABASE_URL: resolveContainerDatabaseUrl(
      process.env.DATABASE_URL,
      process.env.DOCKER_DATABASE_HOST,
    ),
  };

  const migration = await run(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['prisma', 'migrate', 'deploy'],
    env,
  );
  if (migration.code !== 0) process.exit(migration.code ?? 1);

  const server = spawn('node', ['dist/src/main.js'], {
    env,
    stdio: 'inherit',
  });
  let forwardedSignal;
  const forward = (signal) => {
    forwardedSignal = signal;
    if (!server.killed) server.kill(signal);
  };
  process.once('SIGTERM', () => forward('SIGTERM'));
  process.once('SIGINT', () => forward('SIGINT'));
  server.once('error', (error) => {
    console.error(error);
    process.exit(1);
  });
  server.once('exit', (code, signal) =>
    process.exit(resolveChildExitCode(code, signal, forwardedSignal)),
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
