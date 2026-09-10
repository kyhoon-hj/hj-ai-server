import { FamilyKnowledgeIndexJobService } from './family-knowledge-index-job.service';

const queuedEvent = {
  id: '11111111-1111-4111-8111-111111111111',
  appcode: 'zinframe-app',
  sourceId: 'story-1',
  sourceVersion: 2,
  operation: 'UPSERT' as const,
  status: 'QUEUED' as const,
  attemptCount: 0,
  maxAttempts: 3,
  nextAttemptAt: null,
  createdAt: new Date(),
};

function lastCall(mock: jest.Mock) {
  return (mock.mock.calls as unknown[][]).at(-1)?.[0];
}

function callArgument(mock: jest.Mock, callIndex: number) {
  return (mock.mock.calls as unknown[][])[callIndex]?.[0];
}

function createFixture() {
  const prisma = {
    $executeRaw: jest.fn().mockResolvedValue(0),
    familyKnowledgeEvent: {
      findFirst: jest
        .fn()
        .mockResolvedValueOnce(queuedEvent)
        .mockResolvedValueOnce(null),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const indexer = { indexEvent: jest.fn().mockResolvedValue('INDEXED') };
  const config = {
    get: jest.fn((key: string): string | undefined => {
      if (key === 'FRAME_FAMILY_RAG_ENABLED') return 'true';
      if (key === 'KNOWLEDGE_INDEX_RETRY_DELAY_MS') return '100';
      return undefined;
    }),
  };
  const service = new FamilyKnowledgeIndexJobService(
    prisma as never,
    indexer as never,
    config as never,
  );
  return { service, prisma, indexer, config };
}

describe('FamilyKnowledgeIndexJobService', () => {
  it('claims one event with CAS and records a single indexed result', async () => {
    const { service, prisma, indexer } = createFixture();

    await service.drain('zinframe-app');

    expect(indexer.indexEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        id: queuedEvent.id,
        attemptCount: 1,
      }),
      expect.any(AbortSignal),
    );
    expect(lastCall(prisma.familyKnowledgeEvent.updateMany)).toMatchObject({
      where: {
        id: queuedEvent.id,
        status: 'PROCESSING',
        attemptCount: 1,
      },
      data: {
        status: 'SUCCEEDED',
        resultCode: 'INDEXED',
        leaseExpiresAt: null,
      },
    });
  });

  it('records a stale event as successful without retry', async () => {
    const { service, prisma, indexer } = createFixture();
    indexer.indexEvent.mockResolvedValue('STALE');

    await service.drain();

    expect(lastCall(prisma.familyKnowledgeEvent.updateMany)).toMatchObject({
      data: {
        status: 'SUCCEEDED',
        resultCode: 'STALE',
        retryable: false,
      },
    });
  });

  it('retries only transient provider failures', async () => {
    const { service, prisma, indexer } = createFixture();
    indexer.indexEvent.mockRejectedValue(
      Object.assign(new Error('embedding timed out'), {
        name: 'ModelTimeoutException',
      }),
    );

    await service.drain();

    const retryUpdate = lastCall(prisma.familyKnowledgeEvent.updateMany) as {
      data: { nextAttemptAt: unknown };
    };
    expect(retryUpdate).toMatchObject({
      data: {
        status: 'RETRY',
        resultCode: 'RETRY_SCHEDULED',
        errorCode: 'UPSTREAM_TIMEOUT',
        retryable: true,
      },
    });
    expect(retryUpdate.data.nextAttemptAt).toBeInstanceOf(Date);
  });

  it('does not retry validation failures', async () => {
    const { service, prisma, indexer } = createFixture();
    indexer.indexEvent.mockRejectedValue(
      Object.assign(new Error('invalid embedding'), {
        name: 'ValidationException',
      }),
    );

    await service.drain();

    expect(lastCall(prisma.familyKnowledgeEvent.updateMany)).toMatchObject({
      data: {
        status: 'FAILED',
        resultCode: 'INDEX_FAILED',
        errorCode: 'INVALID_INDEX_REQUEST',
        retryable: false,
        nextAttemptAt: null,
      },
    });
  });

  it('recovers only expired Family UPSERT leases', async () => {
    const { service, prisma } = createFixture();
    prisma.familyKnowledgeEvent.findFirst.mockReset().mockResolvedValue(null);

    await service.drain();

    const sql = (callArgument(prisma.$executeRaw, 0) as readonly string[]).join(
      '?',
    );
    expect(sql).toContain('"family_knowledge_event"');
    expect(sql).toContain('"operation" = \'UPSERT\'');
    expect(sql).toContain('"status" = \'PROCESSING\'');
    expect(sql).toContain('"lease_expires_at" <=');
  });

  it('stays inactive while the Family RAG feature flag is off', async () => {
    const { service, prisma, config } = createFixture();
    config.get.mockReturnValue('false');

    await service.drain();

    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    expect(prisma.familyKnowledgeEvent.findFirst).not.toHaveBeenCalled();
  });
});
