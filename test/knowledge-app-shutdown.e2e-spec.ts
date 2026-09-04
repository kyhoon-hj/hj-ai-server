import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { KnowledgeService } from '../src/knowledge/knowledge.service';
import { KnowledgeIndexJobService } from '../src/knowledge/knowledge-index-job.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { runAwsRequest } from '../src/common/aws/aws-request-control';

const suite =
  process.env.RUN_QUEUE_HTTP_E2E === 'true' ? describe : describe.skip;
suite('Full AppModule shutdown ordering (isolated PostgreSQL)', () => {
  it('persists the interrupted job before disconnecting Prisma and closes HTTP', async () => {
    expect(new URL(process.env.DATABASE_URL!).pathname).toMatch(
      /^\/queue_e2e_[a-f0-9]{32}$/,
    );
    const observer = new PrismaService();
    await observer.$connect();
    let started!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const index = jest.fn(() =>
      runAwsRequest(
        (signal) =>
          new Promise<void>((_resolve, reject) => {
            signal.addEventListener(
              'abort',
              () =>
                reject(
                  Object.assign(new Error('shutdown fixture'), {
                    name: 'AbortError',
                  }),
                ),
              { once: true },
            );
            started();
          }),
        { timeoutMs: 30000 },
      ),
    );
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(KnowledgeService)
      .useValue({ indexKnowledgeFile: index })
      .compile();
    const app = module.createNestApplication();
    const appcode = 'APP_SHUTDOWN';
    let disconnectSpy: jest.SpyInstance | undefined;
    try {
      await app.listen(0, '127.0.0.1');
      const prisma = app.get(PrismaService);
      await observer.appInfo.create({
        data: { appcode, appname: 'App shutdown' },
      });
      const file = await observer.knowledgeFile.create({
        data: {
          appcode,
          bucket: 'unused',
          key: 'shutdown-fixture',
          originalName: 'fixture.txt',
          mimetype: 'text/plain',
          size: 1,
        },
      });
      const job = await app
        .get(KnowledgeIndexJobService)
        .submit(file.id, appcode, 'index');
      await entered;
      const disconnect = prisma.$disconnect.bind(prisma) as () => Promise<void>;
      disconnectSpy = jest
        .spyOn(prisma, '$disconnect')
        .mockImplementation(async () => {
          expect(
            await observer.knowledgeIndexJob.findUnique({
              where: { id: job.id },
            }),
          ).toMatchObject({
            status: 'queued',
            attempt: 1,
            leaseExpiresAt: null,
            errorCode: 'UPSTREAM_TIMEOUT',
          });
          await disconnect();
        });
      await app.close();
      expect(disconnectSpy).toHaveBeenCalledTimes(1);
      expect(index).toHaveBeenCalledTimes(1);
      expect((app.getHttpServer() as { listening: boolean }).listening).toBe(
        false,
      );
    } finally {
      disconnectSpy?.mockRestore();
      await app.close();
      await observer.knowledgeFile.deleteMany({ where: { appcode } });
      await observer.appInfo.deleteMany({ where: { appcode } });
      await observer.$disconnect();
    }
  }, 15000);
});
