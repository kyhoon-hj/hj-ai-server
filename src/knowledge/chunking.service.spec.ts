import { ChunkingService } from './chunking.service';

describe('ChunkingService', () => {
  let service: ChunkingService;

  beforeEach(() => {
    service = new ChunkingService();
  });

  it('keeps xlsx rows as single structured chunks', () => {
    const chunks = service.createChunks([
      {
        title: '상품목록 row 2',
        content: '상품명: 멀티탭 3구 2m\n위치: 1층 A-04',
        metadata: {
          sourceType: 'xlsx',
          sheetName: '상품목록',
          rowNumber: 2,
        },
      },
    ]);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].metadata).toMatchObject({
      chunkStrategy: 'structured-row',
      sheetName: '상품목록',
      rowNumber: 2,
    });
  });

  it('splits long text with overlap and metadata', () => {
    const chunks = service.createChunks(
      [
        {
          title: 'manual.md',
          content: 'A'.repeat(80) + '\n\n' + 'B'.repeat(80),
          metadata: {
            sourceType: 'md',
          },
        },
      ],
      { chunkSize: 60, overlap: 10 },
    );

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].metadata).toMatchObject({
      chunkStrategy: 'text-window',
      sectionTitle: 'manual.md',
      sectionIndex: 0,
      sectionChunkIndex: 0,
    });
  });

  it('treats a non-string source type as plain text', () => {
    const chunks = service.createChunks(
      [
        {
          title: 'invalid-metadata.txt',
          content: 'A'.repeat(40),
          metadata: { sourceType: { unexpected: true } },
        },
      ],
      { chunkSize: 20, overlap: 5 },
    );

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].metadata).toMatchObject({
      chunkStrategy: 'text-window',
      sourceType: { unexpected: true },
    });
  });
});
