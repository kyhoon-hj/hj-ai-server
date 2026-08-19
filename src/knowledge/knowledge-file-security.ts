import { extname } from 'node:path';
import { TextDecoder } from 'node:util';
import { BadRequestException } from '@nestjs/common';
import { memoryStorage } from 'multer';

export const DEFAULT_KNOWLEDGE_MAX_FILE_SIZE_MB = 30;
export const MAX_KNOWLEDGE_MAX_FILE_SIZE_MB = 100;

export const DEFAULT_KNOWLEDGE_ALLOWED_EXTENSIONS = [
  '.txt',
  '.md',
  '.json',
  '.csv',
  '.xlsx',
  '.xls',
  '.pdf',
  '.docx',
] as const;

const MIME_TYPES_BY_EXTENSION: Record<string, readonly string[]> = {
  '.txt': ['text/plain', 'application/octet-stream'],
  '.md': ['text/markdown', 'text/plain', 'application/octet-stream'],
  '.json': [
    'application/json',
    'text/json',
    'text/plain',
    'application/octet-stream',
  ],
  '.csv': [
    'text/csv',
    'application/csv',
    'application/vnd.ms-excel',
    'text/plain',
    'application/octet-stream',
  ],
  '.xlsx': [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/zip',
    'application/octet-stream',
  ],
  '.xls': ['application/vnd.ms-excel', 'application/octet-stream'],
  '.pdf': ['application/pdf', 'application/octet-stream'],
  '.docx': [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/zip',
    'application/octet-stream',
  ],
};

const ZIP_LOCAL_FILE_HEADER = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const OLE_COMPOUND_FILE_HEADER = Buffer.from([
  0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1,
]);

type KnowledgeFileInput = {
  body: Buffer;
  contentType: string;
  fileName: string;
};

type KnowledgeFilePolicy = {
  allowedExtensions?: readonly string[];
  maxBytes?: number;
};

export function getKnowledgeMaxFileSizeMb(value?: unknown) {
  const parsed = Number(value ?? DEFAULT_KNOWLEDGE_MAX_FILE_SIZE_MB);
  return Number.isInteger(parsed) &&
    parsed >= 1 &&
    parsed <= MAX_KNOWLEDGE_MAX_FILE_SIZE_MB
    ? parsed
    : DEFAULT_KNOWLEDGE_MAX_FILE_SIZE_MB;
}

export function createKnowledgeUploadOptions(maxFileSizeMbValue?: unknown) {
  const maxFileSizeMb = getKnowledgeMaxFileSizeMb(maxFileSizeMbValue);

  return {
    storage: memoryStorage(),
    limits: {
      fileSize: maxFileSizeMb * 1024 * 1024,
      files: 1,
      fields: 0,
      parts: 1,
    },
  };
}

export function validateKnowledgeFile(
  input: KnowledgeFileInput,
  policy: KnowledgeFilePolicy = {},
) {
  const extension = extname(input.fileName).toLowerCase();
  const allowedExtensions =
    policy.allowedExtensions ?? DEFAULT_KNOWLEDGE_ALLOWED_EXTENSIONS;
  const maxBytes =
    policy.maxBytes ?? DEFAULT_KNOWLEDGE_MAX_FILE_SIZE_MB * 1024 * 1024;

  validateFileName(input.fileName);

  if (!allowedExtensions.includes(extension)) {
    throw new BadRequestException(
      `지원하지 않는 파일 형식입니다. 허용 확장자: ${allowedExtensions.join(', ')}`,
    );
  }

  if (input.body.length === 0) {
    throw new BadRequestException('빈 파일은 업로드할 수 없습니다.');
  }

  if (input.body.length > maxBytes) {
    throw new BadRequestException(
      `파일 크기는 ${Math.floor(maxBytes / 1024 / 1024)}MB 이하여야 합니다.`,
    );
  }

  validateMimeType(extension, input.contentType);
  validateFileSignature(extension, input.body);

  return { extension, size: input.body.length };
}

function validateFileName(fileName: string) {
  const hasControlCharacter = Array.from(fileName).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });

  if (
    !fileName.trim() ||
    fileName.includes('\0') ||
    /[\\/]/.test(fileName) ||
    hasControlCharacter
  ) {
    throw new BadRequestException('유효한 파일명이 필요합니다.');
  }
}

function validateMimeType(extension: string, contentType: string) {
  const normalizedContentType = contentType
    .split(';', 1)[0]
    .trim()
    .toLowerCase();
  const allowedMimeTypes = MIME_TYPES_BY_EXTENSION[extension] ?? [];

  if (
    !normalizedContentType ||
    !allowedMimeTypes.includes(normalizedContentType)
  ) {
    throw new BadRequestException(
      `파일 확장자 ${extension}와 MIME 형식 ${normalizedContentType || '(없음)'}이 일치하지 않습니다.`,
    );
  }
}

function validateFileSignature(extension: string, body: Buffer) {
  if (['.txt', '.md', '.csv', '.json'].includes(extension)) {
    validateTextFile(extension, body);
    return;
  }

  if (extension === '.pdf') {
    if (!body.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
      throw invalidSignature(extension);
    }
    return;
  }

  if (extension === '.xls') {
    if (!body.subarray(0, 8).equals(OLE_COMPOUND_FILE_HEADER)) {
      throw invalidSignature(extension);
    }
    return;
  }

  if (extension === '.docx' || extension === '.xlsx') {
    const containerDirectory = extension === '.docx' ? 'word/' : 'xl/';
    const hasZipHeader = body.subarray(0, 4).equals(ZIP_LOCAL_FILE_HEADER);
    const hasContentTypes = body.includes(Buffer.from('[Content_Types].xml'));
    const hasExpectedDirectory = body.includes(Buffer.from(containerDirectory));

    if (!hasZipHeader || !hasContentTypes || !hasExpectedDirectory) {
      throw invalidSignature(extension);
    }
  }
}

function validateTextFile(extension: string, body: Buffer) {
  if (body.includes(0)) {
    throw invalidSignature(extension);
  }

  let content: string;
  try {
    content = new TextDecoder('utf-8', { fatal: true }).decode(body);
  } catch {
    throw new BadRequestException('텍스트 파일은 유효한 UTF-8이어야 합니다.');
  }

  const normalizedContent = content.replace(/^\uFEFF/, '').trim();
  if (!normalizedContent) {
    throw new BadRequestException('빈 파일은 업로드할 수 없습니다.');
  }

  if (extension === '.json') {
    try {
      JSON.parse(normalizedContent);
    } catch {
      throw new BadRequestException('유효한 JSON 문서가 아닙니다.');
    }
  }
}

function invalidSignature(extension: string) {
  return new BadRequestException(
    `파일 내용이 ${extension} 형식의 signature와 일치하지 않습니다.`,
  );
}
