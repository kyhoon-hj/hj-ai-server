import * as XLSX from 'xlsx';
import { DocumentParserService } from './document-parser.service';

describe('DocumentParserService', () => {
  let service: DocumentParserService;

  beforeEach(() => {
    service = new DocumentParserService();
  });

  it('parses text-like documents', async () => {
    const result = await service.parse({
      body: Buffer.from('상품명: 멀티탭\n위치: 1층 A-04'),
      contentType: 'text/markdown',
      fileName: 'store.md',
    });

    expect(result.content).toContain('멀티탭');
    expect(result.sections).toHaveLength(1);
    expect(result.metadata.sourceType).toBe('md');
  });

  it('parses workbook rows into searchable field blocks', async () => {
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet([
      {
        상품명: '멀티탭 3구 2m',
        위치: '1층 A-04',
        재고: '18개',
      },
      {
        상품명: '고양이 장난감 낚싯대',
        위치: '2층 D-05',
        재고: '14개',
      },
    ]);
    XLSX.utils.book_append_sheet(workbook, worksheet, '상품목록');
    const body = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    const result = await service.parse({
      body,
      contentType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      fileName: 'products.xlsx',
    });

    expect(result.sections).toHaveLength(2);
    expect(result.sections[0].content).toContain('상품명: 멀티탭 3구 2m');
    expect(result.sections[0].content).toContain('시트: 상품목록');
    expect(result.sections[0].metadata).toMatchObject({
      sourceType: 'xlsx',
      sheetName: '상품목록',
      rowNumber: 2,
    });
  });
});
