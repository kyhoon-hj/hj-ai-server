import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KnowledgeService } from './knowledge.service';

describe('knowledge upload compensation', () => {
  const tempDirectories: string[] = [];

  afterEach(async () => {
    jest.restoreAllMocks();
    await Promise.all(
      tempDirectories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  const createFixture = async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hj-ai-compensation-test-'));
    tempDirectories.push(directory);
    const path = join(directory, 'fixture.upload');
    await writeFile(path, 'valid knowledge');
    return {
      path,
      file: {
        path,
        originalname: 'fixture.md',
        mimetype: 'text/markdown',
        size: 15,
      } as Express.Multer.File,
    };
  };

  const createSubject = (options: {
    uploadResult?: Record<string, unknown>;
    uploadError?: Error;
    databaseResult?: Record<string, unknown>;
    databaseError?: Error;
    deleteError?: Error;
  }) => {
    const uploaded = options.uploadResult ?? {
      bucket: 'test-bucket',
      key: 'store-a/knowledge/uploaded.md',
      url: 'https://example.test/uploaded.md',
      originalName: 'fixture.md',
      mimetype: 'text/markdown',
      size: 15,
    };
    const storageService = {
      uploadFile: options.uploadError
        ? jest.fn().mockRejectedValue(options.uploadError)
        : jest.fn().mockResolvedValue(uploaded),
      deleteFile: options.deleteError
        ? jest.fn().mockRejectedValue(options.deleteError)
        : jest.fn().mockResolvedValue({ deleted: true }),
    };
    const prisma = {
      knowledgeFile: {
        create: options.databaseError
          ? jest.fn().mockRejectedValue(options.databaseError)
          : jest
              .fn()
              .mockResolvedValue(options.databaseResult ?? { id: 'file-1' }),
      },
    };
    const configService = {
      get: jest.fn((key: string) => {
        if (key === 'KNOWLEDGE_MAX_FILE_SIZE_MB') return '30';
        if (key === 'AWS_REGION') return 'ap-northeast-2';
        return undefined;
      }),
    };
    const service = new KnowledgeService(
      configService as unknown as ConfigService,
      prisma as never,
      storageService as never,
      {} as never,
      {} as never,
      {} as never,
    );

    return { service, prisma, storageService };
  };

  it('deletes the uploaded S3 object when DB record creation fails', async () => {
    const databaseError = new Error('DB failed');
    const { file, path } = await createFixture();
    const { service, storageService } = createSubject({ databaseError });

    await expect(
      service.uploadKnowledgeFile(file, {
        appcode: 'store-a',
        maxStorageMb: null,
      }),
    ).rejects.toBe(databaseError);
    expect(storageService.deleteFile).toHaveBeenCalledWith(
      'store-a/knowledge/uploaded.md',
      'store-a',
    );
    await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not compensate when S3 upload itself fails', async () => {
    const { file } = await createFixture();
    const uploadError = new Error('S3 upload failed');
    const { service, prisma, storageService } = createSubject({ uploadError });

    await expect(
      service.uploadKnowledgeFile(file, {
        appcode: 'store-a',
        maxStorageMb: null,
      }),
    ).rejects.toBe(uploadError);
    expect(prisma.knowledgeFile.create).not.toHaveBeenCalled();
    expect(storageService.deleteFile).not.toHaveBeenCalled();
  });

  it('does not delete S3 when DB record creation succeeds', async () => {
    const { file } = await createFixture();
    const { service, storageService } = createSubject({});

    await expect(
      service.uploadKnowledgeFile(file, {
        appcode: 'store-a',
        maxStorageMb: null,
      }),
    ).resolves.toMatchObject({ id: 'file-1' });
    expect(storageService.deleteFile).not.toHaveBeenCalled();
  });

  it('returns a distinct error when DB write and compensation both fail', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { file } = await createFixture();
    const { service } = createSubject({
      databaseError: new Error('DB failed'),
      deleteError: new Error('S3 delete failed'),
    });

    const promise = service.uploadKnowledgeFile(file, {
      appcode: 'store-a',
      maxStorageMb: null,
    });
    await expect(promise).rejects.toBeInstanceOf(InternalServerErrorException);
    await expect(promise).rejects.toMatchObject({
      response: {
        code: 'KNOWLEDGE_UPLOAD_COMPENSATION_FAILED',
      },
    });
  });
});
