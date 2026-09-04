import { BadRequestException, ConflictException } from '@nestjs/common';
import { KnowledgeIndexJobService } from './knowledge-index-job.service';
import { runAwsRequest } from '../common/aws/aws-request-control';

function lastMockArgument(mock: jest.Mock): unknown {
  return (mock.mock.calls as unknown[][]).at(-1)?.[0];
}

function firstMockArgument(mock: jest.Mock): unknown {
  return (mock.mock.calls as unknown[][])[0]?.[0];
}

function createFixture(workerEnabled = false) {
  const prisma = {
    $executeRaw: jest.fn().mockResolvedValue(0),
    knowledgeFile: { findFirst: jest.fn() },
    knowledgeIndexJob: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    appInfo: { findUnique: jest.fn() },
  };
  const knowledgeService = { indexKnowledgeFile: jest.fn() };
  const configService = {
    get: jest.fn().mockReturnValue(workerEnabled ? 'true' : 'false'),
  };
  const service = new KnowledgeIndexJobService(
    prisma as never,
    knowledgeService as never,
    configService as never,
  );
  return { service, prisma, knowledgeService };
}

const queuedJob = {
  id: '11111111-1111-4111-8111-111111111111',
  fileId: '22222222-2222-4222-8222-222222222222',
  appcode: 'STORE_A',
  operation: 'index',
  status: 'queued',
  attempt: 0,
  maxAttempts: 3,
  idempotencyKey: 'request-1',
  retryable: false,
  nextAttemptAt: null,
};

describe('KnowledgeIndexJobService', () => {
  it('rejects new submissions/retries and does not drain after shutdown', async () => {
    const { service, prisma } = createFixture();
    await service.onModuleDestroy();
    await expect(
      service.submit(queuedJob.fileId, 'STORE_A', 'index'),
    ).rejects.toMatchObject({ status: 503 });
    await expect(service.retry(queuedJob.id, 'STORE_A')).rejects.toMatchObject({
      status: 503,
    });
    await service.drain();
    expect(prisma.knowledgeIndexJob.findFirst).not.toHaveBeenCalled();
    expect(prisma.knowledgeIndexJob.create).not.toHaveBeenCalled();
  });

  it('returns a claim acquired during shutdown without consuming an attempt', async () => {
    const { service, prisma, knowledgeService } = createFixture();
    prisma.knowledgeIndexJob.findFirst.mockResolvedValueOnce(queuedJob);
    let release!: (value: { count: number }) => void;
    prisma.knowledgeIndexJob.updateMany.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    prisma.knowledgeIndexJob.findUnique.mockResolvedValue({
      ...queuedJob,
      status: 'processing',
      attempt: 1,
    });
    const drain = service.drain();
    await new Promise((resolve) => setImmediate(resolve));
    const shutdown = service.onModuleDestroy();
    release({ count: 1 });
    await Promise.all([drain, shutdown]);
    expect(knowledgeService.indexKnowledgeFile).not.toHaveBeenCalled();
    expect(lastMockArgument(prisma.knowledgeIndexJob.updateMany)).toMatchObject(
      {
        data: {
          status: 'queued',
          attempt: { decrement: 1 },
          leaseExpiresAt: null,
        },
      },
    );
  });

  it('returns the same job for an identical idempotent submission', async () => {
    const { service, prisma } = createFixture();
    prisma.knowledgeFile.findFirst.mockResolvedValue({
      id: queuedJob.fileId,
      status: 'uploaded',
    });
    prisma.knowledgeIndexJob.findUnique.mockResolvedValue(queuedJob);
    await expect(
      service.submit(queuedJob.fileId, 'STORE_A', 'index', 'request-1'),
    ).resolves.toBe(queuedJob);
    expect(prisma.knowledgeIndexJob.create).not.toHaveBeenCalled();
  });

  it('rejects an idempotency key reused for a different operation', async () => {
    const { service, prisma } = createFixture();
    prisma.knowledgeFile.findFirst.mockResolvedValue({
      id: queuedJob.fileId,
      status: 'uploaded',
    });
    prisma.knowledgeIndexJob.findUnique.mockResolvedValue(queuedJob);
    await expect(
      service.submit(queuedJob.fileId, 'STORE_A', 'reindex', 'request-1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('requeues only a failed job below its retry limit', async () => {
    const { service, prisma } = createFixture();
    const failed = {
      ...queuedJob,
      status: 'failed',
      attempt: 1,
      retryable: true,
    };
    prisma.knowledgeIndexJob.findFirst.mockResolvedValue(failed);
    prisma.knowledgeIndexJob.update.mockResolvedValue({
      ...failed,
      status: 'queued',
    });
    await expect(service.retry(failed.id, 'STORE_A')).resolves.toMatchObject({
      status: 'queued',
    });
    const retryUpdate = lastMockArgument(prisma.knowledgeIndexJob.update);
    expect(retryUpdate).toMatchObject({
      data: { status: 'queued', errorMessage: null },
    });

    prisma.knowledgeIndexJob.findFirst.mockResolvedValue({
      ...failed,
      attempt: 3,
      maxAttempts: 3,
    });
    await expect(service.retry(failed.id, 'STORE_A')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects manual retry for a permanent failure', async () => {
    const { service, prisma } = createFixture();
    prisma.knowledgeIndexJob.findFirst.mockResolvedValue({
      ...queuedJob,
      status: 'failed',
      attempt: 1,
      retryable: false,
    });
    await expect(service.retry(queuedJob.id, 'STORE_A')).rejects.toThrow(
      /영구 실패/,
    );
    expect(prisma.knowledgeIndexJob.update).not.toHaveBeenCalled();
  });

  it('claims a queued job and records completion after indexing', async () => {
    const { service, prisma, knowledgeService } = createFixture(true);
    prisma.knowledgeIndexJob.findFirst
      .mockResolvedValueOnce(queuedJob)
      .mockResolvedValueOnce(null);
    prisma.knowledgeIndexJob.updateMany.mockResolvedValue({ count: 1 });
    prisma.knowledgeIndexJob.findUnique.mockResolvedValue({
      ...queuedJob,
      status: 'processing',
      attempt: 1,
    });
    prisma.appInfo.findUnique.mockResolvedValue({
      appcode: 'STORE_A',
      defaultEmbeddingModelId: 'embed-model',
    });
    knowledgeService.indexKnowledgeFile.mockResolvedValue({
      status: 'indexed',
      chunkCount: 1,
    });
    prisma.knowledgeIndexJob.update.mockResolvedValue({
      ...queuedJob,
      status: 'completed',
    });

    await service.drain('STORE_A');

    const claimQuery = firstMockArgument(prisma.knowledgeIndexJob.findFirst);
    expect(claimQuery).toMatchObject({ where: { appcode: 'STORE_A' } });
    expect(knowledgeService.indexKnowledgeFile).toHaveBeenCalledWith(
      queuedJob.fileId,
      { appcode: 'STORE_A', defaultEmbeddingModelId: 'embed-model' },
      expect.any(AbortSignal),
      { id: queuedJob.id, attempt: 1 },
    );
    const completedUpdate = lastMockArgument(
      prisma.knowledgeIndexJob.updateMany,
    );
    expect(completedUpdate).toMatchObject({
      where: { id: queuedJob.id },
      data: { status: 'completed', leaseExpiresAt: null },
    });
  });

  it('automatically requeues a retryable timeout below the attempt limit', async () => {
    const { service, prisma, knowledgeService } = createFixture(true);
    prisma.knowledgeIndexJob.findFirst
      .mockResolvedValueOnce(queuedJob)
      .mockResolvedValueOnce(null);
    prisma.knowledgeIndexJob.updateMany.mockResolvedValue({ count: 1 });
    prisma.knowledgeIndexJob.findUnique.mockResolvedValue({
      ...queuedJob,
      status: 'processing',
      attempt: 1,
    });
    prisma.appInfo.findUnique.mockResolvedValue({
      appcode: 'STORE_A',
      defaultEmbeddingModelId: null,
    });
    const timeout = Object.assign(new Error('embedding timeout'), {
      name: 'ModelTimeoutException',
      $metadata: { httpStatusCode: 408 },
    });
    knowledgeService.indexKnowledgeFile.mockRejectedValue(timeout);
    prisma.knowledgeIndexJob.update.mockResolvedValue({
      ...queuedJob,
      status: 'queued',
    });

    await expect(service.drain()).resolves.toBeUndefined();
    const failedUpdate = lastMockArgument(prisma.knowledgeIndexJob.updateMany);
    expect(failedUpdate).toMatchObject({
      data: {
        status: 'queued',
        completedAt: null,
        errorCode: 'UPSTREAM_TIMEOUT',
        retryable: true,
      },
    });
    expect(
      (failedUpdate as { data: { nextAttemptAt: unknown } }).data.nextAttemptAt,
    ).toBeInstanceOf(Date);
  });

  it('records a permanent failure without requeueing', async () => {
    const { service, prisma, knowledgeService } = createFixture(true);
    prisma.knowledgeIndexJob.findFirst
      .mockResolvedValueOnce(queuedJob)
      .mockResolvedValueOnce(null);
    prisma.knowledgeIndexJob.updateMany.mockResolvedValue({ count: 1 });
    prisma.knowledgeIndexJob.findUnique.mockResolvedValue({
      ...queuedJob,
      status: 'processing',
      attempt: 1,
    });
    prisma.appInfo.findUnique.mockResolvedValue({
      appcode: 'STORE_A',
      defaultEmbeddingModelId: null,
    });
    const invalid = Object.assign(new Error('invalid model configuration'), {
      name: 'ValidationException',
      $metadata: { httpStatusCode: 400 },
    });
    knowledgeService.indexKnowledgeFile.mockRejectedValue(invalid);
    prisma.knowledgeIndexJob.update.mockResolvedValue({
      ...queuedJob,
      status: 'failed',
    });

    await expect(service.drain()).resolves.toBeUndefined();
    const failedUpdate = lastMockArgument(prisma.knowledgeIndexJob.updateMany);
    expect(failedUpdate).toMatchObject({
      data: {
        status: 'failed',
        errorCode: 'INVALID_INDEX_REQUEST',
        retryable: false,
        nextAttemptAt: null,
      },
    });
  });

  it('aborts and persists an in-flight job before shutdown completes', async () => {
    const { service, prisma, knowledgeService } = createFixture(true);
    prisma.knowledgeIndexJob.findFirst
      .mockResolvedValueOnce(queuedJob)
      .mockResolvedValueOnce(null);
    prisma.knowledgeIndexJob.updateMany.mockResolvedValue({ count: 1 });
    prisma.knowledgeIndexJob.findUnique.mockResolvedValue({
      ...queuedJob,
      status: 'processing',
      attempt: 1,
    });
    prisma.appInfo.findUnique.mockResolvedValue({
      appcode: 'STORE_A',
      defaultEmbeddingModelId: null,
    });
    knowledgeService.indexKnowledgeFile.mockImplementation(() =>
      runAwsRequest(
        (abortSignal) =>
          new Promise((_, reject) => {
            abortSignal.addEventListener(
              'abort',
              () =>
                reject(
                  Object.assign(new Error('shutdown'), { name: 'AbortError' }),
                ),
              { once: true },
            );
          }),
        { timeoutMs: 30_000 },
      ),
    );
    prisma.knowledgeIndexJob.update.mockResolvedValue({
      ...queuedJob,
      status: 'queued',
    });

    const drain = service.drain();
    await new Promise((resolve) => setImmediate(resolve));
    await service.onModuleDestroy();
    await drain;

    const shutdownUpdate = lastMockArgument(
      prisma.knowledgeIndexJob.updateMany,
    );
    expect(shutdownUpdate).toMatchObject({
      data: {
        status: 'queued',
        errorCode: 'UPSTREAM_TIMEOUT',
        retryable: true,
      },
    });
  });
});
