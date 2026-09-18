import assert from 'node:assert/strict';
import test from 'node:test';
import {
  appsApi,
  ConsoleApiError,
  credentialsApi,
  playgroundApi,
  requestLogsApi,
  usageApi,
} from '../public/api.js';

test('앱 목록 요청은 same-origin credential 정책을 사용한다', async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  let captured;
  globalThis.fetch = async (...args) => {
    captured = args;
    return new Response(JSON.stringify([{ id: 'app-1' }]), {
      headers: { 'content-type': 'application/json' },
    });
  };

  assert.deepEqual(await appsApi.list(), [{ id: 'app-1' }]);
  assert.equal(captured[0], '/console-api/v1/apps');
  assert.equal(captured[1].credentials, 'same-origin');
});

test('앱 생성과 수정 payload를 JSON으로 직렬화한다', async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  const requests = [];
  globalThis.fetch = async (path, options) => {
    requests.push({ path, options });
    return new Response(JSON.stringify({ id: 'app-1' }), {
      status: options.method === 'POST' ? 201 : 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  await appsApi.create({ appname: 'Support', remark: '고객 지원' });
  await appsApi.update('app-1', { status: 'inactive' });

  assert.deepEqual(
    requests.map(({ path, options }) => ({
      path,
      method: options.method,
      body: JSON.parse(options.body),
    })),
    [
      {
        path: '/console-api/v1/apps',
        method: 'POST',
        body: { appname: 'Support', remark: '고객 지원' },
      },
      {
        path: '/console-api/v1/apps/app-1',
        method: 'PATCH',
        body: { status: 'inactive' },
      },
    ],
  );
});

test('구조화 오류와 correlation ID를 보존한다', async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        code: 'CONSOLE_UNAUTHORIZED',
        message: '로그인이 필요합니다.',
      }),
      { status: 401, headers: { 'x-correlation-id': 'request-123' } },
    );

  await assert.rejects(
    appsApi.list(),
    (error) =>
      error instanceof ConsoleApiError &&
      error.status === 401 &&
      error.code === 'CONSOLE_UNAUTHORIZED' &&
      error.correlationId === 'request-123',
  );
});

test('credential 목록·발급·회전·폐기 계약을 사용한다', async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  const requests = [];
  globalThis.fetch = async (path, options) => {
    requests.push({ path, options });
    return new Response(JSON.stringify({ ok: true }), {
      status: options.method === 'POST' ? 201 : 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  await credentialsApi.list('app-1');
  await credentialsApi.issue('app-1', { ttlDays: 90 });
  await credentialsApi.rotate('app-1', {
    ttlDays: 180,
    gracePeriodSeconds: 1800,
  });
  await credentialsApi.revoke('app-1', 'credential-1');

  assert.deepEqual(
    requests.map(({ path, options }) => ({
      path,
      method: options.method,
      body: options.body ? JSON.parse(options.body) : null,
    })),
    [
      {
        path: '/console-api/v1/apps/app-1/credentials',
        method: 'GET',
        body: null,
      },
      {
        path: '/console-api/v1/apps/app-1/credentials',
        method: 'POST',
        body: { ttlDays: 90 },
      },
      {
        path: '/console-api/v1/apps/app-1/credentials/rotate',
        method: 'POST',
        body: { ttlDays: 180, gracePeriodSeconds: 1800 },
      },
      {
        path: '/console-api/v1/apps/app-1/credentials/credential-1',
        method: 'DELETE',
        body: null,
      },
    ],
  );
});

test('Playground 요청은 Key를 전용 header로 전달하고 저장하지 않는다', async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  let captured;
  globalThis.fetch = async (...args) => {
    captured = args;
    return new Response(JSON.stringify({ answerable: true, answer: '완료' }), {
      headers: { 'content-type': 'application/json' },
    });
  };

  await playgroundApi.answer('temporary-key', {
    query: '질문',
    strict: true,
  });

  assert.equal(captured[0], '/console-playground-api/knowledge/answers');
  assert.equal(captured[1].method, 'POST');
  assert.equal(
    captured[1].headers['x-console-playground-appkey'],
    'temporary-key',
  );
  assert.deepEqual(JSON.parse(captured[1].body), {
    query: '질문',
    strict: true,
  });
});

test('사용량 summary, timeseries와 breakdown 범위를 전달한다', async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  const paths = [];
  globalThis.fetch = async (path) => {
    paths.push(path);
    return new Response(JSON.stringify({}), {
      headers: { 'content-type': 'application/json' },
    });
  };

  await usageApi.summary(30);
  await usageApi.timeseries(30);
  await usageApi.breakdown(30);

  assert.deepEqual(paths, [
    '/console-api/v1/usage/summary?days=30',
    '/console-api/v1/usage/timeseries?days=30',
    '/console-api/v1/usage/breakdown?days=30',
  ]);
});

test('요청 로그 필터와 상세 ID를 안전하게 직렬화한다', async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  const paths = [];
  globalThis.fetch = async (path) => {
    paths.push(path);
    return new Response(JSON.stringify({}), {
      headers: { 'content-type': 'application/json' },
    });
  };

  await requestLogsApi.list({
    days: 7,
    status: 'failed',
    requestId: 'request 1',
    appId: 'app-1',
  });
  await requestLogsApi.get('knowledge:11111111-1111-4111-8111-111111111111');
  const exportUrl = requestLogsApi.exportUrl({ days: 30, status: 'failed' });

  assert.deepEqual(paths, [
    '/console-api/v1/request-logs?days=7&status=failed&requestId=request+1&appId=app-1',
    '/console-api/v1/request-logs/knowledge%3A11111111-1111-4111-8111-111111111111',
  ]);
  assert.equal(
    exportUrl,
    '/console-api/v1/request-logs/export.csv?days=30&status=failed',
  );
});
