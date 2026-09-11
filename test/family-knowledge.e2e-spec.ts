import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { ConflictException } from '@nestjs/common';
import { ChunkingService } from '../src/knowledge/chunking.service';
import { ConversationService } from '../src/conversation/conversation.service';
import { FamilyKnowledgeIndexJobService } from '../src/family-knowledge/family-knowledge-index-job.service';
import { FamilyKnowledgeIndexService } from '../src/family-knowledge/family-knowledge-index.service';
import { FamilyKnowledgeSearchService } from '../src/family-knowledge/family-knowledge-search.service';
import { FamilyKnowledgeService } from '../src/family-knowledge/family-knowledge.service';
import { FamilyEmbeddingUsageService } from '../src/family-knowledge/family-embedding-usage.service';
import { PrismaService } from '../src/prisma/prisma.service';

const suite =
  process.env.RUN_QUEUE_HTTP_E2E === 'true' ? describe : describe.skip;
const vector = [1, ...Array<number>(1023).fill(0)];
const appcode = 'FAMILY_E2E';
const tenantRef = 'a'.repeat(64);
const otherTenantRef = 'b'.repeat(64);

suite('Family RAG lifecycle (isolated PostgreSQL)', () => {
  let prisma: PrismaService;
  let familyKnowledge: FamilyKnowledgeService;
  let jobs: FamilyKnowledgeIndexJobService;
  let search: FamilyKnowledgeSearchService;
  let conversation: ConversationService;
  const embed = jest.fn<Promise<number[]>, [string, string, AbortSignal?]>();
  const send = jest.fn();
  const config = new ConfigService({
    ...process.env,
    AWS_REGION: 'us-east-1',
    FRAME_CONVERSATION_APPCODES: appcode,
    FRAME_CONVERSATION_MODEL_ID: 'family-e2e-model',
    FRAME_FAMILY_RAG_ENABLED: 'true',
    FRAME_FAMILY_RAG_APPCODES: appcode,
    FRAME_FAMILY_EMBEDDING_MONTHLY_LIMIT: '1000',
    KNOWLEDGE_INDEX_MAX_ATTEMPTS: '3',
    KNOWLEDGE_INDEX_RETRY_DELAY_MS: '100',
    KNOWLEDGE_EMBEDDING_CONCURRENCY: '1',
  });
  const embedding = {
    getDefaultEmbeddingModelId: () => 'family-e2e-embedding',
    createEmbedding: embed,
  };

  beforeAll(async () => {
    expect(new URL(process.env.DATABASE_URL!).pathname).toMatch(
      /^\/queue_e2e_[a-f0-9]{32}$/,
    );
    prisma = new PrismaService();
    await prisma.$connect();
    await prisma.appInfo.create({
      data: {
        appcode,
        appname: 'Family RAG integration',
        defaultEmbeddingModelId: 'family-e2e-embedding',
      },
    });
    familyKnowledge = new FamilyKnowledgeService(prisma, config);
    const embeddingUsage = new FamilyEmbeddingUsageService(prisma, config);
    const indexer = new FamilyKnowledgeIndexService(
      prisma,
      new ChunkingService(),
      embedding as never,
      config,
      embeddingUsage,
    );
    jobs = new FamilyKnowledgeIndexJobService(prisma, indexer, config);
    search = new FamilyKnowledgeSearchService(
      prisma,
      embedding as never,
      embeddingUsage,
    );
    conversation = new ConversationService(config, prisma, search);
    Object.defineProperty(conversation, 'client', {
      value: { send, destroy: jest.fn() },
    });
  });

  beforeEach(async () => {
    await prisma.familyConversationMetric.deleteMany({ where: { appcode } });
    await prisma.familyEmbeddingUsage.deleteMany({ where: { appcode } });
    await prisma.familyKnowledgeEvent.deleteMany({ where: { appcode } });
    await prisma.familyKnowledgeDocument.deleteMany({ where: { appcode } });
    embed.mockReset().mockResolvedValue(vector);
    send.mockReset().mockResolvedValue({
      output: {
        message: {
          content: [{ text: '가족 기록에 따르면 토요일 오후에 만나요.' }],
        },
      },
      stopReason: 'end_turn',
      usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
    });
  });

  afterAll(async () => {
    conversation?.onModuleDestroy();
    await jobs?.onModuleDestroy();
    await prisma?.familyConversationMetric.deleteMany({ where: { appcode } });
    await prisma?.familyEmbeddingUsage.deleteMany({ where: { appcode } });
    await prisma?.familyKnowledgeEvent.deleteMany({ where: { appcode } });
    await prisma?.familyKnowledgeDocument.deleteMany({ where: { appcode } });
    await prisma?.appInfo.deleteMany({ where: { appcode } });
    await prisma?.$disconnect();
  });

  const event = (
    overrides: Partial<{
      sourceId: string;
      sourceVersion: number;
      operation: 'UPSERT' | 'DELETE';
      tenantRef: string;
      title: string;
      content: string;
    }> = {},
  ) => ({
    sourceId: 'family-story',
    sourceVersion: 1,
    operation: 'UPSERT' as const,
    tenantRef,
    audience: 'FAMILY' as const,
    sourceType: 'TEXT' as const,
    sensitivity: 'NON_SENSITIVE' as const,
    title: '가족 모임',
    content: '가족 모임은 토요일 오후 세 시에 거실에서 열립니다.',
    publishedAt: '2026-09-10T00:00:00.000Z',
    ...overrides,
  });

  const appInfo = () => ({
    id: randomUUID(),
    appcode,
    allowedAccessLevels: [],
    status: 'active',
    s3Prefix: null,
    defaultModelId: null,
    defaultEmbeddingModelId: 'family-e2e-embedding',
    systemPrompt: null,
    maxStorageMb: null,
    monthlyTokenLimit: null,
    metadata: null,
  });

  async function indexFamilyEvent(sourceId = 'family-story') {
    const accepted = await familyKnowledge.receiveEvent(
      event({ sourceId }),
      appcode,
    );
    await jobs.drain(appcode);
    return prisma.familyKnowledgeEvent.findUniqueOrThrow({
      where: { id: accepted.eventId },
    });
  }

  it('applies migrations and completes event, pgvector search and grounded conversation', async () => {
    const accepted = await familyKnowledge.receiveEvent(event(), appcode);
    expect(accepted).toMatchObject({ status: 'QUEUED', replayed: false });
    await expect(
      familyKnowledge.receiveEvent(event(), appcode),
    ).resolves.toMatchObject({
      eventId: accepted.eventId,
      replayed: true,
    });

    await jobs.drain(appcode);
    await expect(
      prisma.familyKnowledgeEvent.findUniqueOrThrow({
        where: { id: accepted.eventId },
      }),
    ).resolves.toMatchObject({
      status: 'SUCCEEDED',
      resultCode: 'INDEXED',
      attemptCount: 1,
    });
    const stored = await prisma.$queryRaw<
      Array<{ dimensions: number; vector: string }>
    >`
      SELECT vector_dims("embedding_vector") AS dimensions,
        "embedding_vector"::text AS vector
      FROM "family_knowledge_chunk"
      WHERE "appcode" = ${appcode}
    `;
    expect(stored.length).toBeGreaterThan(0);
    expect(
      stored.every(
        (row) =>
          row.dimensions === 1024 && row.vector === `[${vector.join(',')}]`,
      ),
    ).toBe(true);

    const evidence = await search.search(
      {
        query: '가족 모임은 언제인가요?',
        tenantRef,
        audience: 'FAMILY',
        limit: 5,
      },
      appInfo(),
    );
    expect(evidence.results).toEqual([
      expect.objectContaining({ sourceId: 'family-story', sourceVersion: 1 }),
    ]);
    await expect(
      search.search(
        {
          query: '가족 모임은 언제인가요?',
          tenantRef: otherTenantRef,
          audience: 'FAMILY',
          limit: 5,
        },
        appInfo(),
      ),
    ).resolves.toEqual({ results: [] });

    const requestId = randomUUID();
    const result = await conversation.turn(
      {
        requestId,
        sessionRef: randomUUID(),
        policyVersion: 'frame-family-rag-v1',
        contextFacts: {
          text: '오늘은 금요일입니다.',
          version: 'c'.repeat(64),
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        },
        scope: { tenantRef, audience: 'FAMILY' },
        messages: [{ role: 'user', text: '가족 모임은 언제인가요?' }],
        maxOutputTokens: 128,
      },
      appInfo(),
    );
    expect(result.text).toContain('토요일');
    const command = (send.mock.calls as unknown[][])[0][0] as {
      input: { messages?: unknown };
    };
    expect(JSON.stringify(command.input.messages)).toContain(
      '가족 모임은 토요일 오후 세 시에 거실에서 열립니다.',
    );
    expect(JSON.stringify(command.input.messages)).toContain(
      '오늘은 금요일입니다.',
    );
    await expect(
      prisma.familyConversationMetric.findUniqueOrThrow({
        where: {
          id: (
            await prisma.familyConversationMetric.findFirstOrThrow({
              where: { requestId },
            })
          ).id,
        },
      }),
    ).resolves.toMatchObject({
      appcode,
      policyVersion: 'frame-family-rag-v1',
      status: 'SUCCEEDED',
      resultCount: 1,
      inputTokens: 20,
      outputTokens: 10,
      totalTokens: 30,
    });
  });

  it('persists retry state and succeeds after a transient embedding failure', async () => {
    embed
      .mockRejectedValueOnce(
        Object.assign(new Error('PRIVATE_TRANSIENT_DETAIL'), {
          name: 'ThrottlingException',
          $metadata: { httpStatusCode: 429 },
        }),
      )
      .mockResolvedValue(vector);
    const accepted = await familyKnowledge.receiveEvent(
      event({ sourceId: 'retry-story' }),
      appcode,
    );

    await jobs.drain(appcode);
    await expect(
      prisma.familyKnowledgeEvent.findUniqueOrThrow({
        where: { id: accepted.eventId },
      }),
    ).resolves.toMatchObject({
      status: 'RETRY',
      resultCode: 'RETRY_SCHEDULED',
      errorCode: 'UPSTREAM_THROTTLED',
      attemptCount: 1,
      retryable: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 125));
    await jobs.drain(appcode);
    const completed = await prisma.familyKnowledgeEvent.findUniqueOrThrow({
      where: { id: accepted.eventId },
    });
    expect(completed).toMatchObject({
      status: 'SUCCEEDED',
      resultCode: 'INDEXED',
      attemptCount: 2,
      retryable: false,
    });
    expect(JSON.stringify(completed)).not.toContain('PRIVATE_TRANSIENT_DETAIL');
  });

  it('removes deleted chunks and rejects a reply when evidence changes in flight', async () => {
    await indexFamilyEvent();
    const requestId = randomUUID();
    send.mockImplementationOnce(async () => {
      await familyKnowledge.receiveEvent(
        event({
          sourceVersion: 2,
          operation: 'DELETE',
          title: undefined,
          content: undefined,
        }),
        appcode,
      );
      return {
        output: { message: { content: [{ text: '삭제 전 자료 기반 답변' }] } },
        stopReason: 'end_turn',
        usage: { inputTokens: 2, outputTokens: 2, totalTokens: 4 },
      };
    });

    await expect(
      conversation.turn(
        {
          requestId,
          sessionRef: randomUUID(),
          policyVersion: 'frame-family-rag-v1',
          scope: { tenantRef, audience: 'FAMILY' },
          messages: [{ role: 'user', text: '가족 모임은 언제인가요?' }],
          maxOutputTokens: 128,
        },
        appInfo(),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      prisma.familyKnowledgeChunk.count({ where: { appcode } }),
    ).resolves.toBe(0);
    await expect(
      prisma.familyConversationMetric.count({ where: { requestId } }),
    ).resolves.toBe(0);
  });
});
