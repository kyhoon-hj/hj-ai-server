import { Injectable } from '@nestjs/common';
import { ParsedDocumentSection } from './document-parser.service';

export type KnowledgeChunkInput = {
  content: string;
  metadata: Record<string, unknown>;
};

type ChunkingOptions = {
  chunkSize?: number;
  overlap?: number;
};

@Injectable()
export class ChunkingService {
  createChunks(
    sections: ParsedDocumentSection[],
    options: ChunkingOptions = {},
  ): KnowledgeChunkInput[] {
    return sections.flatMap((section, sectionIndex) => {
      const sourceType = String(section.metadata?.sourceType ?? 'text');

      if (this.isStructuredRowSource(sourceType)) {
        return this.createStructuredRowChunks(section, sectionIndex);
      }

      return this.createTextChunks(section, sectionIndex, options);
    });
  }

  private createStructuredRowChunks(
    section: ParsedDocumentSection,
    sectionIndex: number,
  ) {
    const content = section.content.trim();

    if (!content) {
      return [];
    }

    return [
      {
        content,
        metadata: {
          ...(section.metadata ?? {}),
          chunkStrategy: 'structured-row',
          sectionTitle: section.title,
          sectionIndex,
          sectionChunkIndex: 0,
        },
      },
    ];
  }

  private createTextChunks(
    section: ParsedDocumentSection,
    sectionIndex: number,
    options: ChunkingOptions,
  ) {
    const normalized = section.content
      .replace(/\r\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    if (!normalized) {
      return [];
    }

    const sourceType = String(section.metadata?.sourceType ?? 'text');
    const chunkSize = options.chunkSize ?? this.getDefaultChunkSize(sourceType);
    const overlap = options.overlap ?? this.getDefaultOverlap(sourceType);
    const chunks: KnowledgeChunkInput[] = [];
    let start = 0;

    while (start < normalized.length) {
      const maxEnd = Math.min(start + chunkSize, normalized.length);
      const end =
        maxEnd === normalized.length
          ? maxEnd
          : this.findNaturalBreak(normalized, start, maxEnd);
      const content = normalized.slice(start, end).trim();

      if (content) {
        chunks.push({
          content,
          metadata: {
            ...(section.metadata ?? {}),
            chunkStrategy: 'text-window',
            sectionTitle: section.title,
            sectionIndex,
            sectionChunkIndex: chunks.length,
            charStart: start,
            charEnd: end,
          },
        });
      }

      if (end === normalized.length) {
        break;
      }

      start = Math.max(end - overlap, start + 1);
    }

    return chunks;
  }

  private findNaturalBreak(text: string, start: number, maxEnd: number) {
    const minEnd = Math.min(start + Math.floor((maxEnd - start) * 0.6), maxEnd);
    const candidates = ['\n\n', '\n', '. ', '? ', '! ', '。', '다.'];

    for (const candidate of candidates) {
      const index = text.lastIndexOf(candidate, maxEnd);

      if (index >= minEnd) {
        return Math.min(index + candidate.length, text.length);
      }
    }

    return maxEnd;
  }

  private isStructuredRowSource(sourceType: string) {
    return sourceType === 'xlsx' || sourceType === 'xls' || sourceType === 'csv-row';
  }

  private getDefaultChunkSize(sourceType: string) {
    if (sourceType === 'pdf' || sourceType === 'docx') {
      return 2400;
    }

    return 3000;
  }

  private getDefaultOverlap(sourceType: string) {
    if (sourceType === 'pdf' || sourceType === 'docx') {
      return 240;
    }

    return 300;
  }
}
