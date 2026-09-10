import { ConflictException, BadRequestException } from '@nestjs/common';
import { FamilyKnowledgeService } from './family-knowledge.service';
import type { FamilyKnowledgeEventDto } from './dto/family-knowledge-event.dto';

const familyRef = 'a'.repeat(64);
const memberRef = 'b'.repeat(64);

const fixture = (
  overrides: Partial<FamilyKnowledgeEventDto> = {},
): FamilyKnowledgeEventDto => ({
  sourceId: 'story-1',
  sourceVersion: 1,
  operation: 'UPSERT',
  tenantRef: familyRef,
  audience: 'FAMILY',
  sourceType: 'TEXT',
  sensitivity: 'NON_SENSITIVE',
  title: '가상 가족 기록',
  content: '실제 사용자가 아닌 계약 시험용 본문',
  publishedAt: '2026-09-10T00:00:00.000Z',
  ...overrides,
});

function createDatabase() {
  type EventIdentity = {
    appcode: string;
    sourceId: string;
    sourceVersion: number;
    operation: 'UPSERT' | 'DELETE';
  };
  type EventRow = EventIdentity & {
    id: string;
    payloadHash: string;
    status: string;
    resultCode: string | null;
    completedAt: Date | null;
  };
  type DocumentData = {
    appcode: string;
    sourceId: string;
    sourceVersion: number;
    [key: string]: unknown;
  };
  type DocumentRow = DocumentData & { id: string };
  const documents = new Map<string, DocumentRow>();
  const events = new Map<string, EventRow>();
  let eventSequence = 0;
  const eventKey = (data: EventIdentity) =>
    [data.appcode, data.sourceId, data.sourceVersion, data.operation].join('|');
  const documentKey = (appcode: string, sourceId: string) =>
    `${appcode}|${sourceId}`;

  const transaction = {
    $queryRaw: jest.fn().mockResolvedValue([{ locked: null }]),
    familyKnowledgeEvent: {
      findUnique: jest.fn(
        ({
          where,
        }: {
          where: { appcode_sourceId_sourceVersion_operation: EventIdentity };
        }) =>
          Promise.resolve(
            events.get(
              eventKey(where.appcode_sourceId_sourceVersion_operation),
            ) ?? null,
          ),
      ),
      create: jest.fn(
        ({
          data,
        }: {
          data: EventIdentity & {
            payloadHash: string;
            status: string;
            resultCode?: string | null;
            completedAt?: Date | null;
          };
        }) => {
          const row: EventRow = {
            id: `event-${++eventSequence}`,
            ...data,
            resultCode: data.resultCode ?? null,
            completedAt: data.completedAt ?? null,
          };
          events.set(eventKey(row), row);
          return Promise.resolve(row);
        },
      ),
    },
    familyKnowledgeDocument: {
      findUnique: jest.fn(
        ({
          where,
        }: {
          where: { appcode_sourceId: { appcode: string; sourceId: string } };
        }) => {
          const key = where.appcode_sourceId;
          return Promise.resolve(
            documents.get(documentKey(key.appcode, key.sourceId)) ?? null,
          );
        },
      ),
      create: jest.fn(({ data }: { data: DocumentData }) => {
        const row: DocumentRow = {
          id: `document-${documents.size + 1}`,
          ...data,
        };
        documents.set(documentKey(data.appcode, data.sourceId), row);
        return Promise.resolve(row);
      }),
      update: jest.fn(
        ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<DocumentRow>;
        }) => {
          const entry = [...documents.entries()].find(
            ([, value]) => value.id === where.id,
          );
          if (!entry) throw new Error('document not found');
          const row = { ...entry[1], ...data } as DocumentRow;
          documents.set(entry[0], row);
          return Promise.resolve(row);
        },
      ),
    },
    familyKnowledgeChunk: {
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const prisma = {
    $transaction: jest.fn(
      (callback: (client: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
    ),
  };
  const service = new FamilyKnowledgeService(
    prisma as never,
    {
      get: (key: string) =>
        key === 'KNOWLEDGE_INDEX_MAX_ATTEMPTS' ? '3' : undefined,
    } as never,
  );
  return { service, prisma, transaction, documents, events };
}

describe('FamilyKnowledgeService ingestion contract', () => {
  it('queues a new UPSERT using only the authenticated appcode', async () => {
    const { service, documents } = createDatabase();

    const result = await service.receiveEvent(fixture(), 'zinframe-app');

    expect(result).toMatchObject({
      status: 'QUEUED',
      resultCode: 'QUEUED',
      replayed: false,
    });
    expect(documents.get('zinframe-app|story-1')).toMatchObject({
      appcode: 'zinframe-app',
      sourceVersion: 1,
      status: 'ACTIVE',
      indexedAt: null,
    });
  });

  it('returns the same event for an identical replay', async () => {
    const { service, events } = createDatabase();
    const first = await service.receiveEvent(fixture(), 'zinframe-app');
    const replay = await service.receiveEvent(fixture(), 'zinframe-app');

    expect(replay).toMatchObject({ eventId: first.eventId, replayed: true });
    expect(events.size).toBe(1);
  });

  it('rejects a different payload for the same event identity', async () => {
    const { service } = createDatabase();
    await service.receiveEvent(fixture(), 'zinframe-app');

    await expect(
      service.receiveEvent(
        fixture({ content: '서로 다른 본문' }),
        'zinframe-app',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('persists an older version as a successful stale no-op', async () => {
    const { service, documents } = createDatabase();
    await service.receiveEvent(fixture({ sourceVersion: 3 }), 'zinframe-app');

    const stale = await service.receiveEvent(
      fixture({ sourceVersion: 2 }),
      'zinframe-app',
    );

    expect(stale).toMatchObject({ status: 'SUCCEEDED', resultCode: 'STALE' });
    expect(documents.get('zinframe-app|story-1')).toMatchObject({
      sourceVersion: 3,
    });
  });

  it('makes a current source immediately unsearchable on DELETE', async () => {
    const { service, documents, transaction } = createDatabase();
    await service.receiveEvent(fixture(), 'zinframe-app');

    const deleted = await service.receiveEvent(
      fixture({
        sourceVersion: 2,
        operation: 'DELETE',
        title: undefined,
        content: undefined,
      }),
      'zinframe-app',
    );

    expect(deleted).toMatchObject({
      status: 'SUCCEEDED',
      resultCode: 'DELETED',
    });
    expect(documents.get('zinframe-app|story-1')).toMatchObject({
      sourceVersion: 2,
      status: 'DELETED',
      content: null,
      indexedAt: null,
    });
    expect(transaction.familyKnowledgeChunk.deleteMany).toHaveBeenCalledTimes(
      1,
    );
  });

  it('does not let an older DELETE remove a newer active version', async () => {
    const { service, documents, transaction } = createDatabase();
    await service.receiveEvent(
      fixture({ sourceVersion: 4, content: '최신 가상 본문' }),
      'zinframe-app',
    );

    const staleDelete = await service.receiveEvent(
      fixture({
        sourceVersion: 3,
        operation: 'DELETE',
        title: undefined,
        content: undefined,
      }),
      'zinframe-app',
    );

    expect(staleDelete).toMatchObject({
      status: 'SUCCEEDED',
      resultCode: 'STALE',
    });
    expect(documents.get('zinframe-app|story-1')).toMatchObject({
      sourceVersion: 4,
      status: 'ACTIVE',
      content: '최신 가상 본문',
    });
    expect(transaction.familyKnowledgeChunk.deleteMany).not.toHaveBeenCalled();
  });

  it('keeps repeated DELETE requests idempotent', async () => {
    const { service, transaction } = createDatabase();
    const deletion = fixture({
      operation: 'DELETE',
      title: undefined,
      content: undefined,
    });

    const first = await service.receiveEvent(deletion, 'zinframe-app');
    const replay = await service.receiveEvent(deletion, 'zinframe-app');

    expect(replay).toMatchObject({ eventId: first.eventId, replayed: true });
    expect(transaction.familyKnowledgeChunk.deleteMany).toHaveBeenCalledTimes(
      1,
    );
  });

  it('rejects a contradictory operation at the current version', async () => {
    const { service } = createDatabase();
    await service.receiveEvent(fixture(), 'zinframe-app');

    await expect(
      service.receiveEvent(
        fixture({ operation: 'DELETE', title: undefined, content: undefined }),
        'zinframe-app',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects invalid FAMILY/MEMBER scope and DELETE content before DB work', async () => {
    const { service, prisma } = createDatabase();

    await expect(
      service.receiveEvent(
        fixture({ audience: 'FAMILY', memberRef }),
        'zinframe-app',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.receiveEvent(
        fixture({ audience: 'MEMBER', memberRef: undefined }),
        'zinframe-app',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.receiveEvent(
        fixture({ operation: 'DELETE', content: '금지된 원문' }),
        'zinframe-app',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
