// Local-only Jev comparison harness. Secrets stay in server env / ignored .dev.vars.
import { config } from 'dotenv';
import { Client } from 'pg';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir, copyFile, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';

const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
config({ path: join(root, '.env'), quiet: true });
const databaseName = 'hj_ai_jev_demo';
const originalDatabase = new URL(process.env.DATABASE_URL ?? '');
if (!['localhost', '127.0.0.1', '[::1]'].includes(originalDatabase.hostname)) {
  throw new Error('JEV_DEMO_REQUIRES_LOCAL_DATABASE');
}
const database = new URL(originalDatabase);
database.pathname = '/' + databaseName;
database.search = '';
const base = 'http://127.0.0.1:11000';
const demo = 'http://127.0.0.1:11002';
const apps = { STORE_A: 'hj-ai-demo-store-a', STORE_B: 'hj-ai-demo-store-b' };
const directory = join(root, 'outputs/jev-local-demo/2026-10-22');
const devVars = join(root, 'service-demo/.dev.vars');
const [command, mode] = process.argv.slice(2);

async function connect(url = database.toString()) {
  const client = new Client({
    connectionString: url,
    connectionTimeoutMillis: 3000,
  });
  await client.connect();
  return client;
}

async function call(
  path,
  { body, admin = false, method = body ? 'POST' : 'GET' } = {},
) {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(admin ? { 'x-admin-key': process.env.ADMIN_API_KEY } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'error',
    signal: AbortSignal.timeout(30000),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`JEV_DEMO_HTTP_${response.status}`);
  return result;
}

async function prepare() {
  if (originalDatabase.pathname === '/' + databaseName)
    throw new Error('JEV_DEMO_DATABASE_MUST_BE_SEPARATE');
  const source = await connect(originalDatabase.toString());
  let libraryPath;
  try {
    libraryPath = (
      await source.query(
        "SELECT current_setting('dynamic_library_path') AS path",
      )
    ).rows[0].path;
  } finally {
    await source.end();
  }
  const adminUrl = new URL(originalDatabase);
  adminUrl.pathname = '/postgres';
  adminUrl.search = '';
  const admin = await connect(adminUrl.toString());
  try {
    const existing = await admin.query(
      'SELECT 1 FROM pg_database WHERE datname=$1',
      [databaseName],
    );
    if (!existing.rowCount) {
      // Preserve the working local pgvector installation without changing the source DB.
      const template = decodeURIComponent(
        originalDatabase.pathname.slice(1),
      ).replaceAll('"', '""');
      await admin.query(
        `CREATE DATABASE "hj_ai_jev_demo" TEMPLATE "${template}"`,
      );
    }
    // CREATE DATABASE ... TEMPLATE does not copy database-specific GUC settings.
    const setting = await admin.query(
      "SELECT format('ALTER DATABASE %I SET dynamic_library_path = %L', $1::text, $2::text) AS sql",
      [databaseName, libraryPath],
    );
    await admin.query(setting.rows[0].sql);
  } finally {
    await admin.end();
  }
  const result = spawnSync(
    process.execPath,
    [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'],
    {
      cwd: root,
      env: { ...process.env, DATABASE_URL: database.toString() },
      encoding: 'utf8',
      windowsHide: true,
    },
  );
  if (result.status !== 0) throw new Error('JEV_DEMO_MIGRATION_FAILED');
  console.log(
    JSON.stringify({
      database: databaseName,
      migrations: 'applied',
      existingDatabaseUnchanged: true,
    }),
  );
}

async function server() {
  if (!['off', 'shadow', 'classify'].includes(mode))
    throw new Error('JEV_DEMO_MODE_REQUIRED');
  Object.assign(process.env, {
    DATABASE_URL: database.toString(),
    NODE_ENV: 'development',
    JEV_AI_RAG_MODE: mode,
    JEV_AI_RAG_APPCODES: Object.values(apps).join(','),
    KNOWLEDGE_INDEX_WORKER_ENABLED: 'false',
    CONSOLE_WORKS_SSO_ENABLED: 'false',
    ENABLE_CONSOLE_DEV_IDENTITY: 'false',
    FRAME_FAMILY_RAG_ENABLED: 'false',
  });
  const { NestFactory } = require('@nestjs/core');
  const { ValidationPipe } = require('@nestjs/common');
  const { AppModule } = require('../dist/src/app.module.js');
  const app = await NestFactory.create(AppModule, { logger: false });
  const {
    StructuredHttpExceptionFilter,
  } = require('../dist/src/common/http/structured-http-exception.filter.js');
  app.useGlobalFilters(new StructuredHttpExceptionFilter());
  app.enableShutdownHooks();
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  await app.listen(11000, '127.0.0.1');
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, 'server-state.json'),
    JSON.stringify({
      pid: process.pid,
      database: databaseName,
      mode,
      appcodes: Object.values(apps),
    }),
  );
  console.log(
    JSON.stringify({
      api: base,
      database: databaseName,
      mode,
      appcodes: Object.values(apps),
      pid: process.pid,
    }),
  );
}

async function checkServer(expectedMode) {
  const state = JSON.parse(
    await readFile(join(directory, 'server-state.json'), 'utf8'),
  );
  if (state.database !== databaseName || state.mode !== expectedMode)
    throw new Error('JEV_DEMO_SERVER_MODE_MISMATCH');
  process.kill(state.pid, 0);
  await call('/health/ready');
}

async function seed() {
  await checkServer('off');
  if (!process.env.ADMIN_API_KEY || !process.env.KNOWLEDGE_OPERATOR_API_KEY)
    throw new Error('JEV_DEMO_SERVER_KEYS_REQUIRED');
  const existing = await call('/app-info', { admin: true });
  const credentials = {};
  const identities = {};
  for (const [tenant, appcode] of Object.entries(apps)) {
    const prior = existing.find((item) => item.appcode === appcode);
    if (prior && prior.metadata?.purpose !== 'jev-local-comparison')
      throw new Error('JEV_DEMO_REFUSE_UNOWNED_APP');
    const app = prior
      ? await call(`/app-info/${prior.id}/appkey`, { admin: true, body: {} })
      : await call('/app-info', {
          admin: true,
          body: {
            appcode,
            appname: `Jev local ${tenant}`,
            allowedAccessLevels: ['PUBLIC'],
            defaultModelId: process.env.BEDROCK_MODEL_ID,
            defaultEmbeddingModelId: process.env.BEDROCK_EMBEDDING_MODEL_ID,
            metadata: {
              purpose: 'jev-local-comparison',
              fixture: 'repository-demo',
            },
          },
        });
    credentials[tenant] = app.appkey;
    identities[tenant] = app.id;
    const fixtureNames =
      tenant === 'STORE_A'
        ? ['store-a-policy.md', 'store-a-products.csv']
        : ['store-b-policy.md'];
    const files = await call(`/admin/v1/knowledge/apps/${app.id}/files`, {
      admin: true,
    });
    for (const name of fixtureNames) {
      const originalName = name.endsWith('.csv')
        ? 'store-a-products-local.md'
        : name;
      if (
        files.some(
          (file) =>
            file.originalName === originalName && file.status === 'indexed',
        )
      ) {
        console.log(
          JSON.stringify({ tenant, fixture: name, indexed: 'reused' }),
        );
        continue;
      }
      let content = await readFile(join(root, 'demo/fixtures', name), 'utf8');
      if (name.endsWith('.csv')) {
        content =
          '# STORE_A 등록 상품 자료\n\n' +
          content
            .trim()
            .split(/\r?\n/)
            .slice(1)
            .map((row) => {
              const [code, title, location, stock, price] = row.split(',');
              return `## ${title}\n상품코드: ${code}\n위치: ${location}\n등록 재고: ${stock}개\n등록 가격: ${price}원\n`;
            })
            .join('\n');
      }
      const indexed = await call(`/admin/v1/knowledge/apps/${app.id}/texts`, {
        admin: true,
        body: {
          originalName,
          content,
          accessLevel: 'PUBLIC',
          businessStatus: 'PUBLISHED',
          metadata: {
            source: 'repository-demo-fixture',
            originalFixture: name,
          },
        },
      });
      console.log(
        JSON.stringify({ tenant, fixture: name, indexed: Boolean(indexed) }),
      );
    }
  }
  try {
    await access(devVars);
    await copyFile(devVars, devVars + '.before-jev-20261022');
  } catch {
    /* No prior local credentials. */
  }
  const values = {
    AI_SERVER_BASE_URL: base,
    AI_SERVER_API_PREFIX: '',
    AI_SERVER_APPKEY_STORE_A: credentials.STORE_A,
    AI_SERVER_APPKEY_STORE_B: credentials.STORE_B,
    AI_SERVER_APP_ID_STORE_A: identities.STORE_A,
    AI_SERVER_APP_ID_STORE_B: identities.STORE_B,
    AI_SERVER_KNOWLEDGE_OPERATOR_KEY: process.env.KNOWLEDGE_OPERATOR_API_KEY,
    SERVICE_DEMO_MANAGER_EMAILS: 'seedy@sites.test',
    SERVICE_DEMO_AGENT_EMAILS: 'seedy@sites.test',
    SERVICE_DEMO_LOCAL_MANAGER_TOKEN: randomBytes(32).toString('base64url'),
    SERVICE_DEMO_LOCAL_AGENT_TOKEN: randomBytes(32).toString('base64url'),
  };
  await writeFile(
    devVars,
    Object.entries(values)
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join('\n') + '\n',
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify({
      seed: 'complete',
      database: databaseName,
      credentialsPrinted: false,
    }),
  );
}

const cases = [
  {
    id: 'hours',
    tenant: 'STORE_A',
    query: '운영시간은?',
    facts: ['10시|10:00', '22시|22:00|오후 10'],
  },
  {
    id: 'product',
    tenant: 'STORE_A',
    query: '멀티탭 3구 2m는 어디에 있고 재고와 가격은 얼마인가요?',
    facts: ['A-04', '18', '5,?000', '등록|자료'],
  },
  {
    id: 'exchange-a',
    tenant: 'STORE_A',
    query: '8일 전에 산 미사용 멀티탭과 영수증이 있어요. 교환할 수 있나요?',
    facts: ['7일', '지났|초과|어렵|불가|불가능'],
  },
  {
    id: 'exchange-b',
    tenant: 'STORE_B',
    query: '8일 전에 산 미사용 상품과 영수증이 있어요. 교환할 수 있나요?',
    facts: ['14일', '가능'],
  },
  {
    id: 'partial-layout',
    tenant: 'STORE_A',
    query: '매장의 구조는',
    facts: [
      '1층',
      '2층',
      'A-04',
      'C-02',
      '확인.*(?:없|어렵)|알 수 없|확정.*없',
    ],
    forbidden: ['총\\s*2층(?:입니다|으로 구성)'],
  },
  {
    id: 'unknown-stairs',
    tenant: 'STORE_A',
    query: '계단이 매장 어디에 있나요?',
    refuse: true,
  },
  {
    id: 'tenant-isolation',
    tenant: 'STORE_B',
    query: '멀티탭 3구 2m의 가격과 위치를 알려주세요.',
    refuse: true,
  },
];

async function compare() {
  if (!['off', 'shadow', 'classify'].includes(mode))
    throw new Error('JEV_DEMO_MODE_REQUIRED');
  await checkServer(mode);
  const failedOnly = process.argv.includes('--failed');
  if (failedOnly && mode !== 'shadow')
    throw new Error('JEV_DEMO_FAILED_SELECTION_REQUIRES_SHADOW');
  let selectedCases = cases;
  if (failedOnly) {
    const previous = JSON.parse(
      await readFile(join(directory, 'shadow.json'), 'utf8'),
    );
    if (
      previous.database !== databaseName ||
      previous.mode !== 'shadow' ||
      previous.cases.length !== cases.length
    )
      throw new Error('JEV_DEMO_INVALID_BASELINE');
    selectedCases = cases.filter((item) =>
      previous.cases.some(
        (row) => row.id === item.id && row.jev?.status === 'unavailable',
      ),
    );
    if (!selectedCases.length) throw new Error('JEV_DEMO_NO_FAILED_CASES');
  }
  const path = join(directory, mode + (failedOnly ? '-retest' : '') + '.json');
  const resume = process.argv.includes('--resume-after-review');
  let prior;
  try {
    prior = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (prior && !resume)
    throw new Error('JEV_DEMO_RESULT_ALREADY_EXISTS_NO_REPLAY');
  if (
    prior &&
    (prior.mode !== mode ||
      prior.database !== databaseName ||
      prior.cases.some((row, index) => row.id !== selectedCases[index]?.id))
  )
    throw new Error('JEV_DEMO_INVALID_RESUME');
  const db = await connect();
  const report = prior ?? {
    date: '2026-10-22',
    mode,
    endpoint: demo + '/api/answers',
    database: databaseName,
    selection: failedOnly ? 'previously-unavailable' : 'all',
    cases: [],
  };
  try {
    for (const item of selectedCases.slice(report.cases.length)) {
      const requestId = randomUUID();
      const startedAt = performance.now();
      const response = await fetch(demo + '/api/answers', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-correlation-id': requestId,
        },
        body: JSON.stringify({ tenantId: item.tenant, query: item.query }),
        signal: AbortSignal.timeout(25000),
        redirect: 'error',
      });
      const payload = await response.json().catch(() => null);
      const stored = await db.query(
        'SELECT response, matched_chunk_ids, inputtokens,outputtokens,totaltokens,execution FROM knowledge_query_log WHERE request_id=$1 AND appcode=$2',
        [requestId, apps[item.tenant]],
      );
      const log = stored.rows[0];
      const answer = payload?.answer ?? '';
      const factual =
        response.ok &&
        (item.refuse
          ? payload.answerable === false && payload.sources?.length === 0
          : payload.answerable === true &&
            payload.sources?.length > 0 &&
            item.facts.every((pattern) => new RegExp(pattern).test(answer)));
      const quality =
        factual &&
        !(item.forbidden ?? []).some((pattern) =>
          new RegExp(pattern).test(answer),
        );
      const row = {
        id: item.id,
        tenant: item.tenant,
        query: item.query,
        status: response.status,
        requestId,
        answer,
        answerable: payload?.answerable ?? null,
        sources: (payload?.sources ?? []).map((source) => source.name),
        httpDurationMs: Math.round(performance.now() - startedAt),
        latencyMs: payload?.latencyMs ?? null,
        factual,
        quality,
        serverRecordFound: Boolean(log),
        bedrockUsage: log
          ? {
              inputTokens: log.inputtokens,
              outputTokens: log.outputtokens,
              totalTokens: log.totaltokens,
            }
          : null,
        performance: log?.execution?.performance ?? null,
        answerStatus: log?.execution?.answerStatus ?? null,
        jev: log?.execution?.jev ?? null,
        classification: log?.execution?.jevClassification ?? null,
        inquiryGuidanceSha256: log?.execution?.inquiryGuidanceSha256 ?? null,
        publicResponseMatchesStoredAnswer:
          Boolean(log) && log.response === answer,
      };
      report.cases.push(row);
      await writeFile(path, JSON.stringify(report, null, 2));
      console.log(
        JSON.stringify({
          mode,
          id: item.id,
          httpStatus: response.status,
          quality,
          jev: row.jev?.status ?? 'not_called',
          creditsCharged: row.jev?.billing?.creditsCharged ?? null,
          ...(mode === 'classify'
            ? {
                category: row.classification?.category,
                appliedCategory: row.classification?.appliedCategory,
                classificationStatus: row.classification?.status,
                classificationCredits:
                  row.classification?.billing?.creditsCharged ?? null,
              }
            : {}),
        }),
      );
      if (!response.ok || !log)
        throw new Error('JEV_DEMO_REQUEST_FAILED_NO_AUTOMATIC_REPLAY');
      if (mode === 'shadow' && row.jev?.status !== 'evaluated')
        throw new Error('JEV_DEMO_SHADOW_UNAVAILABLE_NO_AUTOMATIC_REPLAY');
      if (mode === 'classify') {
        const expected = {
          hours: 'store_info',
          product: 'product',
          'exchange-a': 'refund_exchange',
          'exchange-b': 'refund_exchange',
          'partial-layout': 'store_info',
          'unknown-stairs': 'store_info',
          'tenant-isolation': 'product',
        }[item.id];
        if (
          row.classification?.status !== 'classified' ||
          row.classification.appliedCategory !== expected ||
          !row.inquiryGuidanceSha256 ||
          row.jev !== null
        )
          throw new Error(
            'JEV_DEMO_CLASSIFICATION_CHECK_FAILED_NO_AUTOMATIC_REPLAY',
          );
      }
      if (!quality) throw new Error('JEV_DEMO_QUALITY_CHECK_FAILED');
      if (process.argv.includes('--one')) break;
    }
  } finally {
    await db.end();
  }
  console.log(
    JSON.stringify({
      report: path,
      requests: report.cases.length,
      qualityPasses: report.cases.filter((row) => row.quality).length,
    }),
  );
}

try {
  await mkdir(directory, { recursive: true });
  if (command === 'prepare') await prepare();
  else if (command === 'server') await server();
  else if (command === 'seed') await seed();
  else if (command === 'compare') await compare();
  else
    throw new Error(
      'Usage: prepare | server off/shadow/classify | seed | compare off/shadow/classify',
    );
} catch (error) {
  // Exception messages from DB/AWS/HTTP may contain connection material. Only print known harness codes.
  const code =
    typeof error?.message === 'string' &&
    /^(JEV_DEMO_|Usage:)/.test(error.message)
      ? error.message
      : 'JEV_DEMO_OPERATION_FAILED';
  console.error(JSON.stringify({ code }));
  process.exitCode = 1;
}
