import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const baseUrl = (process.env.AI_SERVER_BASE_URL ?? 'http://127.0.0.1:11000').replace(/\/$/, '');
const adminKey = process.env.ADMIN_API_KEY?.trim();
const operatorKey = process.env.KNOWLEDGE_OPERATOR_API_KEY?.trim();
const appcodes = {
  STORE_A: 'hj-ai-demo-store-a',
  STORE_B: 'hj-ai-demo-store-b',
};

if (!adminKey || !operatorKey) {
  throw new Error('루트 .env의 ADMIN_API_KEY와 KNOWLEDGE_OPERATOR_API_KEY가 필요합니다.');
}

async function callAdmin(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      'x-admin-key': adminKey,
      ...options.headers,
    },
    signal: AbortSignal.timeout(10_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`AI Server 관리 API 호출 실패: ${response.status} ${path}`);
  }
  return body;
}

const apps = await callAdmin('/app-info');
if (!Array.isArray(apps)) {
  throw new Error('AI Server의 앱 목록 응답 형식이 올바르지 않습니다.');
}

const keys = {};
const appIds = {};
for (const [tenantId, appcode] of Object.entries(appcodes)) {
  const app = apps.find((item) => item?.appcode === appcode);
  if (!app?.id) {
    throw new Error(`${tenantId} 데모 앱이 없습니다. 먼저 검증 데모에서 환경 구성을 실행하세요.`);
  }
  const rotated = await callAdmin(`/app-info/${app.id}/appkey`, { method: 'POST' });
  if (typeof rotated?.appkey !== 'string' || !rotated.appkey) {
    throw new Error(`${tenantId} appkey 발급 결과가 올바르지 않습니다.`);
  }
  keys[tenantId] = rotated.appkey;
  appIds[tenantId] = app.id;
}

const prefix = process.env.API_GLOBAL_PREFIX?.trim() ?? '';
const devVarsPath = fileURLToPath(new URL('../.dev.vars', import.meta.url));
const devVars = [
  `AI_SERVER_BASE_URL=${JSON.stringify(baseUrl)}`,
  `AI_SERVER_API_PREFIX=${JSON.stringify(prefix)}`,
  `AI_SERVER_APPKEY_STORE_A=${JSON.stringify(keys.STORE_A)}`,
  `AI_SERVER_APPKEY_STORE_B=${JSON.stringify(keys.STORE_B)}`,
  `AI_SERVER_APP_ID_STORE_A=${JSON.stringify(appIds.STORE_A)}`,
  `AI_SERVER_APP_ID_STORE_B=${JSON.stringify(appIds.STORE_B)}`,
  `AI_SERVER_KNOWLEDGE_OPERATOR_KEY=${JSON.stringify(operatorKey)}`,
  `SERVICE_DEMO_MANAGER_EMAILS=${JSON.stringify(process.env.SERVICE_DEMO_MANAGER_EMAILS?.trim() || 'seedy@sites.test')}`,
  `SERVICE_DEMO_LOCAL_MANAGER_TOKEN=${JSON.stringify(randomBytes(32).toString('base64url'))}`,
  `SERVICE_DEMO_AGENT_EMAILS=${JSON.stringify(process.env.SERVICE_DEMO_AGENT_EMAILS?.trim() || 'seedy@sites.test')}`,
  `SERVICE_DEMO_LOCAL_AGENT_TOKEN=${JSON.stringify(randomBytes(32).toString('base64url'))}`,
  '',
].join('\n');

await writeFile(devVarsPath, devVars, { encoding: 'utf8', mode: 0o600 });
console.log('STORE_A/STORE_B 연결 정보를 준비했습니다. 서비스 데모를 시작합니다.');

const isWindows = process.platform === 'win32';
const command = isWindows ? (process.env.ComSpec ?? 'cmd.exe') : 'npm';
const args = isWindows ? ['/d', '/s', '/c', 'npm run dev'] : ['run', 'dev'];
const child = spawn(command, args, {
  env: process.env,
  stdio: 'inherit',
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
