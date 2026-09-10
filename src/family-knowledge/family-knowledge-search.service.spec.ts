import { FamilyKnowledgeSearchService } from './family-knowledge-search.service';

type SqlLike = { strings: string[]; values: unknown[] };

const vector = (x: number, y = 0) => [x, y, ...Array<number>(1022).fill(0)];
const dto = {
  query: '가상 가족 질문',
  tenantRef: 'a'.repeat(64),
  audience: 'FAMILY' as const,
  limit: 2,
};
const app = { appcode: 'zinframe-app', defaultEmbeddingModelId: null };

function createFixture() {
  const prisma = {
    $queryRaw: jest.fn(),
    familyKnowledgeDocument: { findMany: jest.fn() },
  };
  const embedding = {
    getDefaultEmbeddingModelId: jest.fn().mockReturnValue('embed-model'),
    createEmbedding: jest.fn().mockResolvedValue(vector(1)),
  };
  const service = new FamilyKnowledgeSearchService(
    prisma as never,
    embedding as never,
  );
  return { service, prisma, embedding };
}

function queryText(call: unknown) {
  return (call as SqlLike).strings.join('?');
}

function callArgument(mock: jest.Mock, callIndex: number) {
  return (mock.mock.calls as unknown[][])[callIndex]?.[0];
}

describe('FamilyKnowledgeSearchService', () => {
  it('applies every scope condition before vector ordering and limit', async () => {
    const { service, prisma } = createFixture();
    prisma.$queryRaw.mockResolvedValue([
      {
        sourceId: 'story-1',
        sourceVersion: 2,
        title: '가상 기록',
        content: '허용된 가족 근거',
        score: 0.9,
      },
    ]);

    const result = await service.search(dto, app);

    expect(result.results).toEqual([
      expect.objectContaining({ sourceId: 'story-1', score: 0.9 }),
    ]);
    expect(JSON.stringify(result)).not.toContain(dto.tenantRef);
    const sql = queryText(callArgument(prisma.$queryRaw, 0));
    expect(sql).toContain('fc."appcode" =');
    expect(sql).toContain('fc."tenant_ref" =');
    expect(sql).toContain('fc."audience" = \'FAMILY\'');
    expect(sql).toContain('fc."member_ref" IS NULL');
    expect(sql).toContain('fd."sensitivity" = \'NON_SENSITIVE\'');
    expect(sql).toContain('fd."status" = \'ACTIVE\'');
    expect(sql).toContain('fd."deleted_at" IS NULL');
    expect(sql).toContain('fd."indexed_at" IS NOT NULL');
    expect(sql).toContain('fc."source_version" = fd."source_version"');
    expect(sql.indexOf('WHERE')).toBeLessThan(sql.indexOf('ORDER BY'));
    expect(sql.indexOf('ORDER BY')).toBeLessThan(sql.indexOf('LIMIT'));
  });

  it('uses the same database scope before in-memory fallback ranking', async () => {
    const { service, prisma } = createFixture();
    prisma.$queryRaw
      .mockRejectedValueOnce(
        new Error('operator does not exist: vector <=> vector'),
      )
      .mockResolvedValueOnce([
        {
          sourceId: 'lower',
          sourceVersion: 1,
          title: null,
          content: '낮은 점수',
          embedding: vector(0, 1),
        },
        {
          sourceId: 'higher',
          sourceVersion: 3,
          title: '높은 점수',
          content: '높은 점수 근거',
          embedding: vector(1),
        },
      ]);

    const result = await service.search(dto, app);

    expect(result.results.map((item) => item.sourceId)).toEqual([
      'higher',
      'lower',
    ]);
    const fallbackSql = queryText(callArgument(prisma.$queryRaw, 1));
    expect(fallbackSql).toContain('fc."appcode" =');
    expect(fallbackSql).toContain('fc."tenant_ref" =');
    expect(fallbackSql).toContain('fd."sensitivity" = \'NON_SENSITIVE\'');
    expect(fallbackSql).toContain('fc."source_version" = fd."source_version"');
    expect(fallbackSql).not.toContain('ORDER BY');
    expect(fallbackSql).not.toContain('LIMIT');
  });

  it('does not fall back merely because an allowed vector query has no results', async () => {
    const { service, prisma } = createFixture();
    prisma.$queryRaw.mockResolvedValue([]);

    await expect(service.search(dto, app)).resolves.toEqual({ results: [] });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('uses the authenticated app embedding model and bounds returned excerpts', async () => {
    const { service, prisma, embedding } = createFixture();
    prisma.$queryRaw.mockResolvedValue([
      {
        sourceId: 'story-1',
        sourceVersion: 1,
        title: null,
        content: '가'.repeat(1300),
        score: 1,
      },
    ]);

    const result = await service.search(dto, {
      ...app,
      defaultEmbeddingModelId: 'app-embed-model',
    });

    expect(embedding.createEmbedding).toHaveBeenCalledWith(
      dto.query,
      'app-embed-model',
      undefined,
    );
    expect(result.results[0].content).toHaveLength(1200);
  });

  it('rejects an invalid query embedding before database access', async () => {
    const { service, prisma, embedding } = createFixture();
    embedding.createEmbedding.mockResolvedValue([1]);

    await expect(service.search(dto, app)).rejects.toMatchObject({
      name: 'ValidationException',
    });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('revalidates every deduplicated source against the same active FAMILY scope', async () => {
    const { service, prisma } = createFixture();
    prisma.familyKnowledgeDocument.findMany.mockResolvedValue([
      { sourceId: 'story-1', sourceVersion: 2 },
    ]);

    await expect(
      service.isEvidenceSnapshotCurrent(
        [
          { sourceId: 'story-1', sourceVersion: 2 },
          { sourceId: 'story-1', sourceVersion: 2 },
        ],
        app,
        dto.tenantRef,
      ),
    ).resolves.toBe(true);
    expect(callArgument(prisma.familyKnowledgeDocument.findMany, 0)).toEqual({
      where: {
        appcode: app.appcode,
        tenantRef: dto.tenantRef,
        audience: 'FAMILY',
        memberRef: null,
        sensitivity: 'NON_SENSITIVE',
        status: 'ACTIVE',
        deletedAt: null,
        indexedAt: { not: null },
        embeddingModel: 'embed-model',
        OR: [{ sourceId: 'story-1', sourceVersion: 2 }],
      },
      select: { sourceId: true, sourceVersion: true },
    });
  });

  it('rejects an evidence snapshot after its source version changes or is deleted', async () => {
    const { service, prisma } = createFixture();
    prisma.familyKnowledgeDocument.findMany.mockResolvedValue([]);

    await expect(
      service.isEvidenceSnapshotCurrent(
        [{ sourceId: 'story-1', sourceVersion: 2 }],
        app,
        dto.tenantRef,
      ),
    ).resolves.toBe(false);
  });
});
