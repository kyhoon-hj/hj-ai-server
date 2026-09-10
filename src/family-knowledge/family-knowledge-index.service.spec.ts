import { ChunkingService } from '../knowledge/chunking.service';
import { FamilyKnowledgeIndexLeaseLostError } from './family-knowledge-index-lease';
import { FamilyKnowledgeIndexService } from './family-knowledge-index.service';

const document = {
  id: '22222222-2222-4222-8222-222222222222',
  appcode: 'zinframe-app',
  tenantRef: 'a'.repeat(64),
  memberRef: null,
  audience: 'FAMILY' as const,
  sourceId: 'story-1',
  sourceVersion: 2,
  sourceType: 'TEXT' as const,
  sensitivity: 'NON_SENSITIVE' as const,
  status: 'ACTIVE' as const,
  title: '가상 기록',
  content: '가족 인덱싱 계약 시험에 사용하는 가상 본문',
  publishedAt: new Date('2026-09-10T00:00:00.000Z'),
  indexedAt: null,
  embeddingModel: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
};
const event = {
  id: '11111111-1111-4111-8111-111111111111',
  appcode: document.appcode,
  sourceId: document.sourceId,
  sourceVersion: document.sourceVersion,
  attemptCount: 1,
};
const vector = (first = 1) => [first, ...Array<number>(1023).fill(0)];

function firstCall(mock: jest.Mock) {
  return (mock.mock.calls as unknown[][])[0]?.[0];
}

function createFixture(transactionDocument = document) {
  const transaction = {
    $queryRaw: jest
      .fn()
      .mockResolvedValueOnce([{ id: event.id }])
      .mockResolvedValueOnce([{ locked: null }]),
    $executeRaw: jest.fn().mockResolvedValue(1),
    familyKnowledgeDocument: {
      findUnique: jest.fn().mockResolvedValue(transactionDocument),
      update: jest.fn().mockResolvedValue(transactionDocument),
    },
    familyKnowledgeChunk: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const prisma = {
    appInfo: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ defaultEmbeddingModelId: null }),
    },
    familyKnowledgeDocument: {
      findUnique: jest.fn().mockResolvedValue(document),
    },
    $transaction: jest.fn(
      (callback: (client: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
    ),
  };
  const embedding = {
    getDefaultEmbeddingModelId: jest.fn().mockReturnValue('embed-model'),
    createEmbedding: jest.fn().mockResolvedValue(vector()),
  };
  const service = new FamilyKnowledgeIndexService(
    prisma as never,
    new ChunkingService(),
    embedding as never,
    { get: jest.fn().mockReturnValue('2') } as never,
  );
  return { service, prisma, transaction, embedding };
}

describe('FamilyKnowledgeIndexService', () => {
  it('atomically replaces chunks and marks only the current version indexed', async () => {
    const { service, transaction } = createFixture();

    await expect(service.indexEvent(event)).resolves.toBe('INDEXED');
    expect(transaction.familyKnowledgeChunk.deleteMany).toHaveBeenCalledWith({
      where: { documentId: document.id },
    });
    expect(transaction.familyKnowledgeChunk.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          appcode: document.appcode,
          tenantRef: document.tenantRef,
          audience: 'FAMILY',
          memberRef: null,
          sourceVersion: 2,
          embeddingModel: 'embed-model',
          embedding: vector(),
        }),
      ],
    });
    expect(transaction.$executeRaw).toHaveBeenCalledTimes(1);
    const documentUpdate = firstCall(
      transaction.familyKnowledgeDocument.update,
    ) as {
      where: { id: string };
      data: { indexedAt: unknown; embeddingModel: string };
    };
    expect(documentUpdate).toMatchObject({
      where: { id: document.id },
      data: { embeddingModel: 'embed-model' },
    });
    expect(documentUpdate.data.indexedAt).toBeInstanceOf(Date);
  });

  it('discards embeddings when a newer version arrives before publish', async () => {
    const { service, transaction } = createFixture({
      ...document,
      sourceVersion: 3,
      content: '더 최신인 가상 본문',
    });

    await expect(service.indexEvent(event)).resolves.toBe('STALE');
    expect(transaction.familyKnowledgeChunk.deleteMany).not.toHaveBeenCalled();
    expect(transaction.familyKnowledgeChunk.createMany).not.toHaveBeenCalled();
    expect(transaction.familyKnowledgeDocument.update).not.toHaveBeenCalled();
  });

  it('does not publish after the worker lease is lost', async () => {
    const { service, transaction } = createFixture();
    transaction.$queryRaw.mockReset().mockResolvedValue([]);

    await expect(service.indexEvent(event)).rejects.toBeInstanceOf(
      FamilyKnowledgeIndexLeaseLostError,
    );
    expect(transaction.familyKnowledgeChunk.deleteMany).not.toHaveBeenCalled();
  });

  it('rejects a malformed embedding before opening the publish transaction', async () => {
    const { service, prisma, embedding } = createFixture();
    embedding.createEmbedding.mockResolvedValue([1, 2, 3]);

    await expect(service.indexEvent(event)).rejects.toMatchObject({
      name: 'ValidationException',
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('returns stale without calling the embedding provider for a deleted source', async () => {
    const { service, prisma, embedding } = createFixture();
    prisma.familyKnowledgeDocument.findUnique.mockResolvedValue({
      ...document,
      status: 'DELETED',
      content: null,
    });

    await expect(service.indexEvent(event)).resolves.toBe('STALE');
    expect(embedding.createEmbedding).not.toHaveBeenCalled();
  });

  it('uses the authenticated app embedding model for every generated chunk', async () => {
    const { service, prisma, embedding } = createFixture();
    prisma.appInfo.findUnique.mockResolvedValue({
      defaultEmbeddingModelId: 'app-embed-model',
    });

    await service.indexEvent(event);

    expect(embedding.createEmbedding).toHaveBeenCalledWith(
      document.content,
      'app-embed-model',
      undefined,
    );
  });
});
