import { InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KnowledgeService } from './knowledge.service';

type TestMetadata = Record<string, unknown>;

type TestFile = {
  id: string;
  appcode: string;
  bucket: string;
  key: string;
  status: string;
  errorMessage: string | null;
  indexedAt: Date | null;
  metadata: TestMetadata;
  _count?: { chunks: number };
};

type UpdateArgs = {
  where: { id: string };
  data: Partial<TestFile>;
  include?: unknown;
};

describe('knowledge archive and S3 cleanup consistency', () => {
  const baseFile: TestFile = {
    id: 'file-1',
    appcode: 'store-a',
    bucket: 'knowledge-bucket',
    key: 'store-a/knowledge/file-1.md',
    status: 'indexed',
    errorMessage: null,
    indexedAt: new Date('2026-08-29T00:00:00.000Z'),
    metadata: { source: 's3' },
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const createSubject = (options: {
    file?: Partial<TestFile>;
    transactionError?: Error;
    deleteError?: Error;
    finalStateError?: Error;
  }) => {
    const events: string[] = [];
    let persistedFile = { ...baseFile, ...options.file };
    const transaction = {
      knowledgeFile: {
        findFirst: jest.fn(() => {
          events.push('db.find');
          return Promise.resolve(persistedFile);
        }),
        update: jest.fn(({ data }: UpdateArgs) => {
          events.push('db.archive');
          persistedFile = { ...persistedFile, ...data };
          return Promise.resolve({
            ...persistedFile,
            _count: { chunks: 0 },
          });
        }),
      },
      knowledgeChunk: {
        deleteMany: jest.fn(() => {
          events.push('db.chunks');
          return Promise.resolve({ count: 2 });
        }),
      },
    };
    const finalStateError = options.finalStateError;
    const finalUpdate = finalStateError
      ? jest.fn((args: UpdateArgs) => {
          void args;
          events.push('db.finalize');
          return Promise.reject(finalStateError);
        })
      : jest.fn(({ data }: UpdateArgs) => {
          events.push('db.finalize');
          persistedFile = { ...persistedFile, ...data };
          return Promise.resolve({
            ...persistedFile,
            _count: { chunks: 0 },
          });
        });
    const runTransaction = async (
      callback: (client: typeof transaction) => Promise<unknown>,
    ) => {
      events.push('tx.begin');
      const result = await callback(transaction);
      events.push('tx.commit');
      return result;
    };
    const prisma = {
      $transaction: options.transactionError
        ? jest.fn().mockRejectedValue(options.transactionError)
        : jest.fn(runTransaction),
      knowledgeFile: { update: finalUpdate },
    };
    const deleteError = options.deleteError;
    const storageService = {
      deleteFile: deleteError
        ? jest.fn(() => {
            events.push('s3.delete');
            return Promise.reject(deleteError);
          })
        : jest.fn(() => {
            events.push('s3.delete');
            return Promise.resolve({ deleted: true });
          }),
    };
    const configService = {
      get: jest.fn((key: string) =>
        key === 'AWS_REGION' ? 'ap-northeast-2' : undefined,
      ),
    };
    const service = new KnowledgeService(
      configService as unknown as ConfigService,
      prisma as never,
      storageService as never,
      {} as never,
      {} as never,
      {} as never,
    );

    return { events, prisma, service, storageService, transaction };
  };

  it('atomically archives and deletes chunks before deleting S3', async () => {
    const { events, prisma, service, storageService, transaction } =
      createSubject({});

    await expect(
      service.deleteKnowledgeFile('file-1', 'store-a', {
        deleteObject: true,
      }),
    ).resolves.toMatchObject({
      id: 'file-1',
      status: 'archived',
      metadata: {
        deletedObject: true,
        objectCleanupStatus: 'completed',
      },
      _count: { chunks: 0 },
    });
    expect(events).toEqual([
      'tx.begin',
      'db.find',
      'db.chunks',
      'db.archive',
      'tx.commit',
      's3.delete',
      'db.finalize',
    ]);
    expect(storageService.deleteFile).toHaveBeenCalledWith(
      baseFile.key,
      'store-a',
      undefined,
    );
    const pendingMetadata = transaction.knowledgeFile.update.mock.calls[0][0]
      .data.metadata as TestMetadata;
    expect(pendingMetadata).toMatchObject({
      deleteObjectRequested: true,
      deletedObject: false,
      objectCleanupStatus: 'pending',
    });
    const completedMetadata = prisma.knowledgeFile.update.mock.calls[0][0].data
      .metadata as TestMetadata;
    expect(completedMetadata).toMatchObject({
      deletedObject: true,
      objectCleanupStatus: 'completed',
      objectCleanupLastError: null,
    });
  });

  it('does not touch S3 when the DB transaction fails', async () => {
    const transactionError = new Error('transaction failed');
    const { service, storageService } = createSubject({ transactionError });

    await expect(
      service.deleteKnowledgeFile('file-1', 'store-a', {
        deleteObject: true,
      }),
    ).rejects.toBe(transactionError);
    expect(storageService.deleteFile).not.toHaveBeenCalled();
  });

  it('preserves an archived retryable failure state when S3 deletion fails', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { prisma, service } = createSubject({
      deleteError: new Error('S3 unavailable'),
    });

    const promise = service.deleteKnowledgeFile('file-1', 'store-a', {
      deleteObject: true,
    });
    await expect(promise).rejects.toBeInstanceOf(InternalServerErrorException);
    await expect(promise).rejects.toMatchObject({
      response: { code: 'KNOWLEDGE_OBJECT_CLEANUP_FAILED' },
    });
    const failedUpdate = prisma.knowledgeFile.update.mock.calls[0][0];
    expect(failedUpdate.where).toEqual({ id: 'file-1' });
    expect(failedUpdate.data.metadata).toMatchObject({
      deletedObject: false,
      objectCleanupStatus: 'failed',
      objectCleanupLastError: 'Error',
    });
  });

  it('reports a distinct retryable error when cleanup completion cannot be recorded', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { service, storageService } = createSubject({
      finalStateError: new Error('final state failed'),
    });

    const promise = service.deleteKnowledgeFile('file-1', 'store-a', {
      deleteObject: true,
    });
    await expect(promise).rejects.toBeInstanceOf(InternalServerErrorException);
    await expect(promise).rejects.toMatchObject({
      response: { code: 'KNOWLEDGE_OBJECT_CLEANUP_STATE_FAILED' },
    });
    expect(storageService.deleteFile).toHaveBeenCalledTimes(1);
  });

  it('does not delete S3 again after cleanup was already completed', async () => {
    const archivedAt = '2026-08-28T00:00:00.000Z';
    const { prisma, service, storageService, transaction } = createSubject({
      file: {
        status: 'archived',
        metadata: {
          source: 's3',
          archivedAt,
          deleteObjectRequested: true,
          deletedObject: true,
          objectCleanupStatus: 'completed',
        },
      },
    });

    await expect(
      service.deleteKnowledgeFile('file-1', 'store-a', {
        deleteObject: true,
      }),
    ).resolves.toMatchObject({
      metadata: {
        archivedAt,
        deletedObject: true,
        objectCleanupStatus: 'completed',
      },
    });
    expect(transaction.knowledgeChunk.deleteMany).toHaveBeenCalledTimes(1);
    expect(storageService.deleteFile).not.toHaveBeenCalled();
    expect(prisma.knowledgeFile.update).not.toHaveBeenCalled();
  });

  it('retries a previously failed S3 cleanup and clears the failure state', async () => {
    const { prisma, service, storageService } = createSubject({
      file: {
        status: 'archived',
        metadata: {
          source: 's3',
          archivedAt: '2026-08-28T00:00:00.000Z',
          deleteObjectRequested: true,
          deletedObject: false,
          objectCleanupStatus: 'failed',
          objectCleanupLastError: 'TimeoutError',
        },
      },
    });

    await expect(
      service.deleteKnowledgeFile('file-1', 'store-a', {
        deleteObject: true,
      }),
    ).resolves.toMatchObject({
      metadata: {
        deletedObject: true,
        objectCleanupStatus: 'completed',
        objectCleanupLastError: null,
      },
    });
    expect(storageService.deleteFile).toHaveBeenCalledTimes(1);
    const completedMetadata = prisma.knowledgeFile.update.mock.calls[0][0].data
      .metadata as TestMetadata;
    expect(completedMetadata.objectCleanupLastError).toBeNull();
  });
});
