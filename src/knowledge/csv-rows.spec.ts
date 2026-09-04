import { parseCsvRows } from './csv-rows';
import { DocumentParserService } from './document-parser.service';
import { ChunkingService } from './chunking.service';

describe('CSV structured records', () => {
  it('handles BOM, quoted commas, escaped quotes and multiline fields', () => {
    expect(
      parseCsvRows(
        '\uFEFFname,note\r\n"box, large","line1\nline2 ""quoted"""\r\n',
      ),
    ).toEqual([
      ['name', 'note'],
      ['box, large', 'line1\nline2 "quoted"'],
    ]);
  });
  it.each([
    'a,b\n"open,b',
    'a,a\nx,y',
    'a,b\nx',
    'a,b\nx,y,z',
    'a,b\n"x"oops,y',
    'a,b\nx"y,z',
    'a,b',
  ])('rejects invalid CSV %s', (text) => {
    expect(() => parseCsvRows(text)).toThrow();
  });
  it('bounds field size', () =>
    expect(() => parseCsvRows(`a\n${'x'.repeat(100001)}`)).toThrow());
  it('creates one searchable chunk per record', async () => {
    const parsed = await new DocumentParserService().parse({
      body: Buffer.from('name,price\n멀티탭,5000\n건전지,3000'),
      fileName: 'products.csv',
      contentType: 'text/csv',
    });
    const chunks = new ChunkingService().createChunks(parsed.sections);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].content).toBe('name: 멀티탭\nprice: 5000');
    expect(chunks[0].metadata.chunkStrategy).toBe('structured-row');
    expect(chunks[0].content).not.toContain('건전지');
  });
});
