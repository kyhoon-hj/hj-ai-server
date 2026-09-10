import {
  createServer,
  Server,
  IncomingMessage,
  ServerResponse,
} from 'node:http';
import {
  createServer as createHttp2Server,
  Http2Server,
  Http2ServerRequest,
  Http2ServerResponse,
  ServerHttp2Session,
} from 'node:http2';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { S3Client } from '@aws-sdk/client-s3';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { PrismaService } from '../src/prisma/prisma.service';
import { StorageService } from '../src/storage/storage.service';
import { EmbeddingService } from '../src/knowledge/embedding.service';
import { DocumentParserService } from '../src/knowledge/document-parser.service';
import { ChunkingService } from '../src/knowledge/chunking.service';
import { KnowledgeService } from '../src/knowledge/knowledge.service';
import { KnowledgeIndexJobService } from '../src/knowledge/knowledge-index-job.service';
import { activeAwsRequestCount } from '../src/common/aws/aws-request-control';
import { createTcpFaultProxy } from './fixtures/tcp-fault-proxy';
import { startLoadResourceSampler } from './fixtures/load-resource-sampler';

const suite =
  process.env.RUN_QUEUE_HTTP_E2E === 'true' ? describe : describe.skip;
const vector = Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0));
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const loadRunId = randomUUID();
class ShortLeaseWorker extends KnowledgeIndexJobService {
  protected leaseMilliseconds() {
    return 1200;
  }
}
type Fault =
  | 'healthy'
  | 'reset'
  | 'stall'
  | 'partial-s3'
  | '503'
  | '429'
  | '403';

suite(
  'Real socket and AWS SDK recovery (synthetic upstream, isolated PostgreSQL)',
  () => {
    let control: PrismaService;
    let workerDb: PrismaClient;
    let proxy: Awaited<ReturnType<typeof createTcpFaultProxy>>;
    let upstream: Server;
    let endpoint: string;
    let embeddingEndpoint: string;
    let http2: Http2Server;
    const sessions = new Set<ServerHttp2Session>();
    let s3: S3Client;
    let bedrock: BedrockRuntimeClient;
    let jobs: ShortLeaseWorker;
    let makeWorker: (db: PrismaClient) => ShortLeaseWorker;
    let embeddingService: EmbeddingService;
    const replicas: { db: PrismaClient; worker: ShortLeaseWorker }[] = [];
    const extraProxies: Awaited<ReturnType<typeof createTcpFaultProxy>>[] = [];
    let fault: Fault = 'healthy';
    let failService: 's3' | 'embedding' = 'embedding';
    let onEmbedding: (() => void) | undefined;
    let wireCalls = 0;
    let recoverAfterFirst = false;
    let embeddingDelayMs = 0;
    let fileId: string;
    let content = 'Original network fixture.';
    const appcode = 'NETWORK_E2E';

    beforeAll(async () => {
      const target = new URL(process.env.DATABASE_URL!);
      proxy = await createTcpFaultProxy(target);
      control = new PrismaService();
      await control.$connect();
      workerDb = new PrismaClient({
        adapter: new PrismaPg({
          connectionString: proxy.url.toString(),
          application_name: 'network-e2e-worker',
          connectionTimeoutMillis: 300,
          max: 2,
        }),
      });
      await workerDb.$connect();
      await control.appInfo.create({
        data: {
          appcode,
          appname: 'Network test',
          defaultEmbeddingModelId: 'network-vector',
        },
      });
      const handler = (
        req: IncomingMessage | Http2ServerRequest,
        res: ServerResponse | Http2ServerResponse,
      ) => {
        req.resume();
        const isEmbedding = req.url?.includes('/model/');
        const affected = (isEmbedding ? 'embedding' : 's3') === failService;
        const currentFault = affected ? fault : 'healthy';
        if (affected) {
          wireCalls++;
          if (recoverAfterFirst) fault = 'healthy';
        }
        if (currentFault === 'reset') {
          if (req instanceof Http2ServerRequest) req.stream.session?.destroy();
          else req.socket.destroy();
          return;
        }
        if (currentFault === 'stall') return;
        if (currentFault === 'partial-s3' && res instanceof ServerResponse) {
          res.writeHead(200, {
            'content-type': 'text/plain',
            'content-length': '1000',
          });
          res.flushHeaders();
          res.write('partial');
          setTimeout(() => res.destroy(), 20);
          return;
        }
        if (['503', '429', '403'].includes(currentFault)) {
          const name =
            currentFault === '503'
              ? 'ServiceUnavailableException'
              : currentFault === '429'
                ? 'ThrottlingException'
                : 'AccessDeniedException';
          res.statusCode = Number(currentFault);
          res.setHeader('content-type', 'application/json');
          res.setHeader('x-amzn-errortype', name);
          res.end(JSON.stringify({ message: 'Synthetic wire failure' }));
          return;
        }
        if (isEmbedding) {
          onEmbedding?.();
          res.setHeader('content-type', 'application/json');
          const respond = () =>
            res.end(
              JSON.stringify({ embedding: vector, inputTextTokenCount: 2 }),
            );
          if (embeddingDelayMs) setTimeout(respond, embeddingDelayMs);
          else respond();
        } else {
          res.setHeader('content-type', 'text/plain');
          res.setHeader('content-length', Buffer.byteLength(content));
          res.end(content);
        }
      };
      upstream = createServer(handler);
      http2 = createHttp2Server(handler);
      http2.on('session', (session) => {
        sessions.add(session);
        session.on('error', () => session.destroy());
        session.on('close', () => sessions.delete(session));
      });
      await new Promise<void>((resolve) =>
        http2.listen(0, '127.0.0.1', resolve),
      );
      const http2Address = http2.address();
      if (!http2Address || typeof http2Address === 'string')
        throw new Error('Missing HTTP2 address');
      embeddingEndpoint = `http://127.0.0.1:${http2Address.port}`;
      await new Promise<void>((resolve) =>
        upstream.listen(0, '127.0.0.1', resolve),
      );
      const address = upstream.address();
      if (!address || typeof address === 'string')
        throw new Error('Missing upstream address');
      endpoint = `http://127.0.0.1:${address.port}`;
    });

    function services(maxAttempts = 1, timeout = 500) {
      const config = new ConfigService({
        AWS_REGION: 'us-east-1',
        AWS_S3_BUCKET: 'synthetic',
        AWS_CONNECTION_TIMEOUT_MS: '100',
        AWS_REQUEST_TIMEOUT_MS: String(timeout),
        KNOWLEDGE_INDEX_WORKER_ENABLED: 'false',
        KNOWLEDGE_INDEX_MAX_ATTEMPTS: '2',
        KNOWLEDGE_INDEX_RETRY_DELAY_MS: '100',
        KNOWLEDGE_EMBEDDING_CONCURRENCY: '1',
      });
      const sdk = {
        region: 'us-east-1',
        endpoint,
        maxAttempts,
        retryMode: 'adaptive' as const,
        credentials: {
          accessKeyId: 'synthetic-local-key',
          secretAccessKey: 'synthetic-local-secret',
        },
        requestHandler: {
          connectionTimeout: 100,
          requestTimeout: timeout + 100,
        },
      };
      s3 = new S3Client({ ...sdk, forcePathStyle: true });
      bedrock = new BedrockRuntimeClient({
        ...sdk,
        endpoint: embeddingEndpoint,
      });
      const storage = new StorageService(config);
      const embedding = new EmbeddingService(config);
      embeddingService = embedding;
      Object.defineProperty(storage, 's3Client', { value: s3 });
      Object.defineProperty(embedding, 'bedrockClient', { value: bedrock });
      makeWorker = (db) => {
        const knowledge = new KnowledgeService(
          config,
          db as PrismaService,
          storage,
          new DocumentParserService(),
          new ChunkingService(),
          embedding,
        );
        return new ShortLeaseWorker(db as PrismaService, knowledge, config);
      };
      jobs = makeWorker(workerDb);
    }

    async function competingWorkers(connectionUrl = proxy.url) {
      for (let i = 0; i < 2; i++) {
        const db = new PrismaClient({
          adapter: new PrismaPg({
            connectionString: connectionUrl.toString(),
            application_name: 'network-e2e-worker',
            connectionTimeoutMillis: 300,
            max: 2,
          }),
        });
        replicas.push({ db, worker: makeWorker(db) });
        await db.$connect();
      }
      return [jobs, ...replicas.map(({ worker }) => worker)];
    }

    async function holdPartition(workers: ShortLeaseWorker[]) {
      // Keep the real sockets unavailable across three full test lease periods.
      const until = Date.now() + 3600;
      let rounds = 0;
      while (Date.now() < until) {
        const results = await Promise.allSettled(
          workers.map((worker) => worker.drain(appcode)),
        );
        expect(results.every((result) => result.status === 'rejected')).toBe(
          true,
        );
        rounds++;
        await pause(100);
      }
      expect(rounds).toBeGreaterThan(1);
    }

    beforeEach(async () => {
      fault = 'healthy';
      failService = 'embedding';
      onEmbedding = undefined;
      recoverAfterFirst = false;
      embeddingDelayMs = 0;
      wireCalls = 0;
      content = 'Original network fixture.';
      proxy.restore();
      services();
      const file = await control.knowledgeFile.create({
        data: {
          appcode,
          bucket: 'synthetic',
          key: `${appcode}/${randomUUID()}.txt`,
          originalName: 'network.txt',
          mimetype: 'text/plain',
          size: content.length,
          accessLevel: 'PUBLIC',
          businessStatus: 'PUBLISHED',
        },
      });
      fileId = file.id;
      const job = await jobs.submit(fileId, appcode, 'index');
      await jobs.drain(appcode);
      expect(
        (
          await control.knowledgeFile.findUniqueOrThrow({
            where: { id: fileId },
          })
        ).errorMessage,
      ).toBeNull();
      expect(await jobs.get(job.id, appcode)).toMatchObject({
        status: 'completed',
        attempt: 1,
      });
      wireCalls = 0;
      content = 'Replacement network fixture.';
    });

    afterEach(async () => {
      proxy.restore();
      onEmbedding = undefined;
      await jobs?.onModuleDestroy();
      for (const { db, worker } of replicas.splice(0)) {
        await worker.onModuleDestroy();
        await db.$disconnect();
      }
      for (const extraProxy of extraProxies.splice(0)) await extraProxy.close();
      s3?.destroy();
      bedrock?.destroy();
      upstream.closeAllConnections();
      for (const session of sessions) session.destroy();
      await control.knowledgeFile.deleteMany({ where: { appcode } });
      expect(activeAwsRequestCount()).toBe(0);
    });
    afterAll(async () => {
      await workerDb?.$disconnect();
      await control?.appInfo.deleteMany({ where: { appcode } });
      await control?.$disconnect();
      await proxy?.close();
      if (http2)
        await new Promise<void>((resolve) => http2.close(() => resolve()));
      if (upstream)
        await new Promise<void>((resolve) => upstream.close(() => resolve()));
    });
    const chunks = () =>
      control.knowledgeChunk.findMany({
        where: { fileId },
        orderBy: { chunkNo: 'asc' },
      });
    async function retryWhenDue(id: string) {
      const job = await jobs.get(id, appcode);
      await pause(
        Math.max(0, (job.nextAttemptAt?.getTime() ?? 0) - Date.now()) + 20,
      );
      await jobs.drain(appcode);
    }

    it.each<[Fault, 's3' | 'embedding', string]>([
      ['reset', 'embedding', 'UPSTREAM_TEMPORARILY_UNAVAILABLE'],
      ['stall', 'embedding', 'UPSTREAM_TIMEOUT'],
      ['partial-s3', 's3', 'UPSTREAM_TEMPORARILY_UNAVAILABLE'],
      ['stall', 's3', 'UPSTREAM_TIMEOUT'],
      ['503', 'embedding', 'UPSTREAM_TEMPORARILY_UNAVAILABLE'],
      ['429', 'embedding', 'UPSTREAM_THROTTLED'],
    ])(
      'recovers %s on %s through durable retry with the previous snapshot intact',
      async (mode, service, errorCode) => {
        const previous = await chunks();
        if (mode === '429') {
          // Adaptive client-side throttling can wait longer than the short socket deadline.
          await jobs.onModuleDestroy();
          s3.destroy();
          bedrock.destroy();
          services(1, 4000);
        }
        fault = mode;
        failService = service;
        const job = await jobs.submit(
          fileId,
          appcode,
          'reindex',
          'same-network-operation',
        );
        await jobs.drain(appcode);
        expect(await jobs.get(job.id, appcode)).toMatchObject({
          status: 'queued',
          attempt: 1,
          retryable: true,
          errorCode,
        });
        expect(await chunks()).toEqual(previous);
        expect(
          (
            await jobs.submit(
              fileId,
              appcode,
              'reindex',
              'same-network-operation',
            )
          ).id,
        ).toBe(job.id);
        fault = 'healthy';
        await retryWhenDue(job.id);
        expect(await jobs.get(job.id, appcode)).toMatchObject({
          status: 'completed',
          attempt: 2,
        });
        expect((await chunks())[0].content).toBe(content);
        expect((await chunks())[0].indexProvenance).not.toEqual(
          previous[0].indexProvenance,
        );
      },
    );

    it('stops a persistent wire 503 at the job attempt limit', async () => {
      const previous = await chunks();
      fault = '503';
      const job = await jobs.submit(fileId, appcode, 'reindex');
      await jobs.drain(appcode);
      await retryWhenDue(job.id);
      expect(await jobs.get(job.id, appcode)).toMatchObject({
        status: 'failed',
        attempt: 2,
      });
      const calls = wireCalls;
      await jobs.drain(appcode);
      expect(wireCalls).toBe(calls);
      expect(await chunks()).toEqual(previous);
      await expect(jobs.retry(job.id, appcode)).rejects.toThrow();
    });

    it('does not retry an actual SDK-deserialized 403', async () => {
      fault = '403';
      const job = await jobs.submit(fileId, appcode, 'reindex');
      await jobs.drain(appcode);
      expect(await jobs.get(job.id, appcode)).toMatchObject({
        status: 'failed',
        attempt: 1,
        retryable: false,
        errorCode: 'UPSTREAM_ACCESS_DENIED',
      });
      expect(wireCalls).toBe(1);
    });

    it('recovers an SDK retry inside one durable job attempt', async () => {
      await jobs.onModuleDestroy();
      s3.destroy();
      bedrock.destroy();
      services(2, 4000);
      fault = '503';
      recoverAfterFirst = true;
      const job = await jobs.submit(fileId, appcode, 'reindex');
      await jobs.drain(appcode);
      expect(await jobs.get(job.id, appcode)).toMatchObject({
        status: 'completed',
        attempt: 1,
      });
      expect(wireCalls).toBe(2);
    });

    const loadTest = process.env.RUN_NETWORK_LOAD_E2E === 'true' ? it : it.skip;
    const extendedLoad = process.env.RUN_EXTENDED_LOAD_E2E === 'true';
    const loadCases: [number, boolean, number][] = extendedLoad
      ? [1, 2, 3].flatMap((round): [number, boolean, number][] => [
          [3, false, round],
          [3, true, round],
        ])
      : [
          [1, false, 1],
          [3, false, 1],
          [1, true, 1],
          [3, true, 1],
        ];
    loadTest.each(loadCases)(
      'bounded load: %i workers, DB partition=%s, round=%i',
      async (workerCount, partition, round) => {
        const workers = workerCount === 1 ? [jobs] : await competingWorkers();
        const fileCount = extendedLoad ? 12 : 24;
        const document = (version: string) =>
          extendedLoad
            ? Array.from(
                { length: 320 },
                (_, i) =>
                  `${version} section ${i}: Synthetic inventory instructions include receipt checks, product identifiers, stock counts and return handling.`,
              ).join('\n')
            : `Load ${version} snapshot.`;
        embeddingDelayMs = 50;
        content = document('baseline');
        const files = await Promise.all(
          Array.from({ length: fileCount }, () =>
            control.knowledgeFile.create({
              data: {
                appcode,
                bucket: 'synthetic',
                key: `${appcode}/${randomUUID()}.txt`,
                originalName: 'load.txt',
                mimetype: 'text/plain',
                size: content.length,
                accessLevel: 'PUBLIC',
                businessStatus: 'PUBLISHED',
              },
            }),
          ),
        );
        const fileIds = files.map(({ id }) => id);
        await Promise.all(
          fileIds.map((id) => jobs.submit(id, appcode, 'index')),
        );
        await Promise.all(workers.map((worker) => worker.drain(appcode)));
        const snapshot = () =>
          control.knowledgeChunk.findMany({
            where: { fileId: { in: fileIds } },
            orderBy: [{ fileId: 'asc' }, { chunkNo: 'asc' }],
          });
        const baseline = await snapshot();
        expect(baseline.length).toBeGreaterThanOrEqual(fileCount);
        content = document('revision');
        const parsed = await new DocumentParserService().parse({
          body: Buffer.from(content),
          contentType: 'text/plain',
          fileName: 'load.txt',
        });
        const expectedChunks = new ChunkingService().createChunks(
          parsed.sections,
        );
        if (extendedLoad) expect(expectedChunks.length).toBeGreaterThan(10);
        const batch = await Promise.all(
          fileIds.map((id) =>
            jobs.submit(id, appcode, 'reindex', `load-${id}`),
          ),
        );
        const batchIds = batch.map(({ id }) => id);
        const batchState = () =>
          control.knowledgeIndexJob.findMany({
            where: { id: { in: batchIds } },
            orderBy: { id: 'asc' },
          });
        wireCalls = 0;
        let partitionStartedAt: number | null = null;
        let restoredAt: number | null = null;
        let interruptedJobs = 0;
        if (partition)
          onEmbedding = () => {
            if (partitionStartedAt !== null) return;
            partitionStartedAt = Date.now();
            proxy.cut();
          };
        const startedAt = Date.now();
        const sampler = await startLoadResourceSampler(control);
        let resources: Awaited<ReturnType<typeof sampler.stop>>;
        try {
          const firstDrains = await Promise.allSettled(
            workers.map((worker) => worker.drain(appcode)),
          );
          if (partition) {
            expect(partitionStartedAt).not.toBeNull();
            expect(
              firstDrains.some((result) => result.status === 'rejected'),
            ).toBe(true);
            await holdPartition(workers);
            expect(await snapshot()).toEqual(baseline);
            const interrupted = await batchState();
            interruptedJobs = interrupted.filter(
              ({ status }) => status === 'processing',
            ).length;
            expect(interruptedJobs).toBeGreaterThan(0);
            expect(interruptedJobs).toBeLessThanOrEqual(workerCount);
            expect(
              interrupted.every(
                ({ status, attempt }) =>
                  (status === 'processing' && attempt === 1) ||
                  (status === 'queued' && attempt === 0),
              ),
            ).toBe(true);
            onEmbedding = undefined;
            restoredAt = Date.now();
            proxy.restore();
            await Promise.all(workers.map((worker) => worker.drain(appcode)));
          } else {
            expect(
              firstDrains.every((result) => result.status === 'fulfilled'),
            ).toBe(true);
          }
        } finally {
          resources = await sampler.stop();
        }
        const finishedAt = Date.now();
        expect(resources.samples).toBeGreaterThan(1);
        expect(resources.peakWorkerConnections).toBeGreaterThan(0);
        expect(resources.peakWorkerConnections).toBeLessThanOrEqual(
          workerCount * 2,
        );
        const completed = await batchState();
        expect(completed).toHaveLength(fileCount);
        expect(
          completed.every(
            ({ status, leaseExpiresAt }) =>
              status === 'completed' && leaseExpiresAt === null,
          ),
        ).toBe(true);
        expect(completed.filter(({ attempt }) => attempt === 2)).toHaveLength(
          interruptedJobs,
        );
        expect(completed.reduce((sum, { attempt }) => sum + attempt, 0)).toBe(
          fileCount + interruptedJobs,
        );
        const latest = await snapshot();
        expect(latest).toHaveLength(fileCount * expectedChunks.length);
        expect(new Set(latest.map(({ fileId: id }) => id)).size).toBe(
          fileCount,
        );
        for (const chunk of latest) {
          expect(chunk.content).toBe(expectedChunks[chunk.chunkNo].content);
          expect(chunk.embedding).toEqual(vector);
          expect(chunk.indexProvenance).not.toEqual(
            baseline.find(({ fileId: id }) => id === chunk.fileId)!
              .indexProvenance,
          );
        }
        for (const id of fileIds) {
          expect(
            latest
              .filter((chunk) => chunk.fileId === id)
              .map(({ chunkNo }) => chunkNo),
          ).toEqual(expectedChunks.map((_, index) => index));
        }
        const calls = wireCalls;
        await Promise.all(workers.map((worker) => worker.drain(appcode)));
        expect(await snapshot()).toEqual(latest);
        expect(wireCalls).toBe(calls);
        const elapsedMs = finishedAt - startedAt;
        const recoveryMs = restoredAt === null ? null : finishedAt - restoredAt;
        // Generous local regression bound, not a production SLO.
        expect(recoveryMs ?? elapsedMs).toBeLessThan(
          extendedLoad ? 30000 : 15000,
        );
        const latencies = completed
          .map(({ completedAt }) => completedAt!.getTime() - startedAt)
          .sort((a, b) => a - b);
        const report = {
          schemaVersion: 2,
          round,
          extendedLoad,
          sourceBytesPerFile: Buffer.byteLength(content),
          chunksPerFile: expectedChunks.length,
          totalChunks: latest.length,
          resources,
          runId: loadRunId,
          scenario: partition ? 'partition' : 'healthy',
          workerCount,
          fileCount,
          processCount: 1,
          leaseMs: 1200,
          embeddingDelayMs,
          startedAt: new Date(startedAt).toISOString(),
          elapsedMs,
          partitionMs:
            restoredAt === null ? null : restoredAt - partitionStartedAt!,
          recoveryMs,
          batchJobsPerSecond: Number(
            ((fileCount * 1000) / elapsedMs).toFixed(2),
          ),
          completionFromBatchStartMs: {
            p50: latencies[Math.ceil(fileCount * 0.5) - 1],
            p95: latencies[Math.ceil(fileCount * 0.95) - 1],
            max: latencies.at(-1),
          },
          interruptedJobs,
          attempts: completed.reduce((sum, { attempt }) => sum + attempt, 0),
          embeddingCalls: calls,
          completed: completed.length,
          duplicateChunks: 0,
          localCompletionBoundMs: extendedLoad ? 30000 : 15000,
          passed: true,
        };
        const directory = resolve('outputs', 'network-load', loadRunId);
        await mkdir(directory, { recursive: true });
        await writeFile(
          resolve(directory, `${workerCount}-${report.scenario}-${round}.json`),
          JSON.stringify(report, null, 2) + '\n',
        );
      },
      60000,
    );

    it.each(['success', 'failure'] as const)(
      'preserves the new owner result after an isolated old owner delivers a late %s',
      async (outcome) => {
        const healthyProxy = await createTcpFaultProxy(
          new URL(process.env.DATABASE_URL!),
        );
        extraProxies.push(healthyProxy);
        const [, ...healthyWorkers] = await competingWorkers(healthyProxy.url);
        const previous = await chunks();
        content = 'Stale owner content must never replace the new snapshot.';
        const job = await jobs.submit(fileId, appcode, 'reindex');
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        let ready = false;
        let oldSignal: AbortSignal | undefined;
        const realEmbedding = embeddingService.createEmbedding.bind(
          embeddingService,
        ) as EmbeddingService['createEmbedding'];
        // Hold an already SDK-decoded response at the service boundary. This
        // deliberately models a dependency that finishes despite cancellation.
        const delayed = jest
          .spyOn(embeddingService, 'createEmbedding')
          .mockImplementationOnce(async (...args) => {
            oldSignal = args[2];
            const result = await realEmbedding(...args);
            ready = true;
            await gate;
            if (outcome === 'failure')
              throw new Error('Late old-owner failure');
            return result;
          });
        const oldDrain = jobs.drain(appcode);
        // Attach the rejection handler immediately, but also await it in finally.
        const settledOldDrain = oldDrain.catch(() => undefined);
        try {
          const deadline = Date.now() + 5000;
          while (!ready && Date.now() < deadline) await pause(20);
          expect(ready).toBe(true);
          proxy.cut();
          await Promise.all(
            healthyWorkers.map((worker) => worker.drain(appcode)),
          );
          const abandoned = await control.knowledgeIndexJob.findUniqueOrThrow({
            where: { id: job.id },
          });
          expect(abandoned).toMatchObject({ status: 'processing', attempt: 1 });
          expect(await chunks()).toEqual(previous);
          expect(wireCalls).toBe(1);
          await pause(
            Math.max(0, abandoned.leaseExpiresAt!.getTime() - Date.now()) + 150,
          );
          expect(oldSignal?.aborted).toBe(true);
          expect((oldSignal?.reason as Error).name).toBe(
            'KnowledgeIndexLeaseLostError',
          );
          content =
            'Newest owner snapshot survives every late old-owner result.';
          await Promise.all(
            healthyWorkers.map((worker) => worker.drain(appcode)),
          );
          const completed = await control.knowledgeIndexJob.findUniqueOrThrow({
            where: { id: job.id },
          });
          expect(completed).toMatchObject({ status: 'completed', attempt: 2 });
          const newest = await chunks();
          expect(newest).toHaveLength(1);
          expect(newest[0].content).toBe(content);
          expect(newest[0].embedding).toEqual(vector);
          expect(newest[0].indexProvenance).not.toEqual(
            previous[0].indexProvenance,
          );
          const newestFile = await control.knowledgeFile.findUniqueOrThrow({
            where: { id: fileId },
          });
          expect(newestFile).toMatchObject({
            status: 'indexed',
            errorMessage: null,
          });
          // The old worker regains DB access only after the new owner commits.
          proxy.restore();
          release();
          await oldDrain;
          expect(await chunks()).toEqual(newest);
          expect(
            await control.knowledgeFile.findUniqueOrThrow({
              where: { id: fileId },
            }),
          ).toEqual(newestFile);
          expect(await jobs.get(job.id, appcode)).toEqual(completed);
          expect(wireCalls).toBe(2);
        } finally {
          proxy.restore();
          release();
          await settledOldDrain;
          delayed.mockRestore();
        }
      },
      15000,
    );

    it('claims one recovery attempt across three workers after a multi-lease DB partition', async () => {
      const workers = await competingWorkers();
      const previous = await chunks();
      const job = await jobs.submit(
        fileId,
        appcode,
        'reindex',
        'partition-recovery',
      );
      onEmbedding = () => proxy.cut();
      await jobs.drain(appcode).catch(() => undefined);
      await holdPartition(workers);
      expect(await chunks()).toEqual(previous);
      expect(
        await control.knowledgeIndexJob.findUniqueOrThrow({
          where: { id: job.id },
        }),
      ).toMatchObject({ status: 'processing', attempt: 1 });
      expect(wireCalls).toBe(1);
      onEmbedding = undefined;
      proxy.restore();
      await Promise.all(workers.map((worker) => worker.drain(appcode)));
      expect(await jobs.get(job.id, appcode)).toMatchObject({
        status: 'completed',
        attempt: 2,
        leaseExpiresAt: null,
      });
      const recovered = await chunks();
      expect(recovered).toHaveLength(1);
      expect(recovered[0].content).toBe(content);
      expect(recovered[0].embedding).toEqual(vector);
      expect(recovered[0].indexProvenance).not.toEqual(
        previous[0].indexProvenance,
      );
      expect(wireCalls).toBe(2);
      const submissions = await Promise.all(
        workers.map((worker) =>
          worker.submit(fileId, appcode, 'reindex', 'partition-recovery'),
        ),
      );
      expect(submissions.every(({ id }) => id === job.id)).toBe(true);
      await Promise.all(workers.map((worker) => worker.drain(appcode)));
      expect(await chunks()).toEqual(recovered);
      expect(wireCalls).toBe(2);
    }, 20000);

    it('exhausts repeated DB partitions without a third attempt across competing workers', async () => {
      const workers = await competingWorkers();
      const previous = await chunks();
      const job = await jobs.submit(fileId, appcode, 'reindex');
      onEmbedding = () => proxy.cut();
      for (const attempt of [1, 2]) {
        proxy.restore();
        await Promise.allSettled(
          workers.map((worker) => worker.drain(appcode)),
        );
        await holdPartition(workers);
        expect(
          await control.knowledgeIndexJob.findUniqueOrThrow({
            where: { id: job.id },
          }),
        ).toMatchObject({ status: 'processing', attempt });
        expect(await chunks()).toEqual(previous);
        expect(wireCalls).toBe(attempt);
      }
      onEmbedding = undefined;
      proxy.restore();
      await Promise.all(workers.map((worker) => worker.drain(appcode)));
      expect(await jobs.get(job.id, appcode)).toMatchObject({
        status: 'failed',
        attempt: 2,
        retryable: false,
        errorCode: 'INDEX_LEASE_EXPIRED',
        leaseExpiresAt: null,
      });
      await expect(jobs.retry(job.id, appcode)).rejects.toThrow();
      await Promise.all(workers.map((worker) => worker.drain(appcode)));
      expect(wireCalls).toBe(2);
      expect(await chunks()).toEqual(previous);
    }, 30000);

    it('replaces an already committed index without duplicates after COMMIT response loss', async () => {
      const previous = await chunks();
      const dropsBefore = proxy.droppedCommitResponses;
      const job = await jobs.submit(fileId, appcode, 'reindex', 'commit-loss');
      onEmbedding = () => {
        onEmbedding = undefined;
        proxy.dropNextCommitResponse();
      };
      await jobs.drain(appcode).catch(() => undefined);
      expect(proxy.droppedCommitResponses).toBe(dropsBefore + 1);
      // A separate direct connection observes durable data while all worker
      // connections are still blocked and the COMMIT response was withheld.
      const committed = await chunks();
      expect(committed).toHaveLength(1);
      expect(committed[0].content).toBe(content);
      expect(committed[0].id).not.toBe(previous[0].id);
      expect(committed[0].indexProvenance).not.toEqual(
        previous[0].indexProvenance,
      );
      expect(
        await control.knowledgeFile.findUniqueOrThrow({
          where: { id: fileId },
        }),
      ).toMatchObject({ status: 'indexed', errorMessage: null });
      const abandoned = await control.knowledgeIndexJob.findUniqueOrThrow({
        where: { id: job.id },
      });
      expect(abandoned).toMatchObject({ status: 'processing', attempt: 1 });
      expect(abandoned.leaseExpiresAt).not.toBeNull();
      await pause(
        Math.max(0, abandoned.leaseExpiresAt!.getTime() - Date.now()) + 50,
      );
      proxy.restore();
      expect(
        (await jobs.submit(fileId, appcode, 'reindex', 'commit-loss')).id,
      ).toBe(job.id);
      await jobs.drain(appcode);
      expect(await jobs.get(job.id, appcode)).toMatchObject({
        status: 'completed',
        attempt: 2,
        leaseExpiresAt: null,
      });
      const recovered = await chunks();
      expect(recovered).toHaveLength(1);
      expect(recovered[0].content).toBe(content);
      expect(recovered[0].embedding).toEqual(vector);
      expect(recovered[0].id).not.toBe(committed[0].id);
      expect(recovered[0].indexProvenance).not.toEqual(
        committed[0].indexProvenance,
      );
      expect(wireCalls).toBe(2);
      await jobs.drain(appcode);
      expect(await chunks()).toEqual(recovered);
      expect(wireCalls).toBe(2);
    }, 15000);

    it('recovers after real DB connections are severed during indexing and the lease expires', async () => {
      const previous = await chunks();
      const job = await jobs.submit(fileId, appcode, 'reindex');
      onEmbedding = () => proxy.cut();
      await jobs.drain(appcode).catch(() => undefined);
      expect(await chunks()).toEqual(previous);
      const abandoned = await control.knowledgeIndexJob.findUniqueOrThrow({
        where: { id: job.id },
      });
      expect(abandoned).toMatchObject({ status: 'processing', attempt: 1 });
      expect(abandoned.leaseExpiresAt).not.toBeNull();
      // Real clock expiry with a short test-only lease; no row timestamp edits.
      await pause(
        Math.max(0, abandoned.leaseExpiresAt!.getTime() - Date.now()) + 50,
      );
      onEmbedding = undefined;
      proxy.restore();
      await jobs.drain(appcode);
      expect(await jobs.get(job.id, appcode)).toMatchObject({
        status: 'completed',
        attempt: 2,
        leaseExpiresAt: null,
      });
      expect((await chunks())[0].content).toBe(content);
    }, 15000);
  },
);
