import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { createConsoleWebServer } from '../server.mjs';

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

async function close(server) {
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

test('Console 문서 경로와 정적 asset을 제공한다', async (context) => {
  const server = createConsoleWebServer();
  const origin = await listen(server);
  context.after(() => close(server));

  const documentResponse = await fetch(
    `${origin}/console/apps/app-id/overview`,
  );
  assert.equal(documentResponse.status, 200);
  assert.match(documentResponse.headers.get('content-type'), /text\/html/);
  assert.match(await documentResponse.text(), /HJ AI Console/);
  assert.equal(documentResponse.headers.get('cache-control'), 'no-store');

  const assetResponse = await fetch(`${origin}/console-assets/api.js`);
  assert.equal(assetResponse.status, 200);
  assert.match(assetResponse.headers.get('content-type'), /text\/javascript/);
  assert.equal(assetResponse.headers.get('cache-control'), 'no-cache');
  assert.match(await assetResponse.text(), /appsApi/);
});

test('Console API 요청만 AI Server로 전달한다', async (context) => {
  const received = [];
  const upstream = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    received.push({
      url: request.url,
      method: request.method,
      body,
      correlationId: request.headers['x-correlation-id'],
    });
    response.writeHead(201, {
      'content-type': 'application/json',
      'x-correlation-id': 'upstream-1',
    });
    response.end(JSON.stringify({ id: 'created-app' }));
  });
  const upstreamOrigin = await listen(upstream);
  const server = createConsoleWebServer({ aiServerOrigin: upstreamOrigin });
  const origin = await listen(server);
  context.after(async () => {
    await close(server);
    await close(upstream);
  });

  const response = await fetch(`${origin}/console-api/v1/apps?status=active`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-correlation-id': 'browser-1',
    },
    body: JSON.stringify({ appname: 'Support' }),
  });

  assert.equal(response.status, 201);
  assert.equal(response.headers.get('x-correlation-id'), 'upstream-1');
  assert.deepEqual(await response.json(), { id: 'created-app' });
  assert.deepEqual(received, [
    {
      url: '/console-api/v1/apps?status=active',
      method: 'POST',
      body: JSON.stringify({ appname: 'Support' }),
      correlationId: 'browser-1',
    },
  ]);
});

test('Console 이외 경로와 존재하지 않는 asset은 노출하지 않는다', async (context) => {
  const server = createConsoleWebServer();
  const origin = await listen(server);
  context.after(() => close(server));

  assert.equal((await fetch(`${origin}/admin`)).status, 404);
  assert.equal(
    (await fetch(`${origin}/console-assets/missing.js`)).status,
    404,
  );
});
