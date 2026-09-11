import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { mapWithConcurrency } from '../knowledge/bounded-map';
import { ChunkingService } from '../knowledge/chunking.service';
import { EmbeddingService } from '../knowledge/embedding.service';
import { PrismaService } from '../prisma/prisma.service';
import { assertFamilyKnowledgeIndexLease } from './family-knowledge-index-lease';
import { FamilyEmbeddingUsageService } from './family-embedding-usage.service';

const FAMILY_CHUNK_SIZE = 2000;
const FAMILY_CHUNK_OVERLAP = 200;
const MAX_FAMILY_CHUNKS = 64;
const EMBEDDING_DIMENSIONS = 1024;

@Injectable()
export class FamilyKnowledgeIndexService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly chunking: ChunkingService,
    private readonly embedding: EmbeddingService,
    private readonly config: ConfigService,
    private readonly embeddingUsage: FamilyEmbeddingUsageService,
  ) {}

  async indexEvent(
    event: {
      id: string;
      appcode: string;
      sourceId: string;
      sourceVersion: number;
      attemptCount: number;
    },
    parentSignal?: AbortSignal,
  ): Promise<'INDEXED' | 'STALE'> {
    const document = await this.prisma.familyKnowledgeDocument.findUnique({
      where: {
        appcode_sourceId: {
          appcode: event.appcode,
          sourceId: event.sourceId,
        },
      },
    });
    if (!document || !this.isCurrentActiveDocument(document, event)) {
      return 'STALE';
    }

    const chunks = this.chunking.createChunks(
      [
        {
          title: document.title ?? document.sourceId,
          content: document.content!,
          metadata: { sourceType: 'text' },
        },
      ],
      { chunkSize: FAMILY_CHUNK_SIZE, overlap: FAMILY_CHUNK_OVERLAP },
    );
    if (!chunks.length || chunks.length > MAX_FAMILY_CHUNKS) {
      throw this.validationError(
        'Family document produced an invalid chunk count.',
      );
    }

    const app = await this.prisma.appInfo.findUnique({
      where: { appcode: event.appcode },
      select: { defaultEmbeddingModelId: true },
    });
    if (!app) {
      throw this.validationError('Authenticated Family app no longer exists.');
    }
    const embeddingModel =
      app.defaultEmbeddingModelId ??
      this.embedding.getDefaultEmbeddingModelId();
    const indexedChunks = await mapWithConcurrency(
      chunks,
      this.embeddingConcurrency(),
      async (chunk, chunkNo) => {
        if (parentSignal?.aborted) throw parentSignal.reason;
        const vector = await this.embeddingUsage.execute(
          {
            appcode: event.appcode,
            kind: 'INDEX',
            operationKey: `index:${event.id}:${event.attemptCount}:${chunkNo}`,
          },
          () =>
            this.embedding.createEmbedding(
              chunk.content,
              embeddingModel,
              parentSignal,
            ),
        );
        this.assertEmbedding(vector);
        return {
          chunkNo,
          content: chunk.content,
          contentHash: createHash('sha256')
            .update(chunk.content, 'utf8')
            .digest('hex'),
          embedding: vector,
        };
      },
    );

    return this.prisma.$transaction(async (transaction) => {
      await assertFamilyKnowledgeIndexLease(transaction, {
        id: event.id,
        attemptCount: event.attemptCount,
      });
      await this.lockSource(transaction, event.appcode, event.sourceId);
      const current = await transaction.familyKnowledgeDocument.findUnique({
        where: {
          appcode_sourceId: {
            appcode: event.appcode,
            sourceId: event.sourceId,
          },
        },
      });
      if (!current || !this.isCurrentActiveDocument(current, event)) {
        return 'STALE';
      }

      await transaction.familyKnowledgeChunk.deleteMany({
        where: { documentId: current.id },
      });
      await transaction.familyKnowledgeChunk.createMany({
        data: indexedChunks.map((chunk) => ({
          documentId: current.id,
          appcode: current.appcode,
          tenantRef: current.tenantRef,
          memberRef: current.memberRef,
          audience: current.audience,
          sourceVersion: current.sourceVersion,
          chunkNo: chunk.chunkNo,
          content: chunk.content,
          contentHash: chunk.contentHash,
          embedding: chunk.embedding,
          embeddingModel,
        })),
      });
      await transaction.$executeRaw`
        UPDATE "family_knowledge_chunk"
        SET "embedding_vector" = ('[' || array_to_string("embedding", ',') || ']')::vector
        WHERE "document_id" = ${current.id}::uuid
          AND "source_version" = ${current.sourceVersion}
          AND "embedding_model" = ${embeddingModel}
          AND "embedding_vector" IS NULL
          AND cardinality("embedding") = ${EMBEDDING_DIMENSIONS}
      `;
      await transaction.familyKnowledgeDocument.update({
        where: { id: current.id },
        data: { indexedAt: new Date(), embeddingModel },
      });
      return 'INDEXED';
    });
  }

  private isCurrentActiveDocument(
    document: {
      status: string;
      sourceVersion: number;
      content: string | null;
    } | null,
    event: { sourceVersion: number },
  ) {
    return (
      document?.status === 'ACTIVE' &&
      document.sourceVersion === event.sourceVersion &&
      Boolean(document.content)
    );
  }

  private assertEmbedding(vector: number[]) {
    if (
      vector.length !== EMBEDDING_DIMENSIONS ||
      vector.some((value) => !Number.isFinite(value))
    ) {
      throw this.validationError('Embedding must contain 1024 finite values.');
    }
  }

  private validationError(message: string) {
    return Object.assign(new Error(message), { name: 'ValidationException' });
  }

  private embeddingConcurrency() {
    const value = Number(
      this.config.get<string>('KNOWLEDGE_EMBEDDING_CONCURRENCY') ?? 4,
    );
    return Number.isInteger(value) && value >= 1 && value <= 16 ? value : 4;
  }

  private async lockSource(
    transaction: Prisma.TransactionClient,
    appcode: string,
    sourceId: string,
  ) {
    const lockKey = JSON.stringify([appcode, sourceId]);
    await transaction.$queryRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))::text AS "locked"
    `;
  }
}
