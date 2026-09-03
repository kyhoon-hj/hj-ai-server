import { Readable } from 'node:stream';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { Upload } from '@aws-sdk/lib-storage';
import { StorageService } from './storage.service';

describe('StorageService streaming', () => {
  const tempDirectories: string[] = [];

  afterEach(async () => {
    jest.restoreAllMocks();
    await Promise.all(
      tempDirectories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  const createService = (send: jest.Mock) => {
    const configService = {
      get: jest.fn((key: string) => {
        if (key === 'AWS_S3_BUCKET') return 'test-bucket';
        if (key === 'AWS_S3_REGION') return 'ap-northeast-2';
        return undefined;
      }),
    } as unknown as ConfigService;
    const service = new StorageService(configService);
    Object.defineProperty(service, 's3Client', { value: { send } });
    return service;
  };

  it('returns the S3 response body as a readable stream', async () => {
    const body = Readable.from([Buffer.from('streamed-body')]);
    const service = createService(
      jest.fn().mockResolvedValue({
        Body: body,
        ContentLength: 13,
        ContentType: 'text/plain',
      }),
    );

    const result = await service.downloadFile(
      'store-a/knowledge/file.txt',
      'store-a',
    );

    expect(result.body).toBe(body);
    const chunks: Buffer[] = [];
    for await (const chunk of result.body) {
      chunks.push(Buffer.from(chunk as Uint8Array));
    }
    expect(Buffer.concat(chunks).toString()).toBe('streamed-body');
  });

  it('buffers parser input only within the explicit byte limit', async () => {
    const service = createService(
      jest.fn().mockResolvedValue({
        Body: Readable.from([Buffer.from('bounded')]),
        ContentLength: 7,
      }),
    );

    const result = await service.downloadFileBuffer(
      'store-a/knowledge/file.txt',
      'store-a',
      7,
    );

    expect(result.body.toString()).toBe('bounded');
  });

  it('destroys the S3 stream when parser input exceeds the limit', async () => {
    const body = Readable.from([Buffer.from('too-large')]);
    const destroy = jest.spyOn(body, 'destroy');
    const service = createService(
      jest.fn().mockResolvedValue({ Body: body, ContentLength: 9 }),
    );

    await expect(
      service.downloadFileBuffer('store-a/knowledge/file.txt', 'store-a', 4),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(destroy).toHaveBeenCalled();
  });

  it('destroys an in-progress parser stream when the caller aborts', async () => {
    const body = new Readable({ read() {} });
    const destroy = jest.spyOn(body, 'destroy');
    const service = createService(
      jest.fn().mockResolvedValue({ Body: body, ContentLength: 7 }),
    );
    const parent = new AbortController();
    const download = service.downloadFileBuffer(
      'store-a/knowledge/file.txt',
      'store-a',
      7,
      parent.signal,
    );
    const rejection = expect(download).rejects.toMatchObject({
      name: 'AbortError',
    });

    await new Promise((resolve) => setImmediate(resolve));
    parent.abort();

    await rejection;
    expect(destroy).toHaveBeenCalled();
  });

  it('removes the staged file when multipart upload fails', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hj-ai-storage-test-'));
    tempDirectories.push(directory);
    const path = join(directory, 'fixture.upload');
    await writeFile(path, 'fixture');
    jest
      .spyOn(Upload.prototype, 'done')
      .mockRejectedValue(new Error('S3 failed'));
    const service = createService(jest.fn());
    const file = {
      path,
      originalname: 'fixture.md',
      mimetype: 'text/markdown',
      size: 7,
    } as Express.Multer.File;

    await expect(service.uploadFile(file, 'store-a')).rejects.toThrow(
      'S3 failed',
    );
    await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
