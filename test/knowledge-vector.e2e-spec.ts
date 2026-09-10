import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../src/prisma/prisma.service';
import { KnowledgeService } from '../src/knowledge/knowledge.service';
import { KnowledgeIndexJobService } from '../src/knowledge/knowledge-index-job.service';
import { ChunkingService } from '../src/knowledge/chunking.service';
import { DocumentParserService } from '../src/knowledge/document-parser.service';

const suite =
  process.env.RUN_QUEUE_HTTP_E2E === 'true' ? describe : describe.skip;
const vector = Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0));

suite('Real parser, chunks and pgvector (isolated PostgreSQL)', () => {
  let prisma: PrismaService;
  let knowledge: KnowledgeService;
  let jobs: KnowledgeIndexJobService;
  let fileId: string;
  let body: string;
  const embed = jest.fn<Promise<number[]>, [string]>();
  const appcode = 'VECTOR_E2E';
  beforeAll(async () => {
    expect(new URL(process.env.DATABASE_URL!).pathname).toMatch(
      /^\/queue_e2e_[a-f0-9]{32}$/,
    );
    prisma = new PrismaService();
    await prisma.$connect();
    await prisma.appInfo.create({
      data: {
        appcode,
        appname: 'Vector integration',
        defaultEmbeddingModelId: 'fixed-vector',
      },
    });
    const config = new ConfigService({
      ...process.env,
      KNOWLEDGE_INDEX_WORKER_ENABLED: 'false',
      KNOWLEDGE_INDEX_RETRY_DELAY_MS: '100',
      KNOWLEDGE_EMBEDDING_CONCURRENCY: '1',
    });
    knowledge = new KnowledgeService(
      config,
      prisma,
      {
        downloadFileBuffer: () =>
          Promise.resolve({
            body: Buffer.from(body),
            contentType: 'text/plain',
          }),
      } as never,
      new DocumentParserService(),
      new ChunkingService(),
      {
        getDefaultEmbeddingModelId: () => 'fixed-vector',
        createEmbedding: embed,
      } as never,
    );
    jobs = new KnowledgeIndexJobService(prisma, knowledge, config);
  });
  beforeEach(async () => {
    await prisma.knowledgeFile.deleteMany({ where: { appcode } });
    embed.mockReset();
    embed.mockResolvedValue(vector);
    body = 'Original document content. '.repeat(200);
    const file = await prisma.knowledgeFile.create({
      data: {
        appcode,
        bucket: 'unused',
        key: `unused-${Date.now()}`,
        originalName: 'source.txt',
        mimetype: 'text/plain',
        size: Buffer.byteLength(body),
        accessLevel: 'PUBLIC',
        businessStatus: 'PUBLISHED',
      },
    });
    fileId = file.id;
  });
  afterAll(async () => {
    await jobs?.onModuleDestroy();
    await prisma?.knowledgeFile.deleteMany({ where: { appcode } });
    await prisma?.appInfo.deleteMany({ where: { appcode } });
    await prisma?.$disconnect();
  });

  async function indexFile() {
    const job = await jobs.submit(fileId, appcode, 'reindex');
    await jobs.drain(appcode);
    expect(await jobs.get(job.id, appcode)).toMatchObject({
      status: 'completed',
    });
  }
  async function storedVectors() {
    return prisma.$queryRaw<
      Array<{
        id: string;
        content: string;
        dimensions: number;
        value: string;
        provenance: unknown;
      }>
    >`
      SELECT id, content, vector_dims(embedding_vector) AS dimensions,
        embedding_vector::text AS value, index_provenance AS provenance
      FROM knowledge_chunk WHERE file_id = ${fileId}::uuid ORDER BY chunk_no
    `;
  }
  async function searchPgVector(tenant = appcode) {
    // Any in-memory fallback is a failure, not an alternative successful search.
    const fallback = jest
      .spyOn(prisma.knowledgeChunk, 'findMany')
      .mockImplementation(() => {
        throw new Error('Unexpected in-memory vector fallback');
      });
    try {
      const result = await knowledge.search(
        {
          query: 'document',
          scoreThreshold: 0.9,
          filters: {
            accessLevels: ['PUBLIC'],
            businessStatuses: ['PUBLISHED'],
          },
        },
        tenant,
      );
      expect(fallback).not.toHaveBeenCalled();
      return result;
    } finally {
      fallback.mockRestore();
    }
  }

  it('parses text into multiple chunks, stores 1024-dimensional vectors and searches with tenant/policy isolation', async () => {
    await indexFile();
    const rows = await storedVectors();
    expect(rows.length).toBeGreaterThan(1);
    expect(rows[0].provenance).toMatchObject({
      schemaVersion: 1,
      parser: 'text',
      parserVersion: 'multiformat-v2',
      indexRunId: expect.any(String) as unknown,
      sourceSha256: expect.stringMatching(/^[a-f0-9]{64}$/) as unknown,
      chunkSize: 3000,
      overlap: 300,
      embeddingModel: 'fixed-vector',
    });
    expect(
      rows.every(
        (row) =>
          row.dimensions === 1024 && row.value === `[${vector.join(',')}]`,
      ),
    ).toBe(true);
    const result = await searchPgVector();
    expect(result.matches.some((match) => match.fileId === fileId)).toBe(true);
    expect(
      result.matches.every((match) => Math.abs(match.score - 1) < 0.00001),
    ).toBe(true);
    expect((await searchPgVector('OTHER_VECTOR_TENANT')).count).toBe(0);
    await prisma.knowledgeFile.update({
      where: { id: fileId },
      data: { businessStatus: 'DRAFT' },
    });
    expect(
      (await searchPgVector()).matches.some((match) => match.fileId === fileId),
    ).toBe(false);
  });

  it('retains an answer execution snapshot after reindex and deletion without exposing provenance', async () => {
    await indexFile();
    const oldRows = await storedVectors();
    const send = jest.fn().mockResolvedValue({
      output: {
        message: {
          content: [
            {
              text: JSON.stringify({
                answerable: true,
                answer: 'Original document content.',
                sourceIndexes: [1],
              }),
            },
          ],
        },
      },
      stopReason: 'end_turn',
    });
    Object.defineProperty(knowledge, 'bedrockClient', {
      value: { send },
      configurable: true,
    });
    const requestId = `trace-${fileId}`;
    const result = await knowledge.createRagResponse(
      { query: 'Original?', modelId: 'test-model', includeSourceContent: true },
      appcode,
      requestId,
    );
    expect(JSON.stringify(result)).not.toContain('indexProvenance');
    expect(JSON.stringify((await searchPgVector()).matches)).not.toContain(
      'indexProvenance',
    );
    const log = await prisma.knowledgeQueryLog.findFirstOrThrow({
      where: { appcode, requestId },
    });
    expect(log.execution).toMatchObject({
      performance: result.performance,
      answerStatus: 'answered',
      citedSourceIndexes: [1],
      retrievedSources: expect.arrayContaining([
        expect.objectContaining({ indexProvenance: oldRows[0].provenance }),
      ]) as unknown,
    });
    body = 'Replacement document content. '.repeat(200);
    await indexFile();
    expect((await storedVectors())[0].provenance).not.toEqual(
      oldRows[0].provenance,
    );
    await prisma.knowledgeFile.delete({ where: { id: fileId } });
    expect(
      (
        await prisma.knowledgeQueryLog.findUniqueOrThrow({
          where: { id: log.id },
        })
      ).execution,
    ).toEqual(log.execution);
    await prisma.knowledgeQueryLog.delete({ where: { id: log.id } });
  });

  it('preserves existing chunk IDs and vectors on embedding failure, then replaces them on job retry', async () => {
    await indexFile();
    const previous = await storedVectors();
    body = 'Replacement document content. '.repeat(200);
    // Fail after one new embedding has already succeeded: no partial replacement may leak.
    embed.mockResolvedValueOnce(vector).mockRejectedValueOnce(
      Object.assign(new Error('Synthetic throttling'), {
        name: 'ThrottlingException',
        $metadata: { httpStatusCode: 429 },
      }),
    );
    const job = await jobs.submit(fileId, appcode, 'reindex');
    await jobs.drain(appcode);
    expect(await jobs.get(job.id, appcode)).toMatchObject({
      status: 'queued',
      attempt: 1,
      errorCode: 'UPSTREAM_THROTTLED',
    });
    expect(await storedVectors()).toEqual(previous);
    // A failed refresh retains the last successfully indexed snapshot for search.
    expect(
      (await searchPgVector()).matches.some((match) => match.fileId === fileId),
    ).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 150));
    await jobs.drain(appcode);
    expect(await jobs.get(job.id, appcode)).toMatchObject({
      status: 'completed',
      attempt: 2,
    });
    const updated = await storedVectors();
    expect(updated.length).toBeGreaterThan(1);
    expect(
      updated.every(
        (row) => row.dimensions === 1024 && row.content.includes('Replacement'),
      ),
    ).toBe(true);
    expect(
      updated.every((row) => !previous.some((old) => old.id === row.id)),
    ).toBe(true);
    expect(
      (await searchPgVector()).matches.some(
        (match) =>
          match.fileId === fileId && match.content.includes('Replacement'),
      ),
    ).toBe(true);
  });

  it('keeps the prior snapshot searchable while replacement embeddings are in flight', async () => {
    await indexFile();
    const previous = await storedVectors();
    let release!: (value: number[]) => void;
    let started!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    embed.mockImplementationOnce(() => {
      started();
      return new Promise<number[]>((resolve) => {
        release = resolve;
      });
    });
    body = 'Replacement document content. '.repeat(200);
    const operation = knowledge.indexKnowledgeFile(fileId, appcode);
    try {
      await entered;
      expect(await storedVectors()).toEqual(previous);
      expect(
        (await searchPgVector()).matches.some(
          (match) =>
            match.fileId === fileId && match.content.includes('Original'),
        ),
      ).toBe(true);
    } finally {
      release(vector);
      await operation;
    }
    expect(
      (await storedVectors()).every((row) =>
        row.content.includes('Replacement'),
      ),
    ).toBe(true);
  });

  it('rolls back chunk replacement when the real vector UPDATE fails', async () => {
    await indexFile();
    const previous = await storedVectors();
    const oldFile = await prisma.knowledgeFile.findUniqueOrThrow({
      where: { id: fileId },
    });
    // New replacement rows can be inserted, but their vector UPDATE must fail.
    await prisma.$executeRaw`ALTER TABLE knowledge_chunk ADD CONSTRAINT test_vector_failure CHECK (content NOT LIKE '%Replacement%' OR embedding_vector IS NULL) NOT VALID`;
    body = 'Replacement document content. '.repeat(200);
    try {
      await expect(
        knowledge.indexKnowledgeFile(fileId, appcode),
      ).rejects.toThrow();
      expect(await storedVectors()).toEqual(previous);
      const failedFile = await prisma.knowledgeFile.findUniqueOrThrow({
        where: { id: fileId },
      });
      expect(failedFile.status).toBe('indexed');
      expect(failedFile.indexedAt).toEqual(oldFile.indexedAt);
      expect(failedFile.metadata).toEqual(oldFile.metadata);
      expect(
        (await searchPgVector()).matches.some(
          (match) =>
            match.fileId === fileId && match.content.includes('Original'),
        ),
      ).toBe(true);
    } finally {
      await prisma.$executeRaw`ALTER TABLE knowledge_chunk DROP CONSTRAINT test_vector_failure`;
    }
    await knowledge.indexKnowledgeFile(fileId, appcode);
    expect(
      (await storedVectors()).every(
        (row) => row.dimensions === 1024 && row.content.includes('Replacement'),
      ),
    ).toBe(true);
  });

  it.each([false, true])(
    'rejects stale owner writes after ownership transfer (dependency fails: %s)',
    async (fail) => {
      await indexFile();
      const previous = await storedVectors();
      const job = await prisma.knowledgeIndexJob.create({
        data: {
          appcode,
          fileId,
          operation: 'reindex',
          status: 'processing',
          attempt: 1,
          leaseExpiresAt: new Date(Date.now() + 60000),
        },
      });
      let release!: () => void;
      let started!: () => void;
      const entered = new Promise<void>((resolve) => {
        started = resolve;
      });
      embed.mockImplementationOnce(
        () =>
          new Promise<number[]>((resolve, reject) => {
            release = () =>
              fail
                ? reject(new Error('Old dependency failed'))
                : resolve(vector);
            started();
          }),
      );
      body = 'Replacement document content. '.repeat(200);
      const operation = knowledge.indexKnowledgeFile(
        fileId,
        appcode,
        undefined,
        { id: job.id, attempt: 1 },
      );
      const outcome = operation.catch((error: unknown) => error);
      try {
        await entered;
        await prisma.knowledgeIndexJob.update({
          where: { id: job.id },
          data: { attempt: 2 },
        });
        await prisma.knowledgeFile.update({
          where: { id: fileId },
          data: { errorMessage: 'NEW_OWNER_STATE' },
        });
      } finally {
        release();
      }
      expect(await outcome).toBeInstanceOf(Error);
      expect(await storedVectors()).toEqual(previous);
      expect(
        await prisma.knowledgeFile.findUnique({ where: { id: fileId } }),
      ).toMatchObject({ status: 'indexed', errorMessage: 'NEW_OWNER_STATE' });
    },
  );
});
