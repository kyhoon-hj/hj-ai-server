import assert from 'node:assert/strict';
import test from 'node:test';
import {
  appsApi,
  auditApi,
  ConsoleApiError,
  credentialsApi,
  knowledgeApi,
  playgroundApi,
  requestLogsApi,
  usageApi,
} from '../public/api.js';

test('지식 파일 업로드는 multipart로 보내고 정책 변경은 JSON으로 보낸다', async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  const requests = [];
  globalThis.fetch = async (path, options) => {
    requests.push({ path, options });
    return new Response(JSON.stringify({ id: 'file-1' }), {
      status: options.method === 'POST' ? 201 : 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  await knowledgeApi.upload('app-1', new File(['content'], 'policy.txt', { type: 'text/plain' }));
  await knowledgeApi.updatePolicy('app-1', 'file-1', { businessStatus: 'PUBLISHED' });
  assert.equal(requests[0].path, '/console-api/v1/apps/app-1/knowledge/files');
  assert.equal(requests[0].options.headers['content-type'], undefined);
  assert.equal(requests[0].options.body.get('file').name, 'policy.txt');
  assert.equal(requests[1].path, '/console-api/v1/apps/app-1/knowledge/files/file-1/policy');
  assert.deepEqual(JSON.parse(requests[1].options.body), { businessStatus: 'PUBLISHED' });
});

test('지식 색인 작업과 조직 실패 지표를 Console API로 조회한다', async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  const paths = [];
  globalThis.fetch = async (path, options) => {
    paths.push(`${options.method}:${path}`);
    return new Response(JSON.stringify({ id: 'job-1' }), { headers: { 'content-type': 'application/json' } });
  };
  await knowledgeApi.indexFailures();
  await knowledgeApi.jobs('app-1', 'file-1');
  await knowledgeApi.job('app-1', 'job-1');
  await knowledgeApi.submitIndex('app-1', 'file-1');
  await knowledgeApi.submitReindex('app-1', 'file-1');
  await knowledgeApi.retry('app-1', 'job-1');
  assert.deepEqual(paths, [
    'GET:/console-api/v1/knowledge/index-failures',
    'GET:/console-api/v1/apps/app-1/knowledge/files/file-1/index-jobs',
    'GET:/console-api/v1/apps/app-1/knowledge/index-jobs/job-1',
    'POST:/console-api/v1/apps/app-1/knowledge/files/file-1/index-jobs',
    'POST:/console-api/v1/apps/app-1/knowledge/files/file-1/reindex-jobs',
    'POST:/console-api/v1/apps/app-1/knowledge/index-jobs/job-1/retry',
  ]);
});

test('보관 목록과 안전한 삭제·복구 경로를 구분한다', async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  const paths = [];
  globalThis.fetch = async (path, options) => {
    paths.push(`${options.method}:${path}`);
    return new Response(JSON.stringify({ id: 'file-1', status: 'archived' }), { headers: { 'content-type': 'application/json' } });
  };
  await knowledgeApi.list('app-1', true);
  await knowledgeApi.archive('app-1', 'file-1');
  await knowledgeApi.archive('app-1', 'file-1', true);
  await knowledgeApi.retryObjectCleanup('app-1', 'file-1');
  assert.deepEqual(paths, [
    'GET:/console-api/v1/apps/app-1/knowledge/files?includeArchived=true',
    'DELETE:/console-api/v1/apps/app-1/knowledge/files/file-1',
    'DELETE:/console-api/v1/apps/app-1/knowledge/files/file-1?deleteObject=true',
    'POST:/console-api/v1/apps/app-1/knowledge/files/file-1/object-cleanup/retry',
  ]);
});

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

test('사용량 알림과 summary, timeseries, breakdown 범위를 전달한다', async (context) => {
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

  await usageApi.alerts();
  await usageApi.summary(30);
  await usageApi.timeseries(30);
  await usageApi.breakdown(30);

  assert.deepEqual(paths, [
    '/console-api/v1/usage/alerts',
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

test('감사 필터와 cursor를 조직 범위 Console API에 전달한다', async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  let path;
  globalThis.fetch = async (value) => {
    path = value;
    return new Response(JSON.stringify({ items: [], nextCursor: null }), {
      headers: { 'content-type': 'application/json' },
    });
  };

  await auditApi.list({
    days: 7,
    eventType: 'CONSOLE_APP_UPDATED',
    appId: '11111111-1111-4111-8111-111111111111',
    worksUserId: '22222222-2222-4222-8222-222222222222',
    cursor: 'cursor value',
  });

  const url = new URL(path, 'http://localhost');
  assert.equal(url.pathname, '/console-api/v1/audit-events');
  assert.equal(url.searchParams.get('days'), '7');
  assert.equal(url.searchParams.get('eventType'), 'CONSOLE_APP_UPDATED');
  assert.equal(url.searchParams.get('cursor'), 'cursor value');
});
