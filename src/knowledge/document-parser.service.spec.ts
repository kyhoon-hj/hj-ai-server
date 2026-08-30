import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PDFParse } from 'pdf-parse';
import {
  DocumentParserService,
  validateWorkbookLimits,
  WORKBOOK_LIMITS,
} from './document-parser.service';

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
    const body = await readFile(
      join(process.cwd(), 'demo', 'fixtures', 'store-a-inventory.xlsx'),
    );

    const result = await service.parse({
      body,
      contentType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      fileName: 'store-a-inventory.xlsx',
    });

    expect(result.sections).toHaveLength(6);
    expect(result.sections[0].content).toContain('SKU: XLSX-LAMP-204');
    expect(result.sections[0].content).toContain('시트: Inventory');
    expect(result.sections[0].metadata).toMatchObject({
      sourceType: 'xlsx',
      sheetName: 'Inventory',
      rowNumber: 5,
    });
  });

  it('skips workbook title rows and preserves physical row numbers', async () => {
    const body = await readFile(
      join(process.cwd(), 'demo', 'fixtures', 'store-a-inventory.xlsx'),
    );
    const result = await service.parse({
      body,
      contentType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      fileName: 'store-a-inventory.xlsx',
    });

    expect(result.sections).toHaveLength(6);
    expect(result.metadata).toMatchObject({
      parser: 'read-excel-file',
      sourceType: 'xlsx',
      sheetNames: ['Inventory', 'Support'],
    });
    expect(result.sections[0]).toMatchObject({
      title: 'Inventory row 5',
      metadata: {
        headerRowNumber: 4,
        rowNumber: 5,
        sheetName: 'Inventory',
      },
    });
    expect(result.sections[0].content).toContain('SKU: XLSX-LAMP-204');
    expect(result.sections[3].content).toContain('Issue Code: XLSX-SVC-882');
  });

  it('parses the DOCX fixture including table text', async () => {
    const body = await readFile(
      join(process.cwd(), 'demo', 'fixtures', 'store-a-service-manual.docx'),
    );
    const result = await service.parse({
      body,
      contentType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      fileName: 'store-a-service-manual.docx',
    });

    expect(result.metadata).toMatchObject({
      parser: 'mammoth',
      sourceType: 'docx',
    });
    expect(result.content).toContain('DOCX-SVC-7319');
    expect(result.content).toContain('DOCX-PAIR-7319');
  });

  it('parses the PDF fixture into page-aware sections', async () => {
    const getText = jest
      .spyOn(PDFParse.prototype, 'getText')
      .mockResolvedValue({
        text: 'PDF-RMA-4827\nPDF-CHECK-714',
        total: 2,
        pages: [
          { num: 1, text: 'PDF-RMA-4827 return policy' },
          { num: 2, text: 'PDF-CHECK-714 inspection workflow' },
        ],
      } as never);
    const destroy = jest
      .spyOn(PDFParse.prototype, 'destroy')
      .mockResolvedValue(undefined);
    const result = await service.parse({
      body: Buffer.from('%PDF-1.7\nmock-pdf'),
      contentType: 'application/pdf',
      fileName: 'store-a-returns-guide.pdf',
    });

    expect(result.sections).toHaveLength(2);
    expect(result.metadata).toMatchObject({
      parser: 'pdf-parse',
      sourceType: 'pdf',
      pageCount: 2,
    });
    expect(result.sections[0].metadata).toMatchObject({ pageNumber: 1 });
    expect(result.sections[1].metadata).toMatchObject({ pageNumber: 2 });
    expect(result.content).toContain('PDF-RMA-4827');
    expect(result.content).toContain('PDF-CHECK-714');
    expect(getText).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('rejects a DOCX file disguised with an XLSX extension', async () => {
    const body = await readFile(
      join(process.cwd(), 'demo', 'fixtures', 'store-a-service-manual.docx'),
    );

    await expect(
      service.parse({
        body,
        contentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        fileName: 'disguised.xlsx',
      }),
    ).rejects.toThrow(/signature와 일치하지 않습니다/);
  });

  it('rejects empty and corrupt documents before parser execution', async () => {
    await expect(
      service.parse({
        body: Buffer.alloc(0),
        contentType: 'text/markdown',
        fileName: 'empty.md',
      }),
    ).rejects.toThrow(/빈 파일/);

    await expect(
      service.parse({
        body: Buffer.from('PK\u0003\u0004broken archive'),
        contentType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        fileName: 'corrupt.docx',
      }),
    ).rejects.toThrow(/signature와 일치하지 않습니다/);
  });

  it('rejects legacy XLS uploads because the vulnerable parser was removed', async () => {
    await expect(
      service.parse({
        body: Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
        contentType: 'application/vnd.ms-excel',
        fileName: 'legacy.xls',
      }),
    ).rejects.toThrow(/지원하지 않는 파일 형식/);
  });

  it('normalizes parser failures for malformed XLSX containers', async () => {
    const body = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.from('[Content_Types].xml xl/'),
    ]);

    await expect(
      service.parse({
        body,
        contentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        fileName: 'malformed.xlsx',
      }),
    ).rejects.toThrow(/유효한 XLSX 문서/);
  });

  it('enforces workbook sheet, row, column, cell, and text limits', () => {
    expect(() =>
      validateWorkbookLimits(
        Array.from({ length: WORKBOOK_LIMITS.sheets + 1 }, (_, index) => ({
          sheet: `Sheet${index + 1}`,
          data: [],
        })),
      ),
    ).toThrow(/시트는 최대/);
    expect(() =>
      validateWorkbookLimits([
        {
          sheet: 'Rows',
          data: Array.from(
            { length: WORKBOOK_LIMITS.rowsPerSheet + 1 },
            () => [],
          ),
        },
      ]),
    ).toThrow(/시트당 최대/);
    expect(() =>
      validateWorkbookLimits([
        {
          sheet: 'Columns',
          data: [Array(WORKBOOK_LIMITS.columnsPerRow + 1).fill('value')],
        },
      ]),
    ).toThrow(/행당 최대/);
    expect(() =>
      validateWorkbookLimits([
        {
          sheet: 'Cells',
          data: Array.from(
            {
              length:
                Math.floor(
                  WORKBOOK_LIMITS.totalCells / WORKBOOK_LIMITS.columnsPerRow,
                ) + 1,
            },
            () =>
              Array.from(
                { length: WORKBOOK_LIMITS.columnsPerRow },
                () => 'value',
              ),
          ),
        },
      ]),
    ).toThrow(/문서는 전체/);
    expect(() =>
      validateWorkbookLimits([
        {
          sheet: 'Text',
          data: [['x'.repeat(WORKBOOK_LIMITS.cellCharacters + 1)]],
        },
      ]),
    ).toThrow(/셀 문자열/);
  });
});
