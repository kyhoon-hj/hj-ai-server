import { extname } from 'node:path';
import { BadRequestException, Injectable } from '@nestjs/common';
import * as mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import * as XLSX from 'xlsx';

export type ParsedDocumentSection = {
  title?: string;
  content: string;
  metadata?: Record<string, unknown>;
};

export type ParsedDocument = {
  title: string;
  content: string;
  sections: ParsedDocumentSection[];
  metadata: Record<string, unknown>;
};

@Injectable()
export class DocumentParserService {
  async parse(input: {
    body: Buffer;
    contentType: string;
    fileName: string;
  }): Promise<ParsedDocument> {
    const extension = extname(input.fileName).toLowerCase();
    const normalizedContentType = input.contentType.toLowerCase();

    if (this.isTextLike(extension, normalizedContentType)) {
      return this.parseText(input.body, input.fileName, extension);
    }

    if (extension === '.xlsx' || extension === '.xls') {
      return this.parseWorkbook(input.body, input.fileName, extension);
    }

    if (extension === '.docx') {
      return this.parseDocx(input.body, input.fileName, extension);
    }

    if (extension === '.pdf') {
      return this.parsePdf(input.body, input.fileName, extension);
    }

    throw new BadRequestException(
      '지원하지 않는 파일 형식입니다. txt, md, json, csv, xlsx, xls, pdf, docx 파일을 업로드하세요.',
    );
  }

  private parseText(body: Buffer, fileName: string, extension: string) {
    const content = body.toString('utf8').trim();

    if (!content) {
      throw new BadRequestException('인덱싱할 텍스트를 찾을 수 없습니다.');
    }

    return {
      title: fileName,
      content,
      sections: [
        {
          title: fileName,
          content,
          metadata: {
            sourceType: this.extensionToSourceType(extension),
          },
        },
      ],
      metadata: {
        parser: 'text',
        sourceType: this.extensionToSourceType(extension),
      },
    };
  }

  private parseWorkbook(body: Buffer, fileName: string, extension: string) {
    const workbook = XLSX.read(body, {
      type: 'buffer',
      cellDates: true,
    });
    const sections = workbook.SheetNames.flatMap((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
        header: 1,
        defval: '',
        raw: false,
      });
      const headerIndex = this.findWorkbookHeaderIndex(matrix);
      if (headerIndex < 0) {
        return [];
      }
      const headers = this.createWorkbookHeaders(matrix[headerIndex]);
      const rows = matrix.slice(headerIndex + 1);

      return rows
        .map((row, index) => {
          const rowNumber = headerIndex + index + 2;
          const content = this.rowToText(
            Object.fromEntries(
              headers.map((header, columnIndex) => [
                header,
                row[columnIndex] ?? '',
              ]),
            ),
          );

          if (!content) {
            return null;
          }

          return {
            title: `${sheetName} row ${rowNumber}`,
            content: `파일명: ${fileName}\n시트: ${sheetName}\n행: ${rowNumber}\n${content}`,
            metadata: {
              sourceType: this.extensionToSourceType(extension),
              sheetName,
              headerRowNumber: headerIndex + 1,
              rowNumber,
            },
          };
        })
        .filter((row) => row !== null);
    });

    if (sections.length === 0) {
      throw new BadRequestException(
        '엑셀 파일에서 인덱싱할 행을 찾을 수 없습니다.',
      );
    }

    return this.fromSections(fileName, sections, {
      parser: 'xlsx',
      sourceType: this.extensionToSourceType(extension),
      sheetNames: workbook.SheetNames,
    });
  }

  private async parseDocx(body: Buffer, fileName: string, extension: string) {
    const result = await mammoth.extractRawText({ buffer: body });
    const content = result.value.trim();

    if (!content) {
      throw new BadRequestException(
        'DOCX 파일에서 인덱싱할 텍스트를 찾을 수 없습니다.',
      );
    }

    return {
      title: fileName,
      content,
      sections: [
        {
          title: fileName,
          content,
          metadata: {
            sourceType: this.extensionToSourceType(extension),
          },
        },
      ],
      metadata: {
        parser: 'mammoth',
        sourceType: this.extensionToSourceType(extension),
        warnings: result.messages,
      },
    };
  }

  private async parsePdf(body: Buffer, fileName: string, extension: string) {
    const parser = new PDFParse({ data: body });
    try {
      const result = await parser.getText();
      const pageCount = result.pages.length;
      const sections = result.pages
        .map((page) => {
          const text = page.text.trim();
          if (!text) return null;

          return {
            title: `${fileName} page ${page.num}`,
            content: `파일명: ${fileName}\n페이지: ${page.num}/${pageCount}\n${text}`,
            metadata: {
              sourceType: this.extensionToSourceType(extension),
              pageNumber: page.num,
              pageCount,
            },
          };
        })
        .filter((page) => page !== null);

      if (sections.length === 0) {
        throw new BadRequestException(
          'PDF 파일에서 인덱싱할 텍스트를 찾을 수 없습니다.',
        );
      }

      return this.fromSections(fileName, sections, {
        parser: 'pdf-parse',
        sourceType: this.extensionToSourceType(extension),
        pageCount,
      });
    } finally {
      await parser.destroy();
    }
  }

  private fromSections(
    title: string,
    sections: ParsedDocumentSection[],
    metadata: Record<string, unknown>,
  ) {
    return {
      title,
      content: sections.map((section) => section.content).join('\n\n'),
      sections,
      metadata,
    };
  }

  private rowToText(row: Record<string, unknown>) {
    return Object.entries(row)
      .map(([key, value]) => {
        const normalized = this.workbookCellToString(value).trim();

        if (!normalized) {
          return null;
        }

        return `${key}: ${normalized}`;
      })
      .filter((value): value is string => Boolean(value))
      .join('\n');
  }

  private findWorkbookHeaderIndex(rows: unknown[][]) {
    const firstTabularRow = rows.findIndex(
      (row) => this.nonEmptyCellCount(row) >= 2,
    );
    if (firstTabularRow >= 0) return firstTabularRow;
    return rows.findIndex((row) => this.nonEmptyCellCount(row) > 0);
  }

  private nonEmptyCellCount(row: unknown[]) {
    return row.filter((value) => this.workbookCellToString(value).trim())
      .length;
  }

  private createWorkbookHeaders(row: unknown[]) {
    const occurrences = new Map<string, number>();
    return row.map((value, index) => {
      const base =
        this.workbookCellToString(value).trim() || `column_${index + 1}`;
      const occurrence = (occurrences.get(base) ?? 0) + 1;
      occurrences.set(base, occurrence);
      return occurrence === 1 ? base : `${base}_${occurrence}`;
    });
  }

  private workbookCellToString(value: unknown) {
    if (value === null || value === undefined) return '';
    if (value instanceof Date) return value.toISOString();
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      typeof value === 'bigint'
    ) {
      return String(value);
    }
    return JSON.stringify(value) ?? '';
  }

  private isTextLike(extension: string, contentType: string) {
    return (
      contentType.startsWith('text/') ||
      contentType.includes('json') ||
      contentType.includes('csv') ||
      ['.md', '.txt', '.json', '.csv'].includes(extension)
    );
  }

  private extensionToSourceType(extension: string) {
    return extension.replace(/^\./, '') || 'text';
  }
}
