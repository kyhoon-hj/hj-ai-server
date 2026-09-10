import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EmbeddingService } from '../knowledge/embedding.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  FamilyKnowledgeSearchDto,
  FamilyKnowledgeSearchResponseDto,
} from './dto/family-knowledge-search.dto';

type VectorSearchRow = {
  sourceId: string;
  sourceVersion: number;
  title: string | null;
  content: string;
  score: number;
};

type FallbackSearchRow = Omit<VectorSearchRow, 'score'> & {
  embedding: number[];
};

@Injectable()
export class FamilyKnowledgeSearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly embedding: EmbeddingService,
  ) {}

  async search(
    dto: FamilyKnowledgeSearchDto,
    app: { appcode: string; defaultEmbeddingModelId: string | null },
    parentSignal?: AbortSignal,
  ): Promise<FamilyKnowledgeSearchResponseDto> {
    const embeddingModel =
      app.defaultEmbeddingModelId ??
      this.embedding.getDefaultEmbeddingModelId();
    const queryEmbedding = await this.embedding.createEmbedding(
      dto.query,
      embeddingModel,
      parentSignal,
    );
    this.assertEmbedding(queryEmbedding);

    const vectorMatches = await this.findWithPgVector({
      appcode: app.appcode,
      tenantRef: dto.tenantRef,
      embeddingModel,
      queryEmbedding,
      limit: dto.limit,
    });
    const matches =
      vectorMatches ??
      (await this.findWithArrayFallback({
        appcode: app.appcode,
        tenantRef: dto.tenantRef,
        embeddingModel,
        queryEmbedding,
        limit: dto.limit,
      }));

    return {
      results: matches.map((match) => ({
        sourceId: match.sourceId,
        sourceVersion: match.sourceVersion,
        title: match.title,
        content: this.toExcerpt(match.content),
        score: match.score,
      })),
    };
  }

  async isEvidenceSnapshotCurrent(
    evidence: ReadonlyArray<{ sourceId: string; sourceVersion: number }>,
    app: { appcode: string; defaultEmbeddingModelId: string | null },
    tenantRef: string,
  ) {
    const uniqueEvidence = [
      ...new Map(
        evidence.map((item) => [
          `${item.sourceId}\u0000${item.sourceVersion}`,
          item,
        ]),
      ).values(),
    ];
    if (!uniqueEvidence.length) return true;
    const embeddingModel =
      app.defaultEmbeddingModelId ??
      this.embedding.getDefaultEmbeddingModelId();
    const current = await this.prisma.familyKnowledgeDocument.findMany({
      where: {
        appcode: app.appcode,
        tenantRef,
        audience: 'FAMILY',
        memberRef: null,
        sensitivity: 'NON_SENSITIVE',
        status: 'ACTIVE',
        deletedAt: null,
        indexedAt: { not: null },
        embeddingModel,
        OR: uniqueEvidence.map((item) => ({
          sourceId: item.sourceId,
          sourceVersion: item.sourceVersion,
        })),
      },
      select: { sourceId: true, sourceVersion: true },
    });
    const currentKeys = new Set(
      current.map((item) => `${item.sourceId}\u0000${item.sourceVersion}`),
    );
    return uniqueEvidence.every((item) =>
      currentKeys.has(`${item.sourceId}\u0000${item.sourceVersion}`),
    );
  }

  private async findWithPgVector(data: {
    appcode: string;
    tenantRef: string;
    embeddingModel: string;
    queryEmbedding: number[];
    limit: number;
  }): Promise<VectorSearchRow[] | null> {
    const vector = this.toVectorLiteral(data.queryEmbedding);
    try {
      return await this.prisma.$queryRaw<VectorSearchRow[]>(Prisma.sql`
        SELECT
          fd."source_id" AS "sourceId",
          fd."source_version" AS "sourceVersion",
          fd."title",
          fc."content",
          1 - (fc."embedding_vector" <=> ${vector}::vector) AS "score"
        FROM "family_knowledge_chunk" fc
        JOIN "family_knowledge_document" fd ON fd."id" = fc."document_id"
        WHERE fc."appcode" = ${data.appcode}
          AND fc."tenant_ref" = ${data.tenantRef}
          AND fc."audience" = 'FAMILY'
          AND fc."member_ref" IS NULL
          AND fd."appcode" = ${data.appcode}
          AND fd."tenant_ref" = ${data.tenantRef}
          AND fd."audience" = 'FAMILY'
          AND fd."member_ref" IS NULL
          AND fd."sensitivity" = 'NON_SENSITIVE'
          AND fd."status" = 'ACTIVE'
          AND fd."deleted_at" IS NULL
          AND fd."indexed_at" IS NOT NULL
          AND fc."source_version" = fd."source_version"
          AND fc."embedding_model" = ${data.embeddingModel}
          AND fd."embedding_model" = ${data.embeddingModel}
          AND fc."embedding_vector" IS NOT NULL
        ORDER BY fc."embedding_vector" <=> ${vector}::vector
        LIMIT ${data.limit}
      `);
    } catch (error) {
      if (this.isPgVectorUnavailable(error)) return null;
      throw error;
    }
  }

  private async findWithArrayFallback(data: {
    appcode: string;
    tenantRef: string;
    embeddingModel: string;
    queryEmbedding: number[];
    limit: number;
  }): Promise<VectorSearchRow[]> {
    const scoped = await this.prisma.$queryRaw<FallbackSearchRow[]>(Prisma.sql`
      SELECT
        fd."source_id" AS "sourceId",
        fd."source_version" AS "sourceVersion",
        fd."title",
        fc."content",
        fc."embedding"
      FROM "family_knowledge_chunk" fc
      JOIN "family_knowledge_document" fd ON fd."id" = fc."document_id"
      WHERE fc."appcode" = ${data.appcode}
        AND fc."tenant_ref" = ${data.tenantRef}
        AND fc."audience" = 'FAMILY'
        AND fc."member_ref" IS NULL
        AND fd."appcode" = ${data.appcode}
        AND fd."tenant_ref" = ${data.tenantRef}
        AND fd."audience" = 'FAMILY'
        AND fd."member_ref" IS NULL
        AND fd."sensitivity" = 'NON_SENSITIVE'
        AND fd."status" = 'ACTIVE'
        AND fd."deleted_at" IS NULL
        AND fd."indexed_at" IS NOT NULL
        AND fc."source_version" = fd."source_version"
        AND fc."embedding_model" = ${data.embeddingModel}
        AND fd."embedding_model" = ${data.embeddingModel}
        AND cardinality(fc."embedding") = 1024
    `);
    return scoped
      .map((match) => ({
        sourceId: match.sourceId,
        sourceVersion: match.sourceVersion,
        title: match.title,
        content: match.content,
        score: this.cosineSimilarity(data.queryEmbedding, match.embedding),
      }))
      .sort((left, right) => right.score - left.score)
      .slice(0, data.limit);
  }

  private assertEmbedding(vector: number[]) {
    if (
      vector.length !== 1024 ||
      vector.some((value) => !Number.isFinite(value))
    ) {
      throw Object.assign(
        new Error('Embedding must contain 1024 finite values.'),
        {
          name: 'ValidationException',
        },
      );
    }
  }

  private cosineSimilarity(left: number[], right: number[]) {
    if (left.length !== right.length || !left.length) return -1;
    let dot = 0;
    let leftMagnitude = 0;
    let rightMagnitude = 0;
    for (let index = 0; index < left.length; index += 1) {
      dot += left[index] * right[index];
      leftMagnitude += left[index] ** 2;
      rightMagnitude += right[index] ** 2;
    }
    if (!leftMagnitude || !rightMagnitude) return -1;
    return dot / Math.sqrt(leftMagnitude * rightMagnitude);
  }

  private toVectorLiteral(values: number[]) {
    return `[${values.join(',')}]`;
  }

  private toExcerpt(content: string) {
    const normalized = content.trim();
    return normalized.length <= 1200
      ? normalized
      : `${normalized.slice(0, 1199)}…`;
  }

  private isPgVectorUnavailable(error: unknown) {
    if (!error || typeof error !== 'object') return false;
    const text =
      'message' in error && typeof error.message === 'string'
        ? error.message
        : JSON.stringify(error);
    return (
      text.includes('embedding_vector') ||
      text.includes('type "vector" does not exist') ||
      text.includes('operator does not exist')
    );
  }
}
