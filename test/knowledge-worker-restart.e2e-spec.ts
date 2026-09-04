import { fork, ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { PrismaService } from '../src/prisma/prisma.service';

const suite =
  process.env.RUN_QUEUE_HTTP_E2E === 'true' ? describe : describe.skip;
suite('Worker process shutdown/restart (isolated PostgreSQL)', () => {
  let prisma: PrismaService;
  const appcode = 'RESTART_TEST';
  const children: ChildProcess[] = [];
  beforeAll(async () => {
    expect(new URL(process.env.DATABASE_URL!).pathname).toMatch(
      /^\/queue_e2e_[a-f0-9]{32}$/,
    );
    prisma = new PrismaService();
    await prisma.$connect();
    await prisma.appInfo.create({ data: { appcode, appname: 'Restart test' } });
  });
  afterEach(async () => {
    for (const child of children.splice(0)) {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = new Promise<void>((resolve) =>
          child.once('exit', () => resolve()),
        );
        child.kill('SIGKILL');
        await exited;
      }
    }
    await prisma.knowledgeFile.deleteMany({ where: { appcode } });
  });
  afterAll(async () => {
    await prisma.appInfo.deleteMany({ where: { appcode } });
    await prisma.$disconnect();
  });
  async function until(check: () => Promise<boolean>) {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (await check()) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('Worker process condition timed out');
  }
  function start(mode: 'hold' | 'complete') {
    const child = fork(
      join(__dirname, 'fixtures/queue-worker-process.ts'),
      [],
      {
        execArgv: ['-r', 'ts-node/register'],
        env: { ...process.env, QUEUE_PROCESS_MODE: mode },
        stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
      },
    );
    children.push(child);
    const events: Array<{ type: string; fileId?: string }> = [];
    child.on('message', (message: { type: string; fileId?: string }) =>
      events.push(message),
    );
    const exited = new Promise<number | null>((resolve) =>
      child.once('exit', (code) => resolve(code)),
    );
    return { child, events, exited };
  }
  async function createJob() {
    const file = await prisma.knowledgeFile.create({
      data: {
        appcode,
        bucket: 'unused',
        key: crypto.randomUUID(),
        originalName: 'test.txt',
        mimetype: 'text/plain',
        size: 1,
      },
    });
    return prisma.knowledgeIndexJob.create({
      data: { appcode, fileId: file.id, operation: 'index', maxAttempts: 3 },
    });
  }
  it('persists cancellation, leaves the next job untouched, then resumes both after restart', async () => {
    const first = await createJob();
    const worker = start('hold');
    await until(() =>
      Promise.resolve(worker.events.some((event) => event.type === 'started')),
    );
    const second = await createJob();
    worker.child.send('shutdown');
    expect(await worker.exited).toBe(0);
    expect(
      await prisma.knowledgeIndexJob.findUnique({ where: { id: first.id } }),
    ).toMatchObject({
      status: 'queued',
      attempt: 1,
      errorCode: 'UPSTREAM_TIMEOUT',
    });
    expect(
      await prisma.knowledgeIndexJob.findUnique({ where: { id: second.id } }),
    ).toMatchObject({ status: 'queued', attempt: 0 });
    const restarted = start('complete');
    await until(
      async () =>
        (await prisma.knowledgeIndexJob.count({
          where: { appcode, status: 'completed' },
        })) === 2,
    );
    expect(
      await prisma.knowledgeIndexJob.findUnique({ where: { id: first.id } }),
    ).toMatchObject({ attempt: 2 });
    expect(
      await prisma.knowledgeIndexJob.findUnique({ where: { id: second.id } }),
    ).toMatchObject({ attempt: 1 });
    restarted.child.send('shutdown');
    expect(await restarted.exited).toBe(0);
  }, 40000);
  it('recovers a killed process job with an expired lease on startup', async () => {
    const job = await createJob();
    const worker = start('hold');
    await until(() =>
      Promise.resolve(worker.events.some((event) => event.type === 'started')),
    );
    worker.child.kill('SIGKILL');
    await worker.exited;
    expect(
      await prisma.knowledgeIndexJob.findUnique({ where: { id: job.id } }),
    ).toMatchObject({ status: 'processing', attempt: 1 });
    // Advance this isolated fixture's lease instead of waiting five minutes.
    await prisma.knowledgeIndexJob.update({
      where: { id: job.id },
      data: { leaseExpiresAt: new Date(Date.now() - 1000) },
    });
    const restarted = start('complete');
    await until(
      async () =>
        (await prisma.knowledgeIndexJob.findUnique({ where: { id: job.id } }))
          ?.status === 'completed',
    );
    expect(
      await prisma.knowledgeIndexJob.findUnique({ where: { id: job.id } }),
    ).toMatchObject({ attempt: 2, leaseExpiresAt: null });
    restarted.child.send('shutdown');
    expect(await restarted.exited).toBe(0);
  }, 40000);
});
