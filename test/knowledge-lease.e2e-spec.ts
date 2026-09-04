import { ConfigService } from '@nestjs/config';
import { KnowledgeIndexJobService } from '../src/knowledge/knowledge-index-job.service';
import { PrismaService } from '../src/prisma/prisma.service';

class FastLeaseWorker extends KnowledgeIndexJobService {
  protected leaseMilliseconds() {
    return 900;
  }
}
const suite =
  process.env.RUN_QUEUE_HTTP_E2E === 'true' ? describe : describe.skip;
suite('Lease recovery and ownership (isolated PostgreSQL)', () => {
  let prisma: PrismaService;
  const appcode = 'LEASE_TEST';
  const workers: KnowledgeIndexJobService[] = [];
  beforeAll(async () => {
    expect(new URL(process.env.DATABASE_URL!).pathname).toMatch(
      /^\/queue_e2e_[a-f0-9]{32}$/,
    );
    prisma = new PrismaService();
    await prisma.$connect();
    await prisma.appInfo.create({ data: { appcode, appname: 'Lease test' } });
  });
  afterEach(async () => {
    for (const worker of workers.splice(0)) await worker.onModuleDestroy();
    await prisma.knowledgeFile.deleteMany({ where: { appcode } });
  });
  afterAll(async () => {
    await prisma.appInfo.deleteMany({ where: { appcode } });
    await prisma.$disconnect();
  });
  function worker(index: () => Promise<void>) {
    const instance = new FastLeaseWorker(
      prisma,
      { indexKnowledgeFile: index } as never,
      new ConfigService({ KNOWLEDGE_INDEX_WORKER_ENABLED: 'true' }),
    );
    workers.push(instance);
    return instance;
  }
  async function job(
    status = 'queued',
    attempt = 0,
    expires = new Date(Date.now() + 400),
  ) {
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
      data: {
        appcode,
        fileId: file.id,
        operation: 'index',
        status,
        attempt,
        maxAttempts: 3,
        leaseExpiresAt: status === 'processing' ? expires : null,
      },
    });
  }
  async function until(check: () => Promise<boolean>) {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (await check()) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('Lease condition timed out');
  }
  it('recovers a lease that expires after worker startup', async () => {
    const row = await job('processing', 1);
    const index = jest.fn(() => Promise.resolve());
    await worker(index).onModuleInit();
    await until(
      async () =>
        (await prisma.knowledgeIndexJob.findUnique({ where: { id: row.id } }))
          ?.status === 'completed',
    );
    expect(
      await prisma.knowledgeIndexJob.findUnique({ where: { id: row.id } }),
    ).toMatchObject({ attempt: 2 });
    expect(index).toHaveBeenCalledTimes(1);
  });
  it('renews a live lease so a second worker cannot steal a long-running job', async () => {
    const row = await job();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = worker(() => pending);
    const otherIndex = jest.fn(() => Promise.resolve());
    try {
      await first.onModuleInit();
      await until(
        async () =>
          (await prisma.knowledgeIndexJob.findUnique({ where: { id: row.id } }))
            ?.status === 'processing',
      );
      await worker(otherIndex).onModuleInit();
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const active = await prisma.knowledgeIndexJob.findUniqueOrThrow({
        where: { id: row.id },
      });
      expect(active).toMatchObject({ status: 'processing', attempt: 1 });
      expect(active.leaseExpiresAt!.getTime()).toBeGreaterThan(Date.now());
      expect(otherIndex).not.toHaveBeenCalled();
    } finally {
      release();
      await first.drain();
    }
  });
  it('fails an expired job at the attempt limit without another invocation', async () => {
    const row = await job('processing', 3, new Date(0));
    const index = jest.fn(() => Promise.resolve());
    const instance = worker(index);
    await instance.onModuleInit();
    await instance.drain();
    expect(
      await prisma.knowledgeIndexJob.findUnique({ where: { id: row.id } }),
    ).toMatchObject({
      status: 'failed',
      attempt: 3,
      retryable: false,
      errorCode: 'INDEX_LEASE_EXPIRED',
    });
    expect(index).not.toHaveBeenCalled();
  });
  it('does not overwrite a newer attempt when an old dependency completes late', async () => {
    const row = await job();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const instance = worker(() => pending);
    try {
      await instance.onModuleInit();
      await until(
        async () =>
          (await prisma.knowledgeIndexJob.findUnique({ where: { id: row.id } }))
            ?.status === 'processing',
      );
      await prisma.knowledgeIndexJob.update({
        where: { id: row.id },
        data: {
          attempt: 2,
          status: 'failed',
          errorCode: 'NEW_OWNER_RESULT',
          leaseExpiresAt: null,
        },
      });
    } finally {
      release();
      await instance.drain();
    }
    expect(
      await prisma.knowledgeIndexJob.findUnique({ where: { id: row.id } }),
    ).toMatchObject({
      status: 'failed',
      attempt: 2,
      errorCode: 'NEW_OWNER_RESULT',
    });
  });
});
