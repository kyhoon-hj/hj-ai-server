import 'reflect-metadata';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PrismaService } from '../src/prisma/prisma.service';
import { ChunkingService } from '../src/knowledge/chunking.service';
import { DocumentParserService } from '../src/knowledge/document-parser.service';
import { soakText } from './fixtures/soak-worker-process';
import { loadBuildIdentity } from '../src/common/execution-identity';

type Event = {
  type: string;
  pid: number;
  jobId?: string;
  at?: number;
  rss?: number;
  heapUsed?: number;
  cpuUserMs?: number;
  cpuSystemMs?: number;
  intervalMs?: number;
  runtime?: string;
};
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const durationMs = 390000;
const compiled = __filename.endsWith('.js');
async function main() {
  assert.equal(process.env.RUN_MULTIPROCESS_SOAK, 'true');
  assert.match(
    new URL(process.env.DATABASE_URL!).pathname,
    /^\/queue_e2e_[a-f0-9]{32}$/,
  );
  const db = new PrismaService();
  const appcode = 'MULTIPROCESS_SOAK';
  const runId = randomUUID();
  const directory = resolve('outputs', 'multiprocess-soak', runId);
  await mkdir(directory, { recursive: true });
  const events: Event[] = [];
  const children: ReturnType<typeof start>[] = [];
  function start() {
    const child = fork(
      resolve(
        __dirname,
        `fixtures/soak-worker-process.${compiled ? 'js' : 'ts'}`,
      ),
      [],
      {
        execArgv: compiled ? [] : ['-r', 'ts-node/register'],
        stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
        env: { ...process.env, RUN_MULTIPROCESS_SOAK: 'true' },
      },
    );
    let ready = false;
    let latestJob: string | undefined;
    let expectedExit = false;
    let exited = false;
    child.on('message', (message: Event) => {
      if (message.type === 'sample') events.push(message);
      if (message.type === 'ready') {
        assert.equal(message.runtime, compiled ? 'compiled' : 'ts-node');
        ready = true;
      }
      if (message.type === 'started') latestJob = message.jobId;
    });
    const exit = new Promise<number | null>((resolveExit) =>
      child.once('exit', (code) => {
        exited = true;
        resolveExit(code);
      }),
    );
    return {
      child,
      exit,
      get ready() {
        return ready;
      },
      get latestJob() {
        return latestJob;
      },
      get exited() {
        return exited;
      },
      get expectedExit() {
        return expectedExit;
      },
      expectExit() {
        expectedExit = true;
      },
    };
  }
  let passed = false;
  const completed = new Set<string>();
  const latencies: number[] = [];
  let killedJob: string | undefined;
  let killedAt: number | undefined;
  let leaseExpiresAt: number | undefined;
  let recoveredAt: number | undefined;
  let completedAtKill = 0;
  let completedBeforeRecovery = 0;
  let peakConnections = 0;
  let peakActiveConnections = 0;
  let startedAt = 0;
  try {
    await db.$connect();
    await db.appInfo.create({
      data: { appcode, appname: 'Isolated process soak' },
    });
    const parsed = await new DocumentParserService().parse({
      body: Buffer.from(soakText),
      contentType: 'text/plain',
      fileName: 'soak.txt',
    });
    const expected = new ChunkingService().createChunks(parsed.sections);
    assert.equal(expected.length, 16);
    const files = await Promise.all(
      Array.from({ length: 6 }, () =>
        db.knowledgeFile.create({
          data: {
            appcode,
            bucket: 'synthetic',
            key: randomUUID(),
            originalName: 'soak.txt',
            mimetype: 'text/plain',
            size: Buffer.byteLength(soakText),
          },
        }),
      ),
    );
    const submit = (fileId: string) =>
      db.knowledgeIndexJob.create({
        data: {
          appcode,
          fileId,
          operation: 'reindex',
          maxAttempts: 3,
        },
      });
    const pending = new Map<string, string>();
    for (const file of files) pending.set((await submit(file.id)).id, file.id);
    children.push(start(), start(), start());
    const startupDeadline = Date.now() + 30000;
    while (!children.every((worker) => worker.ready)) {
      assert(Date.now() < startupDeadline, 'Worker startup timeout');
      assert(
        !children.some((worker) => worker.exited),
        'Worker exited during startup',
      );
      await pause(100);
    }
    startedAt = Date.now();
    let lastProgress = startedAt;
    let lastConnections = 0;
    while (Date.now() - startedAt < durationMs || pending.size) {
      assert(
        Date.now() - startedAt < durationMs + 30000,
        'Final drain exceeded 30 seconds',
      );
      assert(
        !children.some((worker) => worker.exited && !worker.expectedExit),
        'Unexpected worker exit',
      );
      if (
        !killedJob &&
        Date.now() - startedAt >= 15000 &&
        children[0].latestJob
      ) {
        const row = await db.knowledgeIndexJob.findUniqueOrThrow({
          where: { id: children[0].latestJob },
        });
        if (row.status === 'processing') {
          killedJob = row.id;
          killedAt = Date.now();
          leaseExpiresAt = row.leaseExpiresAt!.getTime();
          assert(
            leaseExpiresAt - killedAt > 290000,
            'Expected production five-minute lease',
          );
          completedAtKill = completed.size;
          children[0].expectExit();
          children[0].child.kill('SIGKILL');
          await children[0].exit;
          children.push(start());
        }
      }
      const rows = await db.knowledgeIndexJob.findMany({
        where: { id: { in: [...pending.keys()] } },
      });
      for (const row of rows) {
        assert.notEqual(row.status, 'failed', `Job failed: ${row.errorCode}`);
        if (row.status !== 'completed') continue;
        assert(!completed.has(row.id));
        assert.equal(row.attempt, row.id === killedJob ? 2 : 1);
        const chunks = await db.knowledgeChunk.findMany({
          where: { fileId: row.fileId },
          orderBy: { chunkNo: 'asc' },
        });
        assert.equal(chunks.length, expected.length);
        chunks.forEach((chunk, index) => {
          assert.equal(chunk.chunkNo, index);
          assert.equal(chunk.content, expected[index].content);
          assert.equal(chunk.embedding.length, 1024);
          assert.equal(chunk.embedding[0], 1);
        });
        if (row.id === killedJob) {
          recoveredAt = row.completedAt!.getTime();
          assert(recoveredAt >= leaseExpiresAt!);
          completedBeforeRecovery = completed.size - completedAtKill;
        }
        completed.add(row.id);
        pending.delete(row.id);
        latencies.push(row.completedAt!.getTime() - row.requestedAt.getTime());
        if (Date.now() - startedAt < durationMs)
          pending.set((await submit(row.fileId)).id, row.fileId);
      }
      if (Date.now() - lastConnections >= 1000) {
        const [counts] = await db.$queryRaw<
          Array<{ total: number; active: number }>
        >`
          SELECT count(*)::int AS total, count(*) FILTER (WHERE state='active')::int AS active
          FROM pg_stat_activity WHERE datname=current_database() AND application_name='soak-worker'`;
        peakConnections = Math.max(peakConnections, counts.total);
        peakActiveConnections = Math.max(peakActiveConnections, counts.active);
        lastConnections = Date.now();
      }
      if (Date.now() - lastProgress >= 30000) {
        console.log(
          JSON.stringify({
            elapsedSeconds: Math.round((Date.now() - startedAt) / 1000),
            completed: completed.size,
            pending: pending.size,
            recovered: !!recoveredAt,
          }),
        );
        lastProgress = Date.now();
      }
      await pause(100);
    }
    assert(killedJob && recoveredAt, 'Killed job was not recovered');
    assert(
      completedBeforeRecovery > 100,
      'Other workers did not sustain progress',
    );
    assert(
      recoveredAt - leaseExpiresAt! < 10000,
      'Lease recovery took over ten seconds',
    );
    assert(peakConnections <= 6);
    assert.equal(
      await db.knowledgeIndexJob.count({
        where: { appcode, status: { in: ['queued', 'processing', 'failed'] } },
      }),
      0,
    );
    for (const worker of children.filter((worker) => !worker.exited)) {
      worker.expectExit();
      worker.child.send('shutdown');
      assert.equal(
        await Promise.race([worker.exit, pause(10000).then(() => 'timeout')]),
        0,
      );
    }
    assert.equal(await db.knowledgeChunk.count({ where: { appcode } }), 96);
    passed = true;
  } finally {
    for (const worker of children) {
      if (!worker.exited) {
        worker.expectExit();
        worker.child.kill('SIGKILL');
        await worker.exit;
      }
    }
    const pids = [...new Set(events.map(({ pid }) => pid))];
    const workers = pids.map((pid) => {
      const samples = events.filter((event) => event.pid === pid);
      return {
        pid,
        samples: samples.length,
        rssStartBytes: samples[0].rss,
        rssEndBytes: samples.at(-1)!.rss,
        peakRssBytes: Math.max(...samples.map((sample) => sample.rss!)),
        peakHeapUsedBytes: Math.max(
          ...samples.map((sample) => sample.heapUsed!),
        ),
        cpuUserMs: samples.reduce((sum, sample) => sum + sample.cpuUserMs!, 0),
        cpuSystemMs: samples.reduce(
          (sum, sample) => sum + sample.cpuSystemMs!,
          0,
        ),
      };
    });
    latencies.sort((a, b) => a - b);
    await writeFile(
      resolve(directory, 'report.json'),
      JSON.stringify(
        {
          runId,
          runtime: compiled ? 'compiled' : 'ts-node',
          nodeVersion: process.version,
          buildIdentity: loadBuildIdentity(),
          passed,
          durationMs,
          elapsedMs: startedAt ? Date.now() - startedAt : null,
          leaseMs: 300000,
          completed: completed.size,
          killedJob,
          killedAt,
          leaseExpiresAt,
          recoveredAt,
          recoveryAfterLeaseMs: recoveredAt
            ? recoveredAt - leaseExpiresAt!
            : null,
          completedBeforeRecovery,
          peakConnections,
          peakActiveConnections,
          workers,
          jobLatencyMs: {
            p50: latencies[Math.ceil(latencies.length * 0.5) - 1],
            p95: latencies[Math.ceil(latencies.length * 0.95) - 1],
            max: latencies.at(-1),
          },
        },
        null,
        2,
      ) + '\n',
    );
    await writeFile(
      resolve(directory, 'samples.json'),
      JSON.stringify(events) + '\n',
    );
    await db.knowledgeFile.deleteMany({ where: { appcode } });
    await db.appInfo.deleteMany({ where: { appcode } });
    await db.$disconnect();
    console.log(`Soak report: ${directory}; passed=${passed}`);
  }
}
void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
