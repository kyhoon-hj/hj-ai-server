import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { AppInfoService } from '../src/app-info/app-info.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { KnowledgeIndexJobService } from '../src/knowledge/knowledge-index-job.service';
import { StorageService } from '../src/storage/storage.service';

const suite =
  process.env.RUN_RAG_QUALITY_E2E === 'true' ? describe : describe.skip;
const performanceBaseline = process.env.RUN_PERFORMANCE_BASELINE === 'true';
suite('RAG quality baseline (paid AWS, isolated DB)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const tenants: string[] = [];
  const keys: Record<string, string> = {};
  let directory: string;

  beforeAll(async () => {
    const target = new URL(process.env.DATABASE_URL!);
    expect(['localhost', '127.0.0.1', '[::1]']).toContain(target.hostname);
    expect(target.pathname).toMatch(/^\/queue_e2e_[a-f0-9]{32}$/);
    expect(
      Object.keys(process.env).filter(
        (k) => k.startsWith('AWS_ENDPOINT_URL') && process.env[k],
      ),
    ).toEqual([]);
    for (const key of [
      'AWS_REGION',
      'AWS_S3_BUCKET',
      'BEDROCK_MODEL_ID',
      'BEDROCK_EMBEDDING_MODEL_ID',
    ])
      expect(process.env[key]).toBeTruthy();
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
    await app.listen(0, '127.0.0.1');
    prisma = app.get(PrismaService);
    const dataset = JSON.parse(
      await readFile(resolve('demo/fixtures/rag-golden.json'), 'utf8'),
    ) as { sources: Record<string, string[]> };
    if (performanceBaseline)
      dataset.sources = { STORE_A: ['store-a-policy.md'] };
    if (process.env.RAG_EVAL_DATASET === 'adversarial') {
      dataset.sources.STORE_A.push('store-a-inspection-test.md');
    }
    if (process.env.RAG_EVAL_DATASET === 'repeatability') {
      dataset.sources.STORE_A.push(
        'store-a-inspection-test.md',
        'store-a-reservation-test.md',
        'store-a-packaging-test.md',
      );
    }
    const corpus = process.env.RAG_EVAL_CORPUS ?? 'original';
    expect(['original', 'quality-v2']).toContain(corpus);
    const fixtureRoot =
      corpus === 'quality-v2' ? 'demo/fixtures/quality-v2' : 'demo/fixtures';
    for (const [label, names] of Object.entries(dataset.sources)) {
      const appcode = `rag-eval-${randomUUID()}`;
      const tenant = await app.get(AppInfoService).create({
        appcode,
        appname: label,
        allowedAccessLevels: ['PUBLIC'],
        defaultModelId: process.env.BEDROCK_MODEL_ID,
        defaultEmbeddingModelId: process.env.BEDROCK_EMBEDDING_MODEL_ID,
      });
      tenants.push(appcode);
      keys[`RAG_EVAL_APPKEY_${label}`] = tenant.appkey;
      const base = `/admin/v1/knowledge/apps/${tenant.id}`;
      for (const name of names) {
        const response = await request(app.getHttpServer())
          .post(`${base}/files`)
          .set('x-admin-key', process.env.ADMIN_API_KEY!)
          .attach('file', await readFile(resolve(fixtureRoot, name)), {
            filename: name,
            contentType: name.endsWith('.csv') ? 'text/csv' : 'text/markdown',
          })
          .expect(201);
        const file = response.body as { id: string };
        const submitted = await request(app.getHttpServer())
          .post(`${base}/files/${file.id}/index-jobs`)
          .set('x-admin-key', process.env.ADMIN_API_KEY!)
          .expect(202);
        const jobId = (submitted.body as { id: string }).id;
        const deadline = Date.now() + 90000;
        let completed = false;
        while (Date.now() < deadline) {
          const job = await app
            .get(KnowledgeIndexJobService)
            .get(jobId, appcode);
          if (job.status === 'failed')
            throw new Error(`Fixture indexing failed: ${job.errorCode}`);
          if (job.status === 'completed') {
            completed = true;
            break;
          }
          await new Promise((r) => setTimeout(r, 250));
        }
        expect(completed).toBe(true);
        await request(app.getHttpServer())
          .patch(`${base}/files/${file.id}/policy`)
          .set('x-admin-key', process.env.ADMIN_API_KEY!)
          .send({ accessLevel: 'PUBLIC', businessStatus: 'PUBLISHED' })
          .expect(200);
        console.log(`Indexed evaluation fixture: ${label}/${name}`);
      }
    }
    const root = resolve('outputs/rag-quality');
    await mkdir(root, { recursive: true });
    directory = await mkdtemp(join(root, 'baseline-'));
    console.log(`Report directory: ${directory}`);
  }, 180000);

  it('collects all configured responses and persists the unmodified quality verdict', async () => {
    const baseUrl = await app.getUrl();
    const stdout = await new Promise<string>((resolveResult, reject) => {
      const child = spawn(
        process.execPath,
        [
          resolve(
            performanceBaseline
              ? 'demo/scripts/performance-baseline.mjs'
              : 'demo/scripts/rag-quality.mjs',
          ),
          '--live',
        ],
        {
          env: {
            ...process.env,
            ...keys,
            RAG_EVAL_BASE_URL: baseUrl,
            RAG_EVAL_REPORT_DIRECTORY: directory,
          },
          stdio: ['ignore', 'pipe', 'inherit'],
        },
      );
      let output = '';
      const deadline = setTimeout(() => child.kill(), 390000);
      child.stdout.on('data', (chunk: Buffer) => {
        output += chunk.toString();
      });
      child.once('error', (error) => {
        clearTimeout(deadline);
        reject(error);
      });
      child.once('exit', (code) => {
        clearTimeout(deadline);
        if (code === 0 || code === 1) resolveResult(output);
        else reject(new Error(`Evaluator exited ${code}`));
      });
    });
    await writeFile(join(directory, 'report.json'), stdout, { mode: 0o600 });
    if (performanceBaseline) {
      const baseline = JSON.parse(stdout) as {
        configuration: { total: number; concurrency: number };
        summary: {
          successRate: number;
          awsRequest: { completeRequests: number };
        };
      };
      console.log(JSON.stringify(baseline.summary));
      expect(baseline.configuration).toMatchObject({
        total: 5,
        concurrency: 1,
      });
      expect(baseline.summary.successRate).toBe(100);
      expect(baseline.summary.awsRequest.completeRequests).toBe(5);
      return;
    }
    const report = JSON.parse(stdout) as {
      metrics: { total: number; received: number; valid: number };
      gatePassed: boolean;
    };
    console.log(
      JSON.stringify({ ...report.metrics, gatePassed: report.gatePassed }),
    );
    const expectedCount =
      process.env.RAG_EVAL_DATASET === 'adversarial'
        ? 56
        : process.env.RAG_EVAL_DATASET === 'extended'
          ? 70
          : 50;
    const total =
      process.env.RAG_EVAL_DATASET === 'repeatability' ? 74 : expectedCount;
    expect(report.metrics.total).toBe(total);
    expect(report.metrics.received).toBe(total);
    expect(report.metrics.valid).toBe(total);
    // Quality gate failure is a measured baseline, not a fixture infrastructure failure.
  }, 420000);

  afterAll(async () => {
    try {
      if (prisma) {
        await app.get(KnowledgeIndexJobService).onModuleDestroy();
        const files = await prisma.knowledgeFile.findMany({
          where: { appcode: { in: tenants } },
        });
        const failures: string[] = [];
        for (const file of files) {
          try {
            await app.get(StorageService).deleteFile(file.key, file.appcode);
          } catch {
            failures.push(`${file.bucket}/${file.key}`);
          }
        }
        if (failures.length)
          throw new Error(`Fixture cleanup failed: ${failures.join(', ')}`);
        console.log(`Removed ${files.length} evaluation S3 objects.`);
        if (directory) {
          // Export failures must not prevent S3 cleanup. DB is removed by the runner.
          const executions = await prisma.knowledgeQueryLog.findMany({
            where: { appcode: { in: tenants } },
            select: {
              id: true,
              requestId: true,
              appcode: true,
              execution: true,
              createdAt: true,
            },
            orderBy: { createdAt: 'asc' },
          });
          await writeFile(
            join(directory, 'server-executions.json'),
            JSON.stringify(executions, null, 2),
            { mode: 0o600 },
          );
        }
      }
    } finally {
      await app?.close();
    }
  }, 60000);
});
