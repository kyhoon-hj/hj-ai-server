import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';

const demoUrl = new URL(process.env.DEMO_BASE_URL ?? 'http://127.0.0.1:11001');
const fixtureMiB = Math.min(
  35,
  Math.max(6, Number(process.env.STREAMING_SMOKE_FILE_SIZE_MB ?? 6)),
);
const fixtureBytes = fixtureMiB * 1024 * 1024;

async function callJson(path, options = {}) {
  const response = await fetch(new URL(path, demoUrl), {
    method: options.method ?? 'GET',
    headers: options.body ? { 'content-type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const body = await response.json();
  if (!response.ok)
    throw new Error(
      `${path} failed: HTTP ${response.status} ${JSON.stringify(body)}`,
    );
  return body;
}

async function createFixture(path) {
  const output = createWriteStream(path, { flags: 'wx' });
  const chunk = Buffer.alloc(1024 * 1024, 0x61);
  for (let index = 0; index < fixtureMiB; index += 1) {
    if (!output.write(chunk))
      await new Promise((resolve) => output.once('drain', resolve));
  }
  output.end();
  await new Promise((resolve, reject) => {
    output.once('finish', resolve);
    output.once('error', reject);
  });
}

async function uploadMultipart(path, appId) {
  const boundary = `hj-ai-${randomUUID()}`;
  const fileName = `streaming-smoke-${randomUUID()}.md`;
  const prefix = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: text/markdown\r\n\r\n`,
  );
  const suffix = Buffer.from(`\r\n--${boundary}--\r\n`);
  const params = encodeURIComponent(JSON.stringify({ appId }));
  const target = new URL(
    `/api/upload?operationId=adminKnowledge.upload&params=${params}`,
    demoUrl,
  );

  return new Promise((resolve, reject) => {
    const outgoing = request(
      target,
      {
        method: 'POST',
        headers: {
          'content-type': `multipart/form-data; boundary=${boundary}`,
          'content-length': prefix.length + fixtureBytes + suffix.length,
        },
      },
      async (response) => {
        const chunks = [];
        for await (const chunk of response) chunks.push(Buffer.from(chunk));
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (error) {
          reject(error);
        }
      },
    );
    outgoing.once('error', reject);
    outgoing.write(prefix);
    pipeline(createReadStream(path), outgoing, { end: false })
      .then(() => outgoing.end(suffix))
      .catch(reject);
  });
}

async function countStagedFiles() {
  return (await readdir(tmpdir())).filter(
    (name) => name.startsWith('hj-ai-') && name.endsWith('.upload'),
  ).length;
}

const directory = await mkdtemp(join(tmpdir(), 'hj-ai-streaming-smoke-'));
const fixturePath = join(directory, 'fixture.md');
let uploaded = null;

try {
  const state = await callJson('/api/demo/state');
  const profile = state.profiles?.find(
    (item) => item.appcode === 'hj-ai-demo-store-a',
  );
  if (!profile) throw new Error('STORE_A 검증 환경을 먼저 구성해야 합니다.');

  const stagedBefore = await countStagedFiles();
  await createFixture(fixturePath);
  const result = await uploadMultipart(fixturePath, profile.id);
  if (!result.ok || result.status !== 201)
    throw new Error(`upload failed: ${JSON.stringify(result)}`);
  uploaded = result.body;

  const download = await fetch(
    new URL(`/api/download?key=${encodeURIComponent(uploaded.key)}`, demoUrl),
  );
  if (!download.ok) throw new Error(`download failed: HTTP ${download.status}`);
  const bytes = new Uint8Array(await download.arrayBuffer());
  const checksum = createHash('sha256').update(bytes).digest('hex');
  if (bytes.byteLength !== fixtureBytes || checksum !== uploaded.checksum) {
    throw new Error('download size or checksum does not match upload');
  }

  const cleanup = await callJson('/api/invoke', {
    method: 'POST',
    body: {
      operationId: 'adminKnowledge.archive',
      params: { appId: profile.id, id: uploaded.id },
      query: { deleteObject: true },
      confirmDestructive: true,
    },
  });
  if (
    !cleanup.ok ||
    cleanup.status !== 200 ||
    cleanup.body?.metadata?.deletedObject !== true
  ) {
    throw new Error(`cleanup failed: ${JSON.stringify(cleanup)}`);
  }
  uploaded = null;

  const stagedAfter = await countStagedFiles();
  if (stagedAfter !== stagedBefore)
    throw new Error(
      `staged file leak: before ${stagedBefore}, after ${stagedAfter}`,
    );

  process.stdout.write(
    `${JSON.stringify({ fixtureMiB, uploadStatus: result.status, downloadStatus: download.status, checksumMatch: true, deletedObject: true, stagedFileDelta: 0 })}\n`,
  );
} finally {
  if (uploaded) {
    await callJson('/api/invoke', {
      method: 'POST',
      body: {
        operationId: 'adminKnowledge.archive',
        params: {
          appId: (await callJson('/api/demo/state')).profiles.find(
            (item) => item.appcode === 'hj-ai-demo-store-a',
          ).id,
          id: uploaded.id,
        },
        query: { deleteObject: true },
        confirmDestructive: true,
      },
    }).catch(() => undefined);
  }
  await rm(directory, { recursive: true, force: true });
}
