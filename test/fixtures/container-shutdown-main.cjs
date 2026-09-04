// Mounted in place of dist/src/main.js for the isolated Docker signal test only.
require('reflect-metadata');
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('/app/dist/src/app.module');
const { KnowledgeModule } = require('/app/dist/src/knowledge/knowledge.module');
const {
  KnowledgeService,
} = require('/app/dist/src/knowledge/knowledge.service');
const { PrismaService } = require('/app/dist/src/prisma/prisma.service');
const {
  runAwsRequest,
} = require('/app/dist/src/common/aws/aws-request-control');

async function main() {
  const url = new URL(process.env.DATABASE_URL);
  if (
    process.env.RUN_QUEUE_HTTP_E2E !== 'true' ||
    !/^\/queue_e2e_[a-f0-9]{32}$/.test(url.pathname)
  )
    throw new Error('Isolated database required');
  const providers = Reflect.getMetadata('providers', KnowledgeModule);
  Reflect.defineMetadata(
    'providers',
    providers.map((provider) =>
      provider === KnowledgeService
        ? {
            provide: KnowledgeService,
            useValue: {
              indexKnowledgeFile: () =>
                runAwsRequest(
                  (signal) =>
                    new Promise((_resolve, reject) => {
                      signal.addEventListener(
                        'abort',
                        () =>
                          reject(
                            Object.assign(new Error('Shutdown fixture'), {
                              name: 'AbortError',
                            }),
                          ),
                        { once: true },
                      );
                      console.log('DOCKER_SHUTDOWN_JOB_STARTED');
                    }),
                  { timeoutMs: 90000 },
                ),
            },
          }
        : provider,
    ),
    KnowledgeModule,
  );
  const app = await NestFactory.create(AppModule, { logger: false });
  app.enableShutdownHooks();
  const prisma = app.get(PrismaService);
  await prisma.$connect();
  const appcode = 'DOCKER_SHUTDOWN';
  await prisma.appInfo.create({
    data: { appcode, appname: 'Docker shutdown test' },
  });
  for (let i = 0; i < 2; i++) {
    const file = await prisma.knowledgeFile.create({
      data: {
        appcode,
        bucket: 'unused',
        key: `fixture-${i}`,
        originalName: 'test.txt',
        mimetype: 'text/plain',
        size: 1,
      },
    });
    await prisma.knowledgeIndexJob.create({
      data: {
        appcode,
        fileId: file.id,
        operation: 'index',
        requestedAt: new Date(Date.now() + i * 1000),
      },
    });
  }
  await app.listen(11000, '0.0.0.0');
  console.log('DOCKER_SHUTDOWN_HTTP_READY');
}
void main().catch(() => {
  console.error('Docker shutdown fixture failed');
  process.exit(1);
});
