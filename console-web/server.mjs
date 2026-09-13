import { createReadStream } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { AI_SERVER_STANDARD_PORT, CONSOLE_WEB_PORT } from './port.config.mjs';

const publicDirectory = fileURLToPath(new URL('./public/', import.meta.url));
const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
]);

function isConsoleDocument(pathname) {
  return pathname === '/console' || pathname.startsWith('/console/');
}

function publicFile(pathname) {
  if (!pathname.startsWith('/console-assets/')) return null;
  const relativePath = normalize(pathname.slice('/console-assets/'.length));
  if (
    !relativePath ||
    relativePath.startsWith('..') ||
    relativePath.includes(':')
  ) {
    return null;
  }
  return join(publicDirectory, relativePath);
}

async function serveFile(response, path, cacheControl) {
  try {
    await access(path);
    response.writeHead(200, {
      'content-type':
        contentTypes.get(extname(path)) ?? 'application/octet-stream',
      'cache-control': cacheControl,
      'x-content-type-options': 'nosniff',
    });
    createReadStream(path).pipe(response);
    return true;
  } catch {
    return false;
  }
}

async function readRequestBody(request, maxBytes = 1_048_576) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw new Error('REQUEST_BODY_TOO_LARGE');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function proxyConsoleApi(request, response, aiServerOrigin) {
  const target = new URL(request.url, aiServerOrigin);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const body = ['GET', 'HEAD'].includes(request.method)
      ? undefined
      : await readRequestBody(request);
    const upstream = await fetch(target, {
      method: request.method,
      headers: {
        accept: request.headers.accept ?? 'application/json',
        ...(request.headers['content-type']
          ? { 'content-type': request.headers['content-type'] }
          : {}),
        'x-correlation-id': request.headers['x-correlation-id'] ?? randomUUID(),
        ...(request.headers.cookie ? { cookie: request.headers.cookie } : {}),
      },
      body,
      redirect: 'manual',
      signal: controller.signal,
    });
    const payload = Buffer.from(await upstream.arrayBuffer());
    response.writeHead(upstream.status, {
      'content-type':
        upstream.headers.get('content-type') ?? 'application/json',
      'cache-control': 'no-store',
      ...(upstream.headers.get('x-correlation-id')
        ? { 'x-correlation-id': upstream.headers.get('x-correlation-id') }
        : {}),
      ...(upstream.headers.get('set-cookie')
        ? { 'set-cookie': upstream.headers.get('set-cookie') }
        : {}),
    });
    response.end(payload);
  } catch (error) {
    const timedOut = error?.name === 'AbortError';
    response.writeHead(timedOut ? 504 : 502, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    });
    response.end(
      JSON.stringify({
        code: timedOut
          ? 'CONSOLE_UPSTREAM_TIMEOUT'
          : 'CONSOLE_UPSTREAM_UNAVAILABLE',
        message: timedOut
          ? 'AI Server 응답 시간이 초과되었습니다.'
          : 'AI Server에 연결할 수 없습니다.',
      }),
    );
  } finally {
    clearTimeout(timeout);
  }
}

export function createConsoleWebServer(options = {}) {
  const aiServerOrigin =
    options.aiServerOrigin ??
    process.env.AI_SERVER_ORIGIN ??
    `http://127.0.0.1:${AI_SERVER_STANDARD_PORT}`;
  return createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://console.local');
    if (url.pathname.startsWith('/console-api/')) {
      await proxyConsoleApi(request, response, aiServerOrigin);
      return;
    }

    const asset = publicFile(url.pathname);
    if (asset && (await serveFile(response, asset, 'no-cache'))) {
      return;
    }

    if (isConsoleDocument(url.pathname)) {
      await serveFile(
        response,
        join(publicDirectory, 'index.html'),
        'no-store',
      );
      return;
    }

    response.writeHead(404, {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
    });
    response.end('Not Found');
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = createConsoleWebServer();
  server.listen(CONSOLE_WEB_PORT, '127.0.0.1', () => {
    process.stdout.write(
      `HJ AI Console: http://127.0.0.1:${CONSOLE_WEB_PORT}/console/apps\n`,
    );
  });
}
