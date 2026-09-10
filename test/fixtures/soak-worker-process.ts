import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaService } from '../../src/prisma/prisma.service';
import { KnowledgeService } from '../../src/knowledge/knowledge.service';
import { KnowledgeIndexJobService } from '../../src/knowledge/knowledge-index-job.service';
import { StorageService } from '../../src/storage/storage.service';
import { EmbeddingService } from '../../src/knowledge/embedding.service';
import { DocumentParserService } from '../../src/knowledge/document-parser.service';
import { ChunkingService } from '../../src/knowledge/chunking.service';

export const soakText = Array.from(
  { length: 320 },
  (_, i) =>
    `revision section ${i}: Synthetic inventory instructions include receipt checks, product identifiers, stock counts and return handling.`,
).join('\n');

async function main() {
  const target = new URL(process.env.DATABASE_URL!);
  if (
    !/^\/queue_e2e_[a-f0-9]{32}$/.test(target.pathname) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) ||
    !process.send
  )
    throw new Error('Soak worker requires IPC and an isolated local database.');
  const db = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: target.toString(),
      max: 2,
      application_name: 'soak-worker',
      connectionTimeoutMillis: 1000,
    }),
  });
  const config = new ConfigService({ KNOWLEDGE_INDEX_WORKER_ENABLED: 'true' });
  // Synthetic dependency adapters: production parsing, indexing, transactions,
  // polling, heartbeat and the default five-minute lease remain in use.
  const storage = {
    downloadFileBuffer: () =>
      Promise.resolve({
        body: Buffer.from(soakText),
        contentType: 'text/plain',
      }),
  } as unknown as StorageService;
  const embedding = {
    getDefaultEmbeddingModelId: () => 'synthetic-soak-vector',
    createEmbedding: async (
      _text: string,
      _model: string,
      signal?: AbortSignal,
    ) => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      signal?.throwIfAborted();
      return Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0));
    },
  } as unknown as EmbeddingService;
  const knowledge = new KnowledgeService(
    config,
    db as PrismaService,
    storage,
    new DocumentParserService(),
    new ChunkingService(),
    embedding,
  );
  const original = knowledge.indexKnowledgeFile.bind(
    knowledge,
  ) as KnowledgeService['indexKnowledgeFile'];
  knowledge.indexKnowledgeFile = (...args) => {
    process.send?.({ type: 'started', pid: process.pid, jobId: args[3]?.id });
    return original(...args);
  };
  const worker = new KnowledgeIndexJobService(
    db as PrismaService,
    knowledge,
    config,
  );
  let cpu = process.cpuUsage();
  let sampledAt = performance.now();
  const sample = () => {
    const now = performance.now();
    const usage = process.cpuUsage(cpu);
    cpu = process.cpuUsage();
    const memory = process.memoryUsage();
    process.send?.({
      type: 'sample',
      pid: process.pid,
      at: Date.now(),
      rss: memory.rss,
      heapUsed: memory.heapUsed,
      cpuUserMs: usage.user / 1000,
      cpuSystemMs: usage.system / 1000,
      intervalMs: now - sampledAt,
    });
    sampledAt = now;
  };
  const timer = setInterval(sample, 1000);
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    clearInterval(timer);
    await worker.onModuleDestroy();
    await db.$disconnect();
    sample();
    process.disconnect();
  };
  process.on('message', (message: unknown) => {
    if (message === 'shutdown') void stop();
  });
  process.on('disconnect', () => {
    void stop();
  });
  await db.$connect();
  await worker.onModuleInit();
  sample();
  process.send?.({
    type: 'ready',
    pid: process.pid,
    runtime: __filename.endsWith('.js') ? 'compiled' : 'ts-node',
  });
}
if (process.env.RUN_MULTIPROCESS_SOAK === 'true' && process.send) {
  void main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
