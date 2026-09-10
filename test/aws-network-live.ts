import { randomUUID } from 'node:crypto';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Agent } from 'node:https';
import { connect as tlsConnect } from 'node:tls';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { PrismaService } from '../src/prisma/prisma.service';
import { StorageService } from '../src/storage/storage.service';
import { EmbeddingService } from '../src/knowledge/embedding.service';
import { DocumentParserService } from '../src/knowledge/document-parser.service';
import { ChunkingService } from '../src/knowledge/chunking.service';
import { KnowledgeService } from '../src/knowledge/knowledge.service';
import { KnowledgeIndexJobService } from '../src/knowledge/knowledge-index-job.service';
import { createAwsTlsRelay } from './fixtures/aws-tls-relay';
import { cleanupAwsNetworkObject } from './fixtures/aws-network-cleanup';

const suite =
  process.env.RUN_AWS_NETWORK_E2E === 'true' ? describe : describe.skip;
void suite(
  'Live AWS TLS connection fault recovery (opt-in, isolated DB)',
  () => {
    const runId = randomUUID();
    const appcode = `aws-network-${runId}`;
    const key = `${appcode}/synthetic.txt`;
    const content =
      'Synthetic cobalt kettle returns are accepted within 17 days with a receipt.';
    let prisma: PrismaService;
    let jobs: KnowledgeIndexJobService;
    let s3: S3Client;
    let embeddingClient: BedrockRuntimeClient;
    let s3Relay: Awaited<ReturnType<typeof createAwsTlsRelay>>;
    let bedrockRelay: Awaited<ReturnType<typeof createAwsTlsRelay>>;
    let fileId: string;
    let bucket: string;
    let cleanupClient: S3Client;
    let embeddingAttempts = 0;
    let wireFailure: object | null = null;
    const results: object[] = [];
    const startedAt = Date.now();
    let cleanupSucceeded = false;

    before(
      async () => {
        const database = new URL(process.env.DATABASE_URL!);
        assert.ok(
          ['localhost', '127.0.0.1', '[::1]'].includes(database.hostname),
        );
        assert.match(database.pathname, /^\/queue_e2e_[a-f0-9]{32}$/);
        assert.deepEqual(
          Object.keys(process.env).filter(
            (k) => k.startsWith('AWS_ENDPOINT_URL') && process.env[k],
          ),
          [],
        );
        assert.notEqual(process.env.NODE_TLS_REJECT_UNAUTHORIZED, '0');
        bucket = process.env.AWS_S3_BUCKET!;
        const region = process.env.AWS_REGION!;
        const s3Region = process.env.AWS_S3_REGION ?? region;
        assert.ok(bucket);
        assert.equal(
          process.env.BEDROCK_EMBEDDING_MODEL_ID,
          'amazon.titan-embed-text-v2:0',
        );
        const s3Host = `s3.${s3Region}.amazonaws.com`;
        const bedrockHost = `bedrock-runtime.${region}.amazonaws.com`;
        s3Relay = await createAwsTlsRelay(s3Host);
        bedrockRelay = await createAwsTlsRelay(bedrockHost);
        const agent = new Agent({ keepAlive: false });
        agent.createConnection = () =>
          tlsConnect({
            host: '127.0.0.1',
            port: s3Relay.port,
            servername: s3Host,
            rejectUnauthorized: true,
            ALPNProtocols: ['http/1.1'],
          });
        s3 = new S3Client({
          region: s3Region,
          endpoint: `https://${s3Host}`,
          forcePathStyle: true,
          maxAttempts: 1,
          requestHandler: {
            httpsAgent: agent,
            connectionTimeout: 8000,
            requestTimeout: 8000,
          },
        });
        cleanupClient = new S3Client({
          region: s3Region,
          endpoint: `https://${s3Host}`,
          forcePathStyle: true,
          maxAttempts: 2,
          requestHandler: { connectionTimeout: 5000, requestTimeout: 10000 },
        });
        s3.middlewareStack.add(
          (next) => async (args) => {
            try {
              return await next(args);
            } catch (error) {
              const record = error as {
                name?: string;
                code?: string;
                cause?: { name?: string; code?: string };
              };
              wireFailure = {
                name: record.name,
                code: record.code,
                causeName: record.cause?.name,
                causeCode: record.cause?.code,
              };
              throw error;
            }
          },
          { name: 'wireFailureEvidence', step: 'initialize' },
        );
        embeddingClient = new BedrockRuntimeClient({
          region,
          endpoint: `https://${bedrockHost}`,
          maxAttempts: 1,
          requestHandler: {
            requestTimeout: 8000,
            sessionTimeout: 10000,
            disableConcurrentStreams: true,
            nodeHttp2ConnectOptions: {
              createConnection: () =>
                tlsConnect({
                  host: '127.0.0.1',
                  port: bedrockRelay.port,
                  servername: bedrockHost,
                  rejectUnauthorized: true,
                  ALPNProtocols: ['h2'],
                }),
            },
          },
        });
        embeddingClient.middlewareStack.add(
          (next) => async (args) => {
            if (++embeddingAttempts > 4)
              throw new Error('Live embedding request budget exceeded');
            return next(args);
          },
          { name: 'liveRequestBudget', step: 'initialize' },
        );
        prisma = new PrismaService();
        await prisma.$connect();
        const config = new ConfigService({
          ...process.env,
          AWS_REQUEST_TIMEOUT_MS: '8000',
          KNOWLEDGE_INDEX_WORKER_ENABLED: 'false',
          KNOWLEDGE_INDEX_MAX_ATTEMPTS: '2',
          KNOWLEDGE_INDEX_RETRY_DELAY_MS: '100',
          KNOWLEDGE_EMBEDDING_CONCURRENCY: '1',
        });
        const storage = new StorageService(config);
        const embedding = new EmbeddingService(config);
        Object.defineProperty(storage, 's3Client', { value: s3 });
        Object.defineProperty(embedding, 'bedrockClient', {
          value: embeddingClient,
        });
        const knowledge = new KnowledgeService(
          config,
          prisma,
          storage,
          new DocumentParserService(),
          new ChunkingService(),
          embedding,
        );
        jobs = new KnowledgeIndexJobService(prisma, knowledge, config);
        await prisma.appInfo.create({
          data: {
            appcode,
            appname: 'Synthetic AWS network recovery',
            defaultEmbeddingModelId: process.env.BEDROCK_EMBEDDING_MODEL_ID,
          },
        });
        fileId = (
          await prisma.knowledgeFile.create({
            data: {
              appcode,
              bucket,
              key,
              originalName: 'synthetic.txt',
              mimetype: 'text/plain',
              size: Buffer.byteLength(content),
            },
          })
        ).id;
        await s3.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: content,
            ContentType: 'text/plain',
          }),
          { abortSignal: AbortSignal.timeout(12000) },
        );
        const job = await jobs.submit(fileId, appcode, 'index');
        await jobs.drain(appcode);
        assert.partialDeepStrictEqual(await jobs.get(job.id, appcode), {
          status: 'completed',
          attempt: 1,
        });
      },
      { timeout: 60000 },
    );

    for (const scenario of ['s3-cut', 'bedrock-stall'])
      void it(
        `recovers ${scenario} while retaining the last successful index`,
        { timeout: 45000 },
        async () => {
          const previous = await prisma.knowledgeChunk.findMany({
            where: { fileId },
          });
          assert.equal(previous.length, 1);
          const relay = scenario === 's3-cut' ? s3Relay : bedrockRelay;
          const faultCount = relay.stats.faults;
          relay.setMode(scenario === 's3-cut' ? 'cut' : 'stall');
          const job = await jobs.submit(fileId, appcode, 'reindex', scenario);
          const begin = Date.now();
          try {
            await jobs.drain(appcode);
            const failed = await jobs.get(job.id, appcode);
            if (!failed.retryable)
              console.log(
                JSON.stringify({
                  scenario,
                  errorCode: failed.errorCode,
                  wireFailure,
                }),
              );
            assert.partialDeepStrictEqual(failed, {
              status: 'queued',
              attempt: 1,
              retryable: true,
            });
            assert.ok(relay.stats.faults > faultCount);
            assert.deepEqual(
              await prisma.knowledgeChunk.findMany({ where: { fileId } }),
              previous,
            );
            assert.equal(
              (await jobs.submit(fileId, appcode, 'reindex', scenario)).id,
              job.id,
            );
            relay.setMode('healthy');
            await new Promise((r) =>
              setTimeout(
                r,
                Math.max(0, failed.nextAttemptAt!.getTime() - Date.now()) + 30,
              ),
            );
            await jobs.drain(appcode);
            assert.partialDeepStrictEqual(await jobs.get(job.id, appcode), {
              status: 'completed',
              attempt: 2,
            });
            const updated = await prisma.knowledgeChunk.findMany({
              where: { fileId },
            });
            assert.equal(updated.length, 1);
            assert.equal(updated[0].content, content);
            assert.equal(updated[0].embedding.length, 1024);
            assert.notEqual(updated[0].id, previous[0].id);
            results.push({
              scenario,
              passed: true,
              errorCode: failed.errorCode,
              attempt: 2,
              elapsedMs: Date.now() - begin,
            });
          } finally {
            relay.setMode('healthy');
          }
        },
      );

    after(
      async () => {
        try {
          await jobs?.onModuleDestroy();
          // Bypass the fault relays for cleanup; delete only this run's random key.
          if (cleanupClient) {
            await cleanupAwsNetworkObject(cleanupClient, bucket, key);
            cleanupSucceeded = true;
          }
        } finally {
          s3?.destroy();
          embeddingClient?.destroy();
          cleanupClient?.destroy();
          await s3Relay?.close();
          await bedrockRelay?.close();
          await prisma?.$disconnect();
          const directory = resolve('outputs/aws-network');
          await mkdir(directory, { recursive: true });
          await writeFile(
            resolve(directory, `${runId}.json`),
            JSON.stringify(
              {
                runId,
                results,
                embeddingAttempts,
                s3: s3Relay?.stats,
                bedrock: bedrockRelay?.stats,
                cleanupSucceeded,
                elapsedMs: Date.now() - startedAt,
              },
              null,
              2,
            ),
          );
          console.log(
            JSON.stringify({
              runId,
              results,
              embeddingAttempts,
              cleanupSucceeded,
            }),
          );
        }
      },
      { timeout: 30000 },
    );
  },
);
