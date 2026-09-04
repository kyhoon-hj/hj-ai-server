import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../src/prisma/prisma.service';
import { KnowledgeIndexJobService } from '../../src/knowledge/knowledge-index-job.service';
import { runAwsRequest } from '../../src/common/aws/aws-request-control';

async function main() {
  const url = new URL(process.env.DATABASE_URL!);
  if (
    process.env.RUN_QUEUE_HTTP_E2E !== 'true' ||
    !/^\/queue_e2e_[a-f0-9]{32}$/.test(url.pathname)
  )
    throw new Error('Isolated database required');
  const prisma = new PrismaService();
  await prisma.$connect();
  const worker = new KnowledgeIndexJobService(
    prisma,
    {
      indexKnowledgeFile: (fileId: string) => {
        if (process.env.QUEUE_PROCESS_MODE === 'hold') {
          return runAwsRequest(
            (signal) =>
              new Promise<void>((_resolve, reject) => {
                signal.addEventListener(
                  'abort',
                  () =>
                    reject(
                      Object.assign(new Error('Worker shutdown'), {
                        name: 'AbortError',
                      }),
                    ),
                  { once: true },
                );
                process.send?.({ type: 'started', fileId });
              }),
            { timeoutMs: 60000 },
          );
        }
        process.send?.({ type: 'started', fileId });
        return Promise.resolve();
      },
    } as never,
    new ConfigService({
      ...process.env,
      KNOWLEDGE_INDEX_WORKER_ENABLED: 'true',
    }),
  );
  let closing = false;
  process.on('message', (message: unknown) => {
    if (message !== 'shutdown' || closing) return;
    closing = true;
    void (async () => {
      await worker.onModuleDestroy();
      await prisma.$disconnect();
      process.disconnect?.();
    })().catch(() => process.exit(1));
  });
  await worker.onModuleInit();
  process.send?.({ type: 'ready' });
}
void main().catch(() => process.exit(1));
