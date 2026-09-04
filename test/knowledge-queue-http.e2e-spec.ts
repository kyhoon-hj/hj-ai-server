import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { KnowledgeService } from '../src/knowledge/knowledge.service';
import { PrismaService } from '../src/prisma/prisma.service';

const suite =
  process.env.RUN_QUEUE_HTTP_E2E === 'true' ? describe : describe.skip;
suite('Knowledge queue HTTP contract (isolated PostgreSQL)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let base: string;
  let otherBase: string;
  let fileId: string;
  const index = jest.fn<Promise<void>, []>();
  const credential = () => process.env.ADMIN_API_KEY!;
  beforeAll(async () => {
    expect(new URL(process.env.DATABASE_URL!).pathname).toMatch(
      /^\/queue_e2e_[a-f0-9]{32}$/,
    );
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(KnowledgeService)
      .useValue({ indexKnowledgeFile: index })
      .compile();
    app = module.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    const tenant = await prisma.appInfo.create({
      data: { appcode: 'QUEUE_HTTP', appname: 'Queue HTTP' },
    });
    const other = await prisma.appInfo.create({
      data: { appcode: 'QUEUE_OTHER', appname: 'Other tenant' },
    });
    base = `/admin/v1/knowledge/apps/${tenant.id}`;
    otherBase = `/admin/v1/knowledge/apps/${other.id}`;
  });
  beforeEach(async () => {
    index.mockReset();
    index.mockResolvedValue(undefined);
    const file = await prisma.knowledgeFile.create({
      data: {
        appcode: 'QUEUE_HTTP',
        bucket: 'unused',
        key: `unused-${Date.now()}`,
        originalName: 'test.txt',
        mimetype: 'text/plain',
        size: 1,
      },
    });
    fileId = file.id;
  });
  afterAll(async () => {
    await app?.close();
  });

  async function waitForStatus(jobId: string, status: string) {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const response = await request(app.getHttpServer())
        .get(`${base}/index-jobs/${jobId}`)
        .set('x-admin-key', credential())
        .expect(200);
      const body = response.body as {
        status: string;
        attempt: number;
        errorCode: string | null;
        retryable: boolean;
      };
      if (body.status === status) return body;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Job did not reach ${status}`);
  }
  async function submit(key: string) {
    const response = await request(app.getHttpServer())
      .post(`${base}/files/${fileId}/index-jobs`)
      .set('x-admin-key', credential())
      .set('Idempotency-Key', key)
      .expect(202);
    return response.body as { id: string };
  }

  it('authenticates, deduplicates submission, persists completion and isolates tenant lookup', async () => {
    await request(app.getHttpServer())
      .post(`${base}/files/${fileId}/index-jobs`)
      .expect(401);
    expect(await prisma.knowledgeIndexJob.count({ where: { fileId } })).toBe(0);
    const job = await submit('same-request');
    expect((await submit('same-request')).id).toBe(job.id);
    expect(await waitForStatus(job.id, 'completed')).toMatchObject({
      attempt: 1,
      errorCode: null,
    });
    expect(index).toHaveBeenCalledTimes(1);
    await request(app.getHttpServer())
      .get(`${otherBase}/index-jobs/${job.id}`)
      .set('x-admin-key', credential())
      .expect(404);
    await request(app.getHttpServer())
      .post(`${base}/files/${fileId}/reindex-jobs`)
      .set('x-admin-key', credential())
      .set('Idempotency-Key', 'same-request')
      .expect(409);
  });

  it('automatically retries a transient failure and reports completion through HTTP', async () => {
    index.mockRejectedValueOnce(
      Object.assign(new Error('Synthetic upstream failure'), {
        name: 'ThrottlingException',
        $metadata: { httpStatusCode: 429 },
      }),
    );
    const job = await submit('transient');
    expect(await waitForStatus(job.id, 'completed')).toMatchObject({
      attempt: 2,
      errorCode: null,
      retryable: false,
    });
    expect(index).toHaveBeenCalledTimes(2);
  });

  it('reports a permanent failure without exposing its raw message and rejects manual retry', async () => {
    index.mockRejectedValueOnce(
      Object.assign(new Error('PRIVATE_DEPENDENCY_DETAIL'), {
        name: 'NoSuchKey',
        $metadata: { httpStatusCode: 404 },
      }),
    );
    const job = await submit('permanent');
    const result = await waitForStatus(job.id, 'failed');
    expect(result).toMatchObject({
      attempt: 1,
      errorCode: 'INDEX_SOURCE_NOT_FOUND',
      retryable: false,
    });
    expect(JSON.stringify(result)).not.toContain('PRIVATE_DEPENDENCY_DETAIL');
    await request(app.getHttpServer())
      .post(`${base}/index-jobs/${job.id}/retry`)
      .set('x-admin-key', credential())
      .expect(400);
    expect(index).toHaveBeenCalledTimes(1);
  });
});
