import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { diskStorage } from 'multer';

export const DEFAULT_STORAGE_MAX_FILE_SIZE_MB = 100;

export function createStagedUploadOptions(
  maxFileSizeMb = DEFAULT_STORAGE_MAX_FILE_SIZE_MB,
) {
  return {
    storage: diskStorage({
      destination: tmpdir(),
      filename: (_request, _file, callback) =>
        callback(null, `hj-ai-${randomUUID()}.upload`),
    }),
    limits: {
      fileSize: maxFileSizeMb * 1024 * 1024,
      files: 1,
      fields: 0,
      parts: 2,
    },
  };
}

export async function sha256StagedFile(file: Express.Multer.File) {
  const hash = createHash('sha256');

  for await (const chunk of createReadStream(requireStagedPath(file))) {
    const buffer = Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(chunk as Uint8Array);
    hash.update(buffer);
  }

  return hash.digest('hex');
}

export async function removeStagedFile(file: Express.Multer.File) {
  if (!file.path) return;

  try {
    await unlink(file.path);
  } catch (error) {
    if (!isNodeError(error) || error.code !== 'ENOENT') throw error;
  }
}

export function requireStagedPath(file: Express.Multer.File) {
  if (!file.path) throw new Error('staged upload path is missing');
  return file.path;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === 'object' && 'code' in error);
}
