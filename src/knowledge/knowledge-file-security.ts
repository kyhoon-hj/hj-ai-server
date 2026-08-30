import { createReadStream } from 'node:fs';
import { extname } from 'node:path';
import { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { TextDecoder } from 'node:util';
import { BadRequestException } from '@nestjs/common';
import parserStream from 'stream-json';
import { createStagedUploadOptions } from '../storage/staged-upload';

export const DEFAULT_KNOWLEDGE_MAX_FILE_SIZE_MB = 30;
export const MAX_KNOWLEDGE_MAX_FILE_SIZE_MB = 100;

export const DEFAULT_KNOWLEDGE_ALLOWED_EXTENSIONS = [
  '.txt',
  '.md',
  '.json',
  '.csv',
  '.xlsx',
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
  '.pdf': ['application/pdf', 'application/octet-stream'],
  '.docx': [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/zip',
    'application/octet-stream',
  ],
};

const ZIP_LOCAL_FILE_HEADER = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
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
  return createStagedUploadOptions(maxFileSizeMb);
}

export async function validateKnowledgeStagedFile(
  input: {
    path: string;
    size: number;
    contentType: string;
    fileName: string;
  },
  policy: KnowledgeFilePolicy = {},
) {
  const { extension } = validateKnowledgeFileMetadata(
    {
      contentType: input.contentType,
      fileName: input.fileName,
      size: input.size,
    },
    policy,
  );

  await validateStagedFileSignature(extension, input.path);
  return { extension, size: input.size };
}

export function validateKnowledgeFile(
  input: KnowledgeFileInput,
  policy: KnowledgeFilePolicy = {},
) {
  const { extension } = validateKnowledgeFileMetadata(
    {
      contentType: input.contentType,
      fileName: input.fileName,
      size: input.body.length,
    },
    policy,
  );

  validateFileSignature(extension, input.body);
  return { extension, size: input.body.length };
}

function validateKnowledgeFileMetadata(
  input: { contentType: string; fileName: string; size: number },
  policy: KnowledgeFilePolicy,
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

  if (input.size === 0) {
    throw new BadRequestException('빈 파일은 업로드할 수 없습니다.');
  }

  if (input.size > maxBytes) {
    throw new BadRequestException(
      `파일 크기는 ${Math.floor(maxBytes / 1024 / 1024)}MB 이하여야 합니다.`,
    );
  }

  validateMimeType(extension, input.contentType);
  return { extension };
}

async function validateStagedFileSignature(extension: string, path: string) {
  if (['.txt', '.md', '.csv', '.json'].includes(extension)) {
    await validateStagedTextFile(extension, path);
    return;
  }

  const markers =
    extension === '.docx'
      ? [Buffer.from('[Content_Types].xml'), Buffer.from('word/')]
      : extension === '.xlsx'
        ? [Buffer.from('[Content_Types].xml'), Buffer.from('xl/')]
        : [];
  const scan = await scanStagedFile(path, markers);

  if (
    extension === '.pdf' &&
    !scan.header.subarray(0, 5).equals(Buffer.from('%PDF-'))
  ) {
    throw invalidSignature(extension);
  }
  if (extension === '.docx' || extension === '.xlsx') {
    const hasZipHeader = scan.header
      .subarray(0, 4)
      .equals(ZIP_LOCAL_FILE_HEADER);
    if (!hasZipHeader || scan.markers.some((found) => !found)) {
      throw invalidSignature(extension);
    }
  }
}

async function validateStagedTextFile(extension: string, path: string) {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let hasContent = false;

  try {
    for await (const chunk of createReadStream(path)) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (buffer.includes(0)) throw invalidSignature(extension);
      if (/[^\s\uFEFF]/u.test(decoder.decode(buffer, { stream: true }))) {
        hasContent = true;
      }
    }
    if (/[^\s\uFEFF]/u.test(decoder.decode())) hasContent = true;
  } catch (error) {
    if (error instanceof BadRequestException) throw error;
    throw new BadRequestException('텍스트 파일은 유효한 UTF-8이어야 합니다.');
  }

  if (!hasContent) {
    throw new BadRequestException('빈 파일은 업로드할 수 없습니다.');
  }
  if (extension === '.json') await validateStagedJson(path);
}

async function validateStagedJson(path: string) {
  try {
    await pipeline(
      createReadStream(path),
      parserStream(),
      new Writable({
        objectMode: true,
        write(_chunk, _encoding, callback) {
          callback();
        },
      }),
    );
  } catch {
    throw new BadRequestException('유효한 JSON 문서가 아닙니다.');
  }
}

async function scanStagedFile(path: string, markers: Buffer[]) {
  const found = markers.map(() => false);
  const maxMarkerLength = Math.max(
    1,
    ...markers.map((marker) => marker.length),
  );
  let header = Buffer.alloc(0);
  let tail = Buffer.alloc(0);

  for await (const chunk of createReadStream(path)) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (header.length < 8) {
      header = Buffer.concat([header, buffer]).subarray(0, 8);
    }
    const searchable = Buffer.concat([tail, buffer]);
    markers.forEach((marker, index) => {
      if (!found[index] && searchable.includes(marker)) found[index] = true;
    });
    tail = searchable.subarray(
      Math.max(0, searchable.length - maxMarkerLength + 1),
    );
  }

  return { header, markers: found };
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
