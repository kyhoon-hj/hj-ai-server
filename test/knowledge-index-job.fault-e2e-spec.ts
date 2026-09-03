import { randomUUID } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { ChunkingService } from '../src/knowledge/chunking.service';
import { DocumentParserService } from '../src/knowledge/document-parser.service';
import { KnowledgeIndexJobService } from '../src/knowledge/knowledge-index-job.service';
import { KnowledgeService } from '../src/knowledge/knowledge.service';

type Fault = Error & {
  code?: string;
  $metadata?: { httpStatusCode: number };
};

const runFaultE2e = process.env.RUN_KNOWLEDGE_FAULT_E2E === 'true';
const describeFaultE2e = runFaultE2e ? describe : describe.skip;
const embedding = Array.from({ length: 1024 }, (_, index) =>
  index === 0 ? 1 : 0,
);

function dependencyError(name: string, status: number, code?: string): Fault {
  return Object.assign(new Error(`${name} injected by fault E2E`), {
    name,
    code,
    $metadata: { httpStatusCode: status },
  });
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

describeFaultE2e(
  'Knowledge index job dependency faults (local PostgreSQL)',
  () => {
    let prisma: PrismaService;
    let appcode: string;
    const fileIds: string[] = [];

    beforeAll(async () => {
      const databaseUrl = new URL(process.env.DATABASE_URL!);
      expect(['localhost', '127.0.0.1', '::1']).toContain(databaseUrl.hostname);

      prisma = new PrismaService();
      await prisma.$connect();
      appcode = `FAULT_${randomUUID().replaceAll('-', '').slice(0, 18)}`;
      await prisma.appInfo.create({
        data: {
          appname: 'Knowledge fault E2E',
          appcode,
          defaultEmbeddingModelId: 'fault-e2e-embedding',
        },
      });
    });

    afterAll(async () => {
      if (!prisma) return;
      await prisma.knowledgeFile.deleteMany({ where: { id: { in: fileIds } } });
      await prisma.appInfo.deleteMany({ where: { appcode } });
      await prisma.$disconnect();
    });

    async function createFile(label: string) {
      const file = await prisma.knowledgeFile.create({
        data: {
          appcode,
          bucket: 'fault-e2e',
          key: `${appcode}/${label}-${randomUUID()}.txt`,
          originalName: `${label}.txt`,
          mimetype: 'text/plain',
          size: 32,
          status: 'indexed',
        },
      });
      fileIds.push(file.id);
      await prisma.knowledgeChunk.create({
        data: {
          fileId: file.id,
          appcode,
          chunkNo: 0,
          content: `previous-${label}`,
          embedding,
          embeddingModel: 'previous-model',
        },
      });
      return file;
    }

    function createServices(options: {
      storageFaults?: Fault[];
      embeddingFaults?: Fault[];
      transactionFaults?: Fault[];
    }) {
      const storageFaults = [...(options.storageFaults ?? [])];
      const embeddingFaults = [...(options.embeddingFaults ?? [])];
      const transactionFaults = [...(options.transactionFaults ?? [])];
      const configValues: Record<string, string> = {
        AWS_REGION: 'us-east-2',
        KNOWLEDGE_INDEX_WORKER_ENABLED: 'false',
        KNOWLEDGE_INDEX_MAX_ATTEMPTS: '3',
        KNOWLEDGE_INDEX_RETRY_DELAY_MS: '100',
        KNOWLEDGE_EMBEDDING_CONCURRENCY: '1',
        KNOWLEDGE_MAX_FILE_SIZE_MB: '1',
      };
      const config = {
        get: jest.fn((key: string) => configValues[key]),
      } as unknown as ConfigService;
      const storage = {
        downloadFileBuffer: jest.fn(() => {
          const fault = storageFaults.shift();
          if (fault) return Promise.reject(fault);
          return Promise.resolve({
            body: Buffer.from('new indexed content from controlled dependency'),
            contentType: 'text/plain',
          });
        }),
      };
      const embeddingService = {
        getDefaultEmbeddingModelId: jest.fn(() => 'fault-e2e-embedding'),
        createEmbedding: jest.fn(() => {
          const fault = embeddingFaults.shift();
          if (fault) return Promise.reject(fault);
          return Promise.resolve(embedding);
        }),
      };
      const knowledgePrisma = {
        knowledgeFile: prisma.knowledgeFile,
        knowledgeChunk: prisma.knowledgeChunk,
        $transaction: jest.fn((operations: Prisma.PrismaPromise<unknown>[]) => {
          const fault = transactionFaults.shift();
          if (fault) return Promise.reject(fault);
          return prisma.$transaction(operations);
        }),
        $executeRaw: jest.fn(() => Promise.resolve(1)),
      };
      const knowledgeService = new KnowledgeService(
        config,
        knowledgePrisma as never,
        storage as never,
        new DocumentParserService(),
        new ChunkingService(),
        embeddingService as never,
      );
      const jobs = new KnowledgeIndexJobService(
        prisma,
        knowledgeService,
        config,
      );
      return { jobs, storage, embeddingService };
    }

    async function submitAndDrain(
      label: string,
      options: Parameters<typeof createServices>[0],
    ) {
      const file = await createFile(label);
      const { jobs } = createServices(options);
      const job = await jobs.submit(file.id, appcode, 'reindex', randomUUID());
      await jobs.drain(appcode);
      return { file, job, jobs };
    }

    async function expectPreviousChunk(fileId: string, label: string) {
      await expect(
        prisma.knowledgeChunk.findMany({ where: { fileId } }),
      ).resolves.toEqual([
        expect.objectContaining({ content: `previous-${label}` }),
      ]);
    }

    it.each([
      [
        'throttling',
        dependencyError('ThrottlingException', 429),
        'UPSTREAM_THROTTLED',
      ],
      [
        'timeout',
        dependencyError('ModelTimeoutException', 408),
        'UPSTREAM_TIMEOUT',
      ],
    ])(
      'persists a %s backoff, preserves chunks, and completes on retry',
      async (label, fault, errorCode) => {
        const { file, job, jobs } = await submitAndDrain(label, {
          embeddingFaults: [fault],
        });
        const waiting = await jobs.get(job.id, appcode);
        expect(waiting).toMatchObject({
          status: 'queued',
          attempt: 1,
          retryable: true,
          errorCode,
        });
        expect(waiting.nextAttemptAt!.getTime()).toBeGreaterThan(
          Date.now() - 50,
        );
        await expectPreviousChunk(file.id, label);

        await delay(120);
        await jobs.drain(appcode);
        await expect(jobs.get(job.id, appcode)).resolves.toMatchObject({
          status: 'completed',
          attempt: 2,
          retryable: false,
          errorCode: null,
        });
        await expect(
          prisma.knowledgeChunk.findMany({ where: { fileId: file.id } }),
        ).resolves.toEqual([
          expect.objectContaining({
            content: 'new indexed content from controlled dependency',
            embeddingModel: 'fault-e2e-embedding',
          }),
        ]);
      },
    );

    it('exhausts retryable 5xx failures at the configured attempt limit', async () => {
      const faults = Array.from({ length: 3 }, () =>
        dependencyError('InternalServerException', 500),
      );
      const { job, jobs } = await submitAndDrain('server-error', {
        embeddingFaults: faults,
      });
      await delay(120);
      await jobs.drain(appcode);
      await delay(220);
      await jobs.drain(appcode);

      await expect(jobs.get(job.id, appcode)).resolves.toMatchObject({
        status: 'failed',
        attempt: 3,
        retryable: true,
        errorCode: 'UPSTREAM_TEMPORARILY_UNAVAILABLE',
        nextAttemptAt: null,
      });
      await expect(jobs.retry(job.id, appcode)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it.each([
      [
        'validation',
        { embeddingFaults: [dependencyError('ValidationException', 400)] },
        'INVALID_INDEX_REQUEST',
      ],
      [
        'access-denied',
        { embeddingFaults: [dependencyError('AccessDeniedException', 403)] },
        'UPSTREAM_ACCESS_DENIED',
      ],
      [
        'missing-s3-key',
        { storageFaults: [dependencyError('NoSuchKey', 404)] },
        'INDEX_SOURCE_NOT_FOUND',
      ],
    ])(
      'records %s as a permanent failure without damaging existing chunks',
      async (label, options, errorCode) => {
        const { file, job, jobs } = await submitAndDrain(label, options);
        await expect(jobs.get(job.id, appcode)).resolves.toMatchObject({
          status: 'failed',
          attempt: 1,
          retryable: false,
          errorCode,
          nextAttemptAt: null,
        });
        await expectPreviousChunk(file.id, label);
        await expect(jobs.retry(job.id, appcode)).rejects.toBeInstanceOf(
          BadRequestException,
        );
      },
    );

    it('recovers from a transient Prisma transaction failure on the next attempt', async () => {
      const databaseFault = Object.assign(
        new Error('database transaction unavailable'),
        { code: 'P1001' },
      );
      const { file, job, jobs } = await submitAndDrain('database', {
        transactionFaults: [databaseFault],
      });
      await expect(jobs.get(job.id, appcode)).resolves.toMatchObject({
        status: 'queued',
        attempt: 1,
        retryable: true,
        errorCode: 'DATABASE_TEMPORARILY_UNAVAILABLE',
      });
      await expectPreviousChunk(file.id, 'database');

      await delay(120);
      await jobs.drain(appcode);
      await expect(jobs.get(job.id, appcode)).resolves.toMatchObject({
        status: 'completed',
        attempt: 2,
      });
    });
  },
);
