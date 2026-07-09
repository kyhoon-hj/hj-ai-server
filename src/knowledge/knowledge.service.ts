import { createHash } from 'node:crypto';
import { extname } from 'node:path';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseCommandOutput,
} from '@aws-sdk/client-bedrock-runtime';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { ChunkingService } from './chunking.service';
import { CreateKnowledgeTextDto } from './dto/create-knowledge-text.dto';
import { DocumentParserService } from './document-parser.service';
import { EmbeddingService } from './embedding.service';
import { KnowledgeRagResponseDto } from './dto/knowledge-rag-response.dto';
import { KnowledgeSearchDto } from './dto/knowledge-search.dto';

const KNOWLEDGE_FILE_STATUS = {
  uploaded: 'uploaded',
  indexing: 'indexing',
  indexed: 'indexed',
  failed: 'failed',
  archived: 'archived',
} as const;

const DEFAULT_ALLOWED_EXTENSIONS = [
  '.txt',
  '.md',
  '.json',
  '.csv',
  '.xlsx',
  '.xls',
  '.pdf',
  '.docx',
] as const;

type KnowledgeAppContext = {
  appcode: string;
  defaultModelId: string | null;
  defaultEmbeddingModelId: string | null;
  systemPrompt: string | null;
  monthlyTokenLimit: number | null;
};

type KnowledgeMatch = {
  id: string;
  fileId: string;
  fileName: string;
  key: string;
  content: string;
  score: number;
  metadata: Prisma.JsonValue | null;
};

@Injectable()
export class KnowledgeService {
  private readonly bedrockClient: BedrockRuntimeClient;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
    private readonly documentParserService: DocumentParserService,
    private readonly chunkingService: ChunkingService,
    private readonly embeddingService: EmbeddingService,
  ) {
    this.bedrockClient = new BedrockRuntimeClient({
      region: this.configService.get<string>('AWS_REGION') ?? 'us-east-1',
    });
  }

  async uploadKnowledgeFile(
    file: Express.Multer.File,
    appInfo: { appcode: string; maxStorageMb: number | null },
  ) {
    const appcode = appInfo.appcode;
    this.validateKnowledgeUpload(file);
    await this.ensureStorageQuota(appcode, file.size, appInfo.maxStorageMb);

    const uploaded = await this.storageService.uploadFile(file, appcode);

    return this.prisma.knowledgeFile.create({
      data: {
        appcode,
        bucket: uploaded.bucket,
        key: uploaded.key,
        url: uploaded.url,
        originalName: uploaded.originalName,
        mimetype: uploaded.mimetype,
        size: uploaded.size,
        checksum: this.sha256(file.buffer),
        status: KNOWLEDGE_FILE_STATUS.uploaded,
        metadata: {
          source: 's3',
          uploadMode: 'manual',
        },
      },
      include: {
        _count: {
          select: { chunks: true },
        },
      },
    });
  }

  listKnowledgeFiles(
    appcode: string,
    options: { includeArchived?: boolean } = {},
  ) {
    return this.prisma.knowledgeFile.findMany({
      where: {
        appcode,
        ...(options.includeArchived
          ? {}
          : { status: { not: KNOWLEDGE_FILE_STATUS.archived } }),
      },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { chunks: true },
        },
      },
    });
  }

  async getKnowledgeFile(id: string, appcode: string) {
    const file = await this.prisma.knowledgeFile.findFirst({
      where: { id, appcode },
      include: {
        _count: {
          select: { chunks: true },
        },
      },
    });

    if (!file) {
      throw new NotFoundException(`Knowledge file ${id} not found`);
    }

    return file;
  }

  async deleteKnowledgeFile(
    id: string,
    appcode: string,
    options: { deleteObject?: boolean } = {},
  ) {
    const file = await this.prisma.knowledgeFile.findFirst({
      where: { id, appcode },
    });

    if (!file) {
      throw new NotFoundException(`Knowledge file ${id} not found`);
    }

    if (options.deleteObject && file.bucket !== 'direct-text') {
      await this.storageService.deleteFile(file.key, appcode);
    }

    await this.prisma.knowledgeChunk.deleteMany({
      where: { fileId: file.id },
    });

    return this.prisma.knowledgeFile.update({
      where: { id: file.id },
      data: {
        status: KNOWLEDGE_FILE_STATUS.archived,
        errorMessage: null,
        indexedAt: null,
        metadata: {
          ...(this.asJsonObject(file.metadata) ?? {}),
          archivedAt: new Date().toISOString(),
          deletedObject: Boolean(options.deleteObject && file.bucket !== 'direct-text'),
        },
      },
      include: {
        _count: {
          select: { chunks: true },
        },
      },
    });
  }

  async createKnowledgeText(
    dto: CreateKnowledgeTextDto,
    appInfo:
      | string
      | { appcode: string; defaultEmbeddingModelId: string | null },
  ) {
    const appcode = typeof appInfo === 'string' ? appInfo : appInfo.appcode;
    return this.createIndexedTextFile({
      appcode,
      originalName: dto.originalName,
      content: dto.content,
      metadata: {
        source: 'direct-text',
        ...(dto.metadata ?? {}),
      } as Prisma.InputJsonObject,
      embeddingModelId:
        typeof appInfo === 'string' ? null : appInfo.defaultEmbeddingModelId,
    });
  }

  seedDemoStoreKnowledge(
    appInfo:
      | string
      | { appcode: string; defaultEmbeddingModelId: string | null },
  ) {
    const appcode = typeof appInfo === 'string' ? appInfo : appInfo.appcode;
    return this.createIndexedTextFile({
      appcode,
      originalName: 'hj-daiso-like-store-demo.md',
      content: this.createDemoStoreKnowledge(),
      metadata: {
        source: 'demo-seed',
        domain: 'retail-store-guide',
        storeName: 'HJ 생활마켓 강남점',
      } as Prisma.InputJsonObject,
      embeddingModelId:
        typeof appInfo === 'string' ? null : appInfo.defaultEmbeddingModelId,
    });
  }

  async indexKnowledgeFile(
    id: string,
    appInfo:
      | string
      | { appcode: string; defaultEmbeddingModelId: string | null },
  ) {
    const appcode = typeof appInfo === 'string' ? appInfo : appInfo.appcode;
    const embeddingModelId =
      typeof appInfo === 'string' ? null : appInfo.defaultEmbeddingModelId;
    const file = await this.prisma.knowledgeFile.findFirst({
      where: { id, appcode },
    });

    if (!file) {
      throw new NotFoundException(`Knowledge file ${id} not found`);
    }

    if (file.status === KNOWLEDGE_FILE_STATUS.archived) {
      throw new BadRequestException('보관 처리된 파일은 인덱싱할 수 없습니다.');
    }

    await this.prisma.knowledgeFile.update({
      where: { id },
      data: {
        status: KNOWLEDGE_FILE_STATUS.indexing,
        errorMessage: null,
      },
    });

    try {
      const downloaded = await this.storageService.downloadFile(
        file.key,
        appcode,
      );
      const parsedDocument = await this.documentParserService.parse({
        body: downloaded.body,
        contentType: downloaded.contentType,
        fileName: file.originalName,
      });

      const result = await this.indexTextContent({
        fileId: file.id,
        appcode,
        sections: parsedDocument.sections,
        embeddingModelId,
      });

      await this.prisma.knowledgeFile.update({
        where: { id: file.id },
        data: {
          metadata: {
            ...(this.asJsonObject(file.metadata) ?? {}),
            parsed: parsedDocument.metadata as Prisma.InputJsonObject,
          } as Prisma.InputJsonObject,
        },
      });

      return {
        fileId: file.id,
        ...result,
      };
    } catch (error) {
      await this.prisma.knowledgeFile.update({
        where: { id: file.id },
        data: {
          status: KNOWLEDGE_FILE_STATUS.failed,
          errorMessage:
            error instanceof Error ? error.message : 'Unknown indexing error',
        },
      });

      throw error;
    }
  }

  private async createIndexedTextFile(data: {
    appcode: string;
    originalName: string;
    content: string;
    metadata: Prisma.InputJsonObject;
    embeddingModelId?: string | null;
  }) {
    const content = data.content.trim();

    if (!content) {
      throw new BadRequestException('인덱싱할 텍스트가 필요합니다.');
    }

    const checksum = this.sha256(Buffer.from(content));
    const key = `${this.toSafePathPart(data.appcode)}/demo/${checksum}-${this.toSafeFileName(data.originalName)}`;
    const file = await this.prisma.knowledgeFile.upsert({
      where: {
        appcode_key: {
          appcode: data.appcode,
          key,
        },
      },
      create: {
        appcode: data.appcode,
        bucket: 'direct-text',
        key,
        originalName: data.originalName,
        mimetype: 'text/markdown',
        size: Buffer.byteLength(content, 'utf8'),
        checksum,
        status: KNOWLEDGE_FILE_STATUS.indexing,
        metadata: data.metadata,
      },
      update: {
        originalName: data.originalName,
        mimetype: 'text/markdown',
        size: Buffer.byteLength(content, 'utf8'),
        checksum,
        status: KNOWLEDGE_FILE_STATUS.indexing,
        errorMessage: null,
        metadata: data.metadata,
      },
    });

    try {
      const result = await this.indexTextContent({
        fileId: file.id,
        appcode: data.appcode,
        sections: [
          {
            title: data.originalName,
            content,
            metadata: data.metadata,
          },
        ],
        embeddingModelId: data.embeddingModelId,
      });

      return {
        fileId: file.id,
        originalName: data.originalName,
        key,
        ...result,
      };
    } catch (error) {
      await this.prisma.knowledgeFile.update({
        where: { id: file.id },
        data: {
          status: KNOWLEDGE_FILE_STATUS.failed,
          errorMessage:
            error instanceof Error ? error.message : 'Unknown indexing error',
        },
      });

      throw error;
    }
  }

  private async indexTextContent(data: {
    fileId: string;
    appcode: string;
    sections: Parameters<ChunkingService['createChunks']>[0];
    embeddingModelId?: string | null;
  }) {
    const chunks = this.chunkingService.createChunks(data.sections);

    if (chunks.length === 0) {
      throw new BadRequestException('인덱싱할 텍스트를 찾을 수 없습니다.');
    }

    const embeddingModel =
      data.embeddingModelId ?? this.embeddingService.getDefaultEmbeddingModelId();
    const rows = await Promise.all(
      chunks.map(async (content, index) => {
        const embedding = await this.embeddingService.createEmbedding(
          content.content,
          embeddingModel,
        );

        return {
          fileId: data.fileId,
          appcode: data.appcode,
          chunkNo: index,
          content: content.content,
          contentHash: this.sha256(Buffer.from(content.content)),
          tokenCount: this.estimateTokenCount(content.content),
          metadata: content.metadata as Prisma.InputJsonObject,
          embedding,
          embeddingModel,
        };
      }),
    );

    await this.prisma.$transaction([
      this.prisma.knowledgeChunk.deleteMany({
        where: { fileId: data.fileId },
      }),
      this.prisma.knowledgeChunk.createMany({
        data: rows,
      }),
      this.prisma.knowledgeFile.update({
        where: { id: data.fileId },
        data: {
          status: KNOWLEDGE_FILE_STATUS.indexed,
          indexedAt: new Date(),
          errorMessage: null,
        },
      }),
    ]);
    await this.syncFileEmbeddingVectors(data.fileId);

    return {
      status: 'indexed',
      chunkCount: rows.length,
      embeddingModel,
    };
  }

  async search(
    dto: KnowledgeSearchDto,
    appInfo:
      | string
      | { appcode: string; defaultEmbeddingModelId: string | null },
  ) {
    const appcode = typeof appInfo === 'string' ? appInfo : appInfo.appcode;
    const embeddingModelId =
      typeof appInfo === 'string' ? null : appInfo.defaultEmbeddingModelId;
    const limit = dto.limit ?? 5;
    const matches = await this.findMatches(
      dto.query,
      appcode,
      limit,
      embeddingModelId,
      dto.scoreThreshold,
    );

    return {
      query: dto.query,
      count: matches.length,
      matches,
    };
  }

  async createRagResponse(
    dto: KnowledgeRagResponseDto,
    appInfo:
      | string
      | {
          appcode: string;
          defaultModelId: string | null;
          defaultEmbeddingModelId: string | null;
          systemPrompt: string | null;
          monthlyTokenLimit: number | null;
        },
  ) {
    const appContext = this.toKnowledgeAppContext(appInfo);
    const appcode = appContext.appcode;
    const embeddingModel =
      appContext.defaultEmbeddingModelId ??
      this.embeddingService.getDefaultEmbeddingModelId();
    const startedAt = Date.now();
    const limit = dto.limit ?? 5;
    const includeSources = dto.includeSources ?? true;
    const includeSourceContent = dto.includeSourceContent ?? false;
    const strict = dto.strict ?? true;
    const noAnswerMessage =
      dto.noAnswerMessage ?? '관련 자료를 찾을 수 없어 답변할 수 없습니다.';

    await this.ensureMonthlyTokenBudget(appContext);

    const matches = await this.findMatches(
      dto.query,
      appcode,
      limit,
      embeddingModel,
      dto.scoreThreshold,
    );
    const modelId =
      dto.modelId ??
      appContext.defaultModelId ??
      this.configService.get<string>('BEDROCK_MODEL_ID');

    if (!modelId) {
      throw new BadRequestException('BEDROCK_MODEL_ID 설정이 필요합니다.');
    }

    if (matches.length === 0 && strict) {
      const response = noAnswerMessage;
      const latencyMs = Date.now() - startedAt;

      await this.createQueryLog({
        appcode,
        question: dto.query,
        response,
        matchedChunkIds: [],
        modelId,
        embeddingModel,
        responsetime: latencyMs,
      });

      return {
        query: dto.query,
        answer: response,
        response,
        answerable: false,
        modelId,
        embeddingModel,
        retrieval: {
          count: 0,
          limit,
          scoreThreshold: dto.scoreThreshold ?? null,
        },
        usage: null,
        latencyMs,
        sources: includeSources ? [] : undefined,
      };
    }

    const result = await this.bedrockClient.send(
      new ConverseCommand({
        modelId,
        messages: [
          {
            role: 'user',
            content: [
              {
                text: this.createRagPrompt(dto, matches),
              },
            ],
          },
        ],
        system: [
          {
            text:
              dto.system ??
              appContext.systemPrompt ??
              '너는 제공된 참고자료에 근거해서만 답변하는 한국어 업무 지원 AI다. 참고자료에 없는 내용은 추측하지 말고 확인할 수 없다고 답한다.',
          },
        ],
        inferenceConfig: {
          maxTokens: dto.maxTokens ?? 1024,
          temperature: dto.temperature ?? 0.2,
        },
      }),
    );

    const response = this.extractConverseText(result);
    const latencyMs = Date.now() - startedAt;

    await this.createQueryLog({
      appcode,
      question: dto.query,
      response,
      matchedChunkIds: matches.map((match) => match.id),
      modelId,
      embeddingModel,
      responsetime: latencyMs,
      inputtokens: result.usage?.inputTokens,
      outputtokens: result.usage?.outputTokens,
      totaltokens: result.usage?.totalTokens,
    });

    return {
      query: dto.query,
      answer: response,
      response,
      answerable: matches.length > 0,
      modelId,
      embeddingModel,
      retrieval: {
        count: matches.length,
        limit,
        scoreThreshold: dto.scoreThreshold ?? null,
      },
      usage: result.usage,
      latencyMs,
      sources: includeSources
        ? this.toRagSources(matches, { includeContent: includeSourceContent })
        : undefined,
    };
  }

  private async findMatches(
    query: string,
    appcode: string,
    limit: number,
    embeddingModelId?: string | null,
    scoreThreshold?: number,
  ) {
    const modelId =
      embeddingModelId ?? this.embeddingService.getDefaultEmbeddingModelId();
    const queryEmbedding = await this.embeddingService.createEmbedding(
      query,
      modelId,
    );
    const matches = await this.findMatchesWithPgVector({
      appcode,
      embeddingModel: modelId,
      queryEmbedding,
      limit,
      scoreThreshold,
    });

    if (matches) {
      return matches;
    }

    return this.findMatchesInMemory({
      appcode,
      embeddingModel: modelId,
      queryEmbedding,
      limit,
      scoreThreshold,
    });
  }

  private async findMatchesWithPgVector(data: {
    appcode: string;
    embeddingModel: string;
    queryEmbedding: number[];
    limit: number;
    scoreThreshold?: number;
  }): Promise<
    | Array<{
        id: string;
        fileId: string;
        fileName: string;
        key: string;
        content: string;
        score: number;
        metadata: Prisma.JsonValue | null;
      }>
    | null
  > {
    const vector = this.toVectorLiteral(data.queryEmbedding);
    const threshold = data.scoreThreshold ?? -1;

    try {
      return await this.prisma.$queryRaw<
        Array<{
          id: string;
          fileId: string;
          fileName: string;
          key: string;
          content: string;
          score: number;
          metadata: Prisma.JsonValue | null;
        }>
      >`
        SELECT
          kc."id",
          kc."file_id" AS "fileId",
          kf."original_name" AS "fileName",
          kf."key",
          kc."content",
          1 - (kc."embedding_vector" <=> ${vector}::vector) AS "score",
          kc."metadata"
        FROM "knowledge_chunk" kc
        JOIN "knowledge_file" kf ON kf."id" = kc."file_id"
        WHERE kc."appcode" = ${data.appcode}
          AND kc."embedding_model" = ${data.embeddingModel}
          AND kc."embedding_vector" IS NOT NULL
          AND kf."status" = ${KNOWLEDGE_FILE_STATUS.indexed}
          AND 1 - (kc."embedding_vector" <=> ${vector}::vector) >= ${threshold}
        ORDER BY kc."embedding_vector" <=> ${vector}::vector
        LIMIT ${data.limit}
      `;
    } catch (error) {
      if (this.isPgVectorUnavailable(error)) {
        return null;
      }

      throw error;
    }
  }

  private async findMatchesInMemory(data: {
    appcode: string;
    embeddingModel: string;
    queryEmbedding: number[];
    limit: number;
    scoreThreshold?: number;
  }) {
    const threshold = data.scoreThreshold ?? -1;
    const chunks = await this.prisma.knowledgeChunk.findMany({
      where: {
        appcode: data.appcode,
        embedding: {
          isEmpty: false,
        },
        embeddingModel: data.embeddingModel,
        file: {
          status: KNOWLEDGE_FILE_STATUS.indexed,
        },
      },
      include: {
        file: true,
      },
    });

    return chunks
      .map((chunk) => ({
        id: chunk.id,
        fileId: chunk.fileId,
        fileName: chunk.file.originalName,
        key: chunk.file.key,
        content: chunk.content,
        score: this.cosineSimilarity(data.queryEmbedding, chunk.embedding),
        metadata: chunk.metadata,
      }))
      .filter((match) => match.score >= threshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, data.limit);
  }

  private async syncFileEmbeddingVectors(fileId: string) {
    try {
      await this.prisma.$executeRaw`
        UPDATE "knowledge_chunk"
        SET "embedding_vector" = ('[' || array_to_string("embedding", ',') || ']')::vector
        WHERE "file_id" = ${fileId}::uuid
          AND "embedding_vector" IS NULL
          AND cardinality("embedding") = 1024
      `;
    } catch (error) {
      if (!this.isPgVectorUnavailable(error)) {
        throw error;
      }
    }
  }

  private toVectorLiteral(values: number[]) {
    return `[${values.join(',')}]`;
  }

  private isPgVectorUnavailable(error: unknown) {
    if (!error || typeof error !== 'object') {
      return false;
    }

    const text = JSON.stringify(error);

    return (
      text.includes('embedding_vector') ||
      text.includes('type "vector" does not exist') ||
      text.includes('operator does not exist') ||
      text.includes('relation "knowledge_chunk" does not exist')
    );
  }

  private createRagPrompt(
    dto: KnowledgeRagResponseDto,
    matches: KnowledgeMatch[],
  ) {
    const references = matches
      .map(
        (match, index) => `[참고자료 ${index + 1}]
chunkId: ${match.id}
파일명: ${match.fileName}
S3 Key: ${match.key}
유사도: ${match.score.toFixed(4)}
메타데이터: ${JSON.stringify(match.metadata ?? {})}
내용:
${match.content}`,
      )
      .join('\n\n');
    const answerStyle = dto.answerStyle ?? 'concise';
    const styleGuide = {
      concise: '핵심 답변을 3~6문장 또는 짧은 bullet로 작성하세요.',
      detailed: '필요한 배경, 조건, 예외를 포함해 자세히 작성하세요.',
      report: '제목, 요약, 근거, 다음 조치 형식으로 보고서처럼 작성하세요.',
    }[answerStyle];

    return `아래 참고자료에 근거해서 사용자 질문에 답변하세요.

규칙:
- 참고자료에 있는 내용만 사용하세요.
- 참고자료에서 확인할 수 없는 내용은 "제공된 자료에서 확인할 수 없습니다."라고 답하세요.
- 답변 끝에 사용한 참고자료 번호를 간단히 표시하세요.
- ${styleGuide}

${references}

[사용자 질문]
${dto.query}`;
  }

  private toRagSources(
    matches: KnowledgeMatch[],
    options: { includeContent: boolean },
  ) {
    return matches.map((match, index) => ({
      index: index + 1,
      chunkId: match.id,
      fileId: match.fileId,
      fileName: match.fileName,
      key: match.key,
      score: match.score,
      metadata: match.metadata,
      ...(options.includeContent
        ? { content: this.truncate(match.content, 1200) }
        : {}),
    }));
  }

  private toKnowledgeAppContext(
    appInfo: string | KnowledgeAppContext,
  ): KnowledgeAppContext {
    if (typeof appInfo === 'string') {
      return {
        appcode: appInfo,
        defaultModelId: null,
        defaultEmbeddingModelId: null,
        systemPrompt: null,
        monthlyTokenLimit: null,
      };
    }

    return appInfo;
  }

  private async ensureMonthlyTokenBudget(appInfo: KnowledgeAppContext) {
    if (!appInfo.monthlyTokenLimit) {
      return;
    }

    const startOfMonth = new Date();
    startOfMonth.setUTCDate(1);
    startOfMonth.setUTCHours(0, 0, 0, 0);

    const aggregate = await this.prisma.knowledgeQueryLog.aggregate({
      where: {
        appcode: appInfo.appcode,
        createdAt: {
          gte: startOfMonth,
        },
      },
      _sum: {
        totaltokens: true,
      },
    });

    const usedTokens = aggregate._sum.totaltokens ?? 0;

    if (usedTokens >= appInfo.monthlyTokenLimit) {
      throw new BadRequestException(
        `월 token 사용 한도 ${appInfo.monthlyTokenLimit}를 초과했습니다.`,
      );
    }
  }

  private extractConverseText(result: ConverseCommandOutput) {
    const content = result.output?.message?.content ?? [];
    const text = content
      .map((item) => item.text)
      .filter((item): item is string => Boolean(item))
      .join('\n');

    return text || JSON.stringify(result.output ?? {});
  }

  private createQueryLog(data: {
    appcode: string;
    question: string;
    response?: string;
    matchedChunkIds?: string[];
    modelId?: string;
    embeddingModel?: string;
    responsetime?: number;
    inputtokens?: number;
    outputtokens?: number;
    totaltokens?: number;
  }) {
    return this.prisma.knowledgeQueryLog.create({
      data: {
        appcode: data.appcode,
        question: data.question,
        response: data.response,
        matchedChunkIds: data.matchedChunkIds ?? [],
        modelId: data.modelId,
        embeddingModel: data.embeddingModel,
        responsetime: data.responsetime,
        inputtokens: data.inputtokens,
        outputtokens: data.outputtokens,
        totaltokens: data.totaltokens,
      },
    });
  }

  private validateKnowledgeUpload(file: Express.Multer.File) {
    const extension = extname(file.originalname).toLowerCase();
    const allowedExtensions = this.getAllowedExtensions();

    if (!allowedExtensions.includes(extension)) {
      throw new BadRequestException(
        `지원하지 않는 파일 형식입니다. 허용 확장자: ${allowedExtensions.join(', ')}`,
      );
    }

    const maxFileSizeMb =
      this.configService.get<number>('KNOWLEDGE_MAX_FILE_SIZE_MB') ?? 30;
    const maxBytes = maxFileSizeMb * 1024 * 1024;

    if (file.size > maxBytes) {
      throw new BadRequestException(
        `파일 크기는 ${maxFileSizeMb}MB 이하여야 합니다.`,
      );
    }
  }

  private async ensureStorageQuota(
    appcode: string,
    nextFileSize: number,
    maxStorageMb: number | null,
  ) {
    if (!maxStorageMb) {
      return;
    }

    const aggregate = await this.prisma.knowledgeFile.aggregate({
      where: {
        appcode,
        status: { not: KNOWLEDGE_FILE_STATUS.archived },
      },
      _sum: {
        size: true,
      },
    });
    const currentSize = aggregate._sum.size ?? 0;
    const maxBytes = maxStorageMb * 1024 * 1024;

    if (currentSize + nextFileSize > maxBytes) {
      throw new BadRequestException(
        `앱 저장 용량 제한 ${maxStorageMb}MB를 초과합니다.`,
      );
    }
  }

  private getAllowedExtensions() {
    const configured = this.configService.get<string>(
      'KNOWLEDGE_ALLOWED_EXTENSIONS',
    );

    if (!configured) {
      return [...DEFAULT_ALLOWED_EXTENSIONS];
    }

    return configured
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
      .map((item) => (item.startsWith('.') ? item : `.${item}`));
  }

  private asJsonObject(value: Prisma.JsonValue) {
    if (!value || Array.isArray(value) || typeof value !== 'object') {
      return null;
    }

    return value as Prisma.InputJsonObject;
  }

  private cosineSimilarity(left: number[], right: number[]) {
    let dot = 0;
    let leftNorm = 0;
    let rightNorm = 0;
    const length = Math.min(left.length, right.length);

    for (let index = 0; index < length; index += 1) {
      dot += left[index] * right[index];
      leftNorm += left[index] * left[index];
      rightNorm += right[index] * right[index];
    }

    if (!leftNorm || !rightNorm) {
      return 0;
    }

    return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
  }

  private estimateTokenCount(text: string) {
    return Math.ceil(text.length / 4);
  }

  private truncate(text: string, maxLength: number) {
    if (text.length <= maxLength) {
      return text;
    }

    return `${text.slice(0, maxLength)}...`;
  }

  private sha256(value: Buffer) {
    return createHash('sha256').update(value).digest('hex');
  }

  private toSafeFileName(fileName: string) {
    return (
      fileName
        .trim()
        .replace(/\\/g, '/')
        .split('/')
        .at(-1)
        ?.replace(/[^a-zA-Z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 120) || 'knowledge.md'
    );
  }

  private toSafePathPart(value: string) {
    return value
      .trim()
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 100);
  }

  private createDemoStoreKnowledge() {
    return `# HJ 생활마켓 강남점 매장 안내 RAG 지식

## 매장 기본 정보
- 매장명: HJ 생활마켓 강남점
- 운영 시간: 매일 10:00-22:00
- 안내 데스크 위치: 1층 입구 오른쪽, 계산대 1번 옆
- 결제: 현금, 카드, 간편결제 가능
- 교환/환불: 구매 후 7일 이내, 영수증과 미사용 상품 필요
- 직원 호출: 각 통로 끝 빨간 호출 버튼 또는 안내 데스크 문의

## 층별/구역 안내
- 1층 A구역: 생활용품, 청소도구, 주방소모품, 욕실용품
- 1층 B구역: 문구, 사무용품, 포장재, 파티용품
- 2층 C구역: 인테리어 소품, 수납, 조명, 패브릭
- 2층 D구역: 미용, 위생, 여행용품, 반려동물용품
- 계산대: 1층 출구 앞
- 재고 문의/대량 구매 상담: 안내 데스크

## 대표 상품 위치와 재고
- 멀티탭 3구 2m: 1층 A-04 전기소품 선반, 재고 18개, 가격 5,000원
- AA 건전지 8입: 1층 A-04 계산대 방향 끝 진열대, 재고 42개, 가격 3,000원
- 먼지 제거 돌돌이: 1층 A-02 청소용품 코너, 재고 27개, 가격 2,000원
- 욕실 슬리퍼: 1층 A-07 욕실용품 하단 선반, 재고 16개, 가격 3,000원
- 논슬립 옷걸이 10개입: 2층 C-03 수납/옷장 코너, 재고 31개, 가격 2,000원
- 투명 리빙박스 24L: 2층 C-02 수납박스 진열 구역, 재고 12개, 가격 6,000원
- 접착식 후크 6입: 2층 C-01 인테리어 소품 벽면, 재고 35개, 가격 1,000원
- LED 무드등: 2층 C-05 조명 코너 중앙 매대, 재고 9개, 가격 5,000원
- 스테인리스 집게: 1층 A-05 주방도구 코너, 재고 22개, 가격 1,000원
- 지퍼백 대형 20매: 1층 A-06 주방소모품 코너, 재고 48개, 가격 2,000원
- 양면테이프: 1층 B-02 문구/테이프 선반, 재고 40개, 가격 1,000원
- 포장 리본 세트: 1층 B-05 포장재 코너, 재고 24개, 가격 1,000원
- A4 클리어파일 20매: 1층 B-01 사무용품 코너, 재고 33개, 가격 2,000원
- 생일초 숫자 세트: 1층 B-06 파티용품 코너, 재고 19개, 가격 1,000원
- 여행용 공병 3종: 2층 D-02 여행용품 코너, 재고 28개, 가격 2,000원
- 휴대용 칫솔살균 케이스: 2층 D-01 위생용품 코너, 재고 7개, 가격 5,000원
- 고양이 장난감 낚싯대: 2층 D-05 반려동물 코너, 재고 14개, 가격 3,000원
- 강아지 배변봉투: 2층 D-05 반려동물 코너, 재고 26개, 가격 2,000원
- 헤어롤 대형 4개입: 2층 D-03 미용소품 코너, 재고 21개, 가격 1,000원
- 손톱깎이 세트: 2층 D-03 미용소품 코너 계산대 방향, 재고 17개, 가격 2,000원

## 추천 응대 규칙
- 사용자가 상품 위치를 물으면 층, 구역 코드, 주변 표식을 함께 안내한다.
- 사용자가 재고를 물으면 제공된 재고 수량 기준으로 답한다.
- 사용자가 비슷한 상품을 찾으면 같은 구역의 대체 상품을 추천한다.
- 제공된 지식에 없는 상품은 "제공된 자료에서 확인할 수 없습니다."라고 답하고 안내 데스크 문의를 권한다.
- 길 안내는 입구 기준으로 설명한다. 예: "입구에서 오른쪽 생활용품 통로로 들어가 A-04 표지판을 찾으세요."

## 자주 묻는 질문
- 우산은 현재 데모 지식에 등록되어 있지 않다.
- 충전 케이블은 현재 데모 지식에 등록되어 있지 않다.
- 멀티탭과 건전지는 같은 A-04 전기소품 코너에 있다.
- 포장 관련 상품은 B-05 포장재 코너와 B-06 파티용품 코너를 함께 안내하면 좋다.
- 반려동물 상품은 2층 D-05 한 구역에 모여 있다.`;
  }
}
