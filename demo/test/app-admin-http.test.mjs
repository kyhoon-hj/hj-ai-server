import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';

const appId = '3df15c39-8f9d-4c18-8573-01f4f06e18dd';

async function closeServer(server) {
  if (!server.listening) return;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test('admin app routes keep the credential server-side and proxy confirmed lifecycle actions', async (t) => {
  const upstreamRequests = [];
  const upstream = createServer(async (request, response) => {
    let body = {};
    for await (const chunk of request) body = { raw: `${body.raw ?? ''}${chunk}` };
    if (body.raw) body = JSON.parse(body.raw);
    upstreamRequests.push({ method: request.method, url: request.url, adminKey: request.headers['x-admin-key'], body });
    response.setHeader('content-type', 'application/json');

    const publicFields = {
      id: appId,
      appname: 'Store Assistant',
      appcode: 'store-assistant',
      allowedAccessLevels: ['PUBLIC'],
      status: request.method === 'PATCH' ? body.status : 'active',
      appkeyExpiresAt: '2026-12-06T00:00:00.000Z',
      appkeyRotatedAt: '2026-09-07T00:00:00.000Z',
    };
    if (request.method === 'GET' && request.url === '/app-info') {
      return response.end(JSON.stringify([{ ...publicFields, appkey: 'stored-key-must-not-leak', appkeyHash: 'stored-hash' }]));
    }
    if (request.method === 'POST' && request.url === '/app-info') {
      response.statusCode = 201;
      return response.end(JSON.stringify({ ...publicFields, ...body, id: appId, appkey: 'new-app-key' }));
    }
    if (request.method === 'POST' && request.url === `/app-info/${appId}/appkey`) {
      response.statusCode = 201;
      return response.end(JSON.stringify({ ...publicFields, appkey: 'rotated-app-key', previousAppkeyValidUntil: '2026-09-07T00:05:00.000Z' }));
    }
    if (request.method === 'PATCH' && request.url === `/app-info/${appId}`) {
      return response.end(JSON.stringify({ ...publicFields, status: body.status }));
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ message: 'not found' }));
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  t.after(() => closeServer(upstream));

  process.env.AI_SERVER_BASE_URL = `http://127.0.0.1:${upstream.address().port}`;
  process.env.AI_SERVER_ADMIN_API_KEY = 'server-side-admin-key';
  process.env.DEMO_PORT = '11001';
  const { server: demoServer } = await import(`../server.mjs?app-admin-http=${Date.now()}`);
  if (!demoServer.listening) await once(demoServer, 'listening');
  t.after(() => closeServer(demoServer));
  const demoUrl = 'http://127.0.0.1:11001';

  const list = await fetch(`${demoUrl}/api/admin/apps`).then((response) => response.json());
  assert.equal(list.apps.length, 1);
  assert.equal(list.apps[0].appkey, undefined);
  assert.equal(list.apps[0].appkeyHash, undefined);

  const unconfirmed = await fetch(`${demoUrl}/api/admin/apps`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ appname: 'A', appcode: 'a' }),
  });
  assert.equal(unconfirmed.status, 400);

  const issuedResponse = await fetch(`${demoUrl}/api/admin/apps`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ appname: 'Store Assistant', appcode: 'store-assistant', confirmIssue: true }),
  });
  assert.equal(issuedResponse.status, 201);
  assert.equal((await issuedResponse.json()).issued.appkey, 'new-app-key');

  const rotatedResponse = await fetch(`${demoUrl}/api/admin/apps/${appId}/appkey`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ttlDays: 90, gracePeriodSeconds: 300, confirmRotate: true }),
  });
  assert.equal(rotatedResponse.status, 201);
  assert.equal((await rotatedResponse.json()).issued.appkey, 'rotated-app-key');

  const statusResponse = await fetch(`${demoUrl}/api/admin/apps/${appId}/status`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'inactive', confirmStatusChange: true }),
  });
  assert.equal(statusResponse.status, 200);
  assert.equal((await statusResponse.json()).app.status, 'inactive');
  assert.ok(upstreamRequests.every((request) => request.adminKey === 'server-side-admin-key'));
  assert.deepEqual(upstreamRequests.find((request) => request.method === 'POST' && request.url === '/app-info').body.metadata, { purpose: 'appkey-admin-console' });
});
