import {
  createKnowledgeUploadOptions,
  validateKnowledgeFile,
  validateKnowledgeStagedFile,
} from './knowledge-file-security';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('knowledge file security', () => {
  const tempDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirectories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  it('applies file, field, and multipart limits before buffering an upload', () => {
    expect(createKnowledgeUploadOptions('7').limits).toEqual({
      fileSize: 7 * 1024 * 1024,
      files: 1,
      fields: 0,
      parts: 2,
    });
  });

  it('accepts valid UTF-8 JSON with a matching MIME type', () => {
    expect(
      validateKnowledgeFile({
        body: Buffer.from('{"store":"HJ"}'),
        contentType: 'application/json; charset=utf-8',
        fileName: 'store.json',
      }),
    ).toMatchObject({ extension: '.json' });
  });

  it('rejects an extension disguised by a conflicting MIME type', () => {
    expect(() =>
      validateKnowledgeFile({
        body: Buffer.from('%PDF-1.7'),
        contentType: 'application/pdf',
        fileName: 'policy.txt',
      }),
    ).toThrow(/확장자 .* MIME 형식 .* 일치하지 않습니다/);
  });

  it('rejects invalid signatures even with a matching extension and MIME type', () => {
    expect(() =>
      validateKnowledgeFile({
        body: Buffer.from('not a PDF'),
        contentType: 'application/pdf',
        fileName: 'policy.pdf',
      }),
    ).toThrow(/signature와 일치하지 않습니다/);
  });

  it('rejects empty and whitespace-only files', () => {
    expect(() =>
      validateKnowledgeFile({
        body: Buffer.alloc(0),
        contentType: 'text/plain',
        fileName: 'empty.txt',
      }),
    ).toThrow(/빈 파일/);

    expect(() =>
      validateKnowledgeFile({
        body: Buffer.from('  \n'),
        contentType: 'text/plain',
        fileName: 'blank.txt',
      }),
    ).toThrow(/빈 파일/);
  });

  it('rejects invalid UTF-8, malformed JSON, and unsafe file names', () => {
    expect(() =>
      validateKnowledgeFile({
        body: Buffer.from([0xc3, 0x28]),
        contentType: 'text/plain',
        fileName: 'broken.txt',
      }),
    ).toThrow(/유효한 UTF-8/);

    expect(() =>
      validateKnowledgeFile({
        body: Buffer.from('{broken'),
        contentType: 'application/json',
        fileName: 'broken.json',
      }),
    ).toThrow(/유효한 JSON/);

    expect(() =>
      validateKnowledgeFile({
        body: Buffer.from('safe'),
        contentType: 'text/plain',
        fileName: '../unsafe.txt',
      }),
    ).toThrow(/유효한 파일명/);
  });

  it('enforces the same byte limit when controller interception is bypassed', () => {
    expect(() =>
      validateKnowledgeFile(
        {
          body: Buffer.alloc(1024 * 1024 + 1, 0x61),
          contentType: 'text/plain',
          fileName: 'large.txt',
        },
        { maxBytes: 1024 * 1024 },
      ),
    ).toThrow(/1MB 이하여야/);
  });

  it('validates staged UTF-8 JSON without loading the upload into multer memory', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hj-ai-security-test-'));
    tempDirectories.push(directory);
    const path = join(directory, 'valid.json');
    await writeFile(path, '{"store":"HJ"}');

    await expect(
      validateKnowledgeStagedFile({
        path,
        size: 14,
        contentType: 'application/json',
        fileName: 'valid.json',
      }),
    ).resolves.toMatchObject({ extension: '.json' });
  });

  it('rejects invalid staged JSON and corrupted binary signatures', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hj-ai-security-test-'));
    tempDirectories.push(directory);
    const jsonPath = join(directory, 'broken.json');
    const pdfPath = join(directory, 'broken.pdf');
    await writeFile(jsonPath, '{broken');
    await writeFile(pdfPath, 'not a PDF');

    await expect(
      validateKnowledgeStagedFile({
        path: jsonPath,
        size: 7,
        contentType: 'application/json',
        fileName: 'broken.json',
      }),
    ).rejects.toThrow(/유효한 JSON/);
    await expect(
      validateKnowledgeStagedFile({
        path: pdfPath,
        size: 9,
        contentType: 'application/pdf',
        fileName: 'broken.pdf',
      }),
    ).rejects.toThrow(/signature/);
  });
});
