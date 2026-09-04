import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { AppInfoService } from '../src/app-info/app-info.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { StorageService } from '../src/storage/storage.service';
import { KnowledgeIndexJobService } from '../src/knowledge/knowledge-index-job.service';

const suite =
  process.env.RUN_AWS_LIFECYCLE_E2E === 'true' ? describe : describe.skip;

// Explicit opt-in: real S3 writes and paid Bedrock calls, never part of normal CI.
suite('Live AWS lifecycle through HTTP and durable queue', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let base: string;
  let appcode: string;
  let appkey: string;
  let otherKey: string;
  const credential = () => process.env.ADMIN_API_KEY!;
  const query = 'What is the return deadline for the cobalt kettle?';
  const fixture =
    'The cobalt kettle return deadline is 17 days after purchase. A receipt is required.';

  beforeAll(async () => {
    const target = new URL(process.env.DATABASE_URL!);
    expect(['localhost', '127.0.0.1', '[::1]']).toContain(target.hostname);
    expect(target.pathname).toMatch(/^\/queue_e2e_[a-f0-9]{32}$/);
    for (const name of [
      'AWS_REGION',
      'AWS_S3_BUCKET',
      'BEDROCK_MODEL_ID',
      'BEDROCK_EMBEDDING_MODEL_ID',
    ]) {
      expect(process.env[name]).toBeTruthy();
    }
    // Do not let a custom endpoint masquerade as a live AWS run.
    expect(
      Object.keys(process.env).filter(
        (key) => key.startsWith('AWS_ENDPOINT_URL') && process.env[key],
      ),
    ).toEqual([]);
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    app.useLogger(false);
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
    prisma = app.get(PrismaService);
    appcode = `live-e2e-${randomUUID()}`;
    const apps = app.get(AppInfoService);
    const tenant = await apps.create({
      appcode,
      appname: 'Synthetic live lifecycle',
      allowedAccessLevels: ['PUBLIC'],
      defaultModelId: process.env.BEDROCK_MODEL_ID,
      defaultEmbeddingModelId: process.env.BEDROCK_EMBEDDING_MODEL_ID,
    });
    base = `/admin/v1/knowledge/apps/${tenant.id}`;
    appkey = tenant.appkey;
    otherKey = (
      await apps.create({
        appcode: `${appcode}-other`,
        appname: 'Isolation fixture',
      })
    ).appkey;
  }, 30000);

  afterAll(async () => {
    try {
      if (prisma && appcode) {
        // Stop/await the worker before removing only this run's recorded objects.
        await app.get(KnowledgeIndexJobService).onModuleDestroy();
        const files = await prisma.knowledgeFile.findMany({
          where: { appcode },
        });
        const failures: string[] = [];
        for (const file of files) {
          try {
            await app.get(StorageService).deleteFile(file.key, appcode);
          } catch {
            failures.push(`${file.bucket}/${file.key}`);
          }
        }
        if (failures.length)
          throw new Error(
            `Fixture cleanup failed; exact objects: ${failures.join(', ')}`,
          );
        console.log('Live AWS fixture object cleanup completed.');
      }
    } finally {
      await app?.close();
    }
  }, 60000);

  async function waitForJob(id: string, expected: string) {
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      const result = await request(app.getHttpServer())
        .get(`${base}/index-jobs/${id}`)
        .set('x-admin-key', credential())
        .expect(200);
      const body = result.body as {
        status: string;
        attempt: number;
        errorCode: string;
        retryable: boolean;
      };
      if (body.status === expected) return body;
      if (body.status === 'failed')
        throw new Error(`Live index failed: ${body.errorCode}`);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error('Live index polling deadline exceeded');
  }

  it('uploads, indexes, publishes, retrieves and answers; missing S3 reindex preserves existing vectors', async () => {
    const http = app.getHttpServer();
    const upload = await request(http)
      .post(`${base}/files`)
      .set('x-admin-key', credential())
      .attach('file', Buffer.from(fixture), {
        filename: 'synthetic-policy.txt',
        contentType: 'text/plain',
      })
      .expect(201);
    const file = upload.body as { id: string; key: string };
    expect(file.key.startsWith(`${appcode}/`)).toBe(true);
    const submit = () =>
      request(http)
        .post(`${base}/files/${file.id}/index-jobs`)
        .set('x-admin-key', credential())
        .set('Idempotency-Key', 'live-initial')
        .expect(202);
    const job = (await submit()).body as { id: string };
    expect(((await submit()).body as { id: string }).id).toBe(job.id);
    expect(await waitForJob(job.id, 'completed')).toMatchObject({ attempt: 1 });
    await request(http)
      .patch(`${base}/files/${file.id}/policy`)
      .set('x-admin-key', credential())
      .send({ accessLevel: 'PUBLIC', businessStatus: 'PUBLISHED' })
      .expect(200);
    const rows = await prisma.$queryRaw<
      Array<{ id: string; dimensions: number }>
    >`
      SELECT id, vector_dims(embedding_vector) AS dimensions FROM knowledge_chunk WHERE file_id = ${file.id}::uuid ORDER BY id
    `;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.dimensions === 1024)).toBe(true);
    // A SQL failure must not silently pass by using the in-memory fallback.
    const fallback = jest
      .spyOn(prisma.knowledgeChunk, 'findMany')
      .mockImplementation(() => {
        throw new Error('Unexpected in-memory vector fallback');
      });
    try {
      const search = await request(http)
        .post('/knowledge/search')
        .set('appkey', appkey)
        .send({ query, limit: 1, scoreThreshold: 0 })
        .expect(200);
      expect(search.body).toMatchObject({ matches: [{ fileId: file.id }] });
      const isolated = await request(http)
        .post('/knowledge/search')
        .set('appkey', otherKey)
        .send({ query, scoreThreshold: 0 })
        .expect(200);
      expect(isolated.body).toMatchObject({ matches: [] });
      const answer = await request(http)
        .post('/knowledge/answers')
        .set('appkey', appkey)
        .send({
          query,
          limit: 1,
          scoreThreshold: 0,
          strict: true,
          includeSources: true,
          maxTokens: 128,
          temperature: 0,
        })
        .expect(200);
      expect(answer.body).toMatchObject({
        answerable: true,
        sources: [{ fileId: file.id }],
      });
      const body = answer.body as {
        answer: string;
        usage: { outputTokens: number };
      };
      expect(body.answer).toContain('17');
      expect(body.usage.outputTokens).toBeGreaterThan(0);

      // Delete only the exact fixture created above, then exercise a real S3 404 through the queue.
      await app.get(StorageService).deleteFile(file.key, appcode);
      const reindex = await request(http)
        .post(`${base}/files/${file.id}/reindex-jobs`)
        .set('x-admin-key', credential())
        .set('Idempotency-Key', 'live-missing-source')
        .expect(202);
      const failedId = (reindex.body as { id: string }).id;
      expect(await waitForJob(failedId, 'failed')).toMatchObject({
        attempt: 1,
        errorCode: 'INDEX_SOURCE_NOT_FOUND',
        retryable: false,
      });
      await request(http)
        .post(`${base}/index-jobs/${failedId}/retry`)
        .set('x-admin-key', credential())
        .expect(400);
      const retained = await prisma.$queryRaw<
        Array<{ id: string; dimensions: number }>
      >`
        SELECT id, vector_dims(embedding_vector) AS dimensions FROM knowledge_chunk WHERE file_id = ${file.id}::uuid ORDER BY id
      `;
      expect(retained).toEqual(rows);
      const stillSearchable = await request(http)
        .post('/knowledge/search')
        .set('appkey', appkey)
        .send({ query, limit: 1, scoreThreshold: 0 })
        .expect(200);
      expect(stillSearchable.body).toMatchObject({
        matches: [{ fileId: file.id }],
      });
      expect(fallback).not.toHaveBeenCalled();
    } finally {
      fallback.mockRestore();
    }
    const archived = await request(http)
      .delete(`${base}/files/${file.id}?deleteObject=true`)
      .set('x-admin-key', credential())
      .expect(200);
    expect(archived.body).toMatchObject({
      status: 'archived',
      metadata: { deletedObject: true },
    });
    expect(
      await prisma.knowledgeChunk.count({ where: { fileId: file.id } }),
    ).toBe(0);
  }, 180000);
});
