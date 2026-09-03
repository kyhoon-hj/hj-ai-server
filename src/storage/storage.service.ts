import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { extname, parse } from 'node:path';
import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  type GetObjectCommandOutput,
  HeadObjectCommand,
  type HeadObjectCommandOutput,
  ListObjectsV2Command,
  type ListObjectsV2CommandOutput,
  S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { removeStagedFile, requireStagedPath } from './staged-upload';
import {
  getAwsRequestHandlerOptions,
  getAwsRequestTimeoutMs,
  runAwsRequest,
} from '../common/aws/aws-request-control';

type ListFilesOptions = {
  prefix?: string;
  maxKeys?: number;
  continuationToken?: string;
};

@Injectable()
export class StorageService {
  private readonly s3Client: S3Client;
  private readonly requestTimeoutMs: number;

  constructor(private readonly configService: ConfigService) {
    this.requestTimeoutMs = getAwsRequestTimeoutMs(this.configService);
    this.s3Client = new S3Client({
      region: this.getRegion(),
      maxAttempts: 5,
      retryMode: 'adaptive',
      requestHandler: getAwsRequestHandlerOptions(this.configService),
    });
  }

  async uploadFile(
    file: Express.Multer.File,
    appcode: string,
    parentSignal?: AbortSignal,
  ) {
    const bucket = this.getBucket();

    const key = this.createObjectKey(appcode, file.originalname);
    const body = createReadStream(requireStagedPath(file));

    try {
      await runAwsRequest(
        async (abortSignal) => {
          const upload = new Upload({
            client: this.s3Client,
            params: {
              Bucket: bucket,
              Key: key,
              Body: body,
              ContentLength: file.size,
              ContentType: file.mimetype,
            },
            queueSize: 2,
            partSize: 5 * 1024 * 1024,
            leavePartsOnError: false,
          });
          const abortUpload = () => void upload.abort();
          abortSignal.addEventListener('abort', abortUpload, { once: true });
          try {
            await upload.done();
          } finally {
            abortSignal.removeEventListener('abort', abortUpload);
          }
        },
        { timeoutMs: this.requestTimeoutMs, parentSignal },
      );
    } finally {
      body.destroy();
      await finished(body).catch(() => undefined);
      await removeStagedFile(file);
    }

    return {
      appcode,
      bucket,
      key,
      url: this.createPublicUrl(bucket, key),
      originalName: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
    };
  }

  async deleteFile(key: string, appcode: string, parentSignal?: AbortSignal) {
    const bucket = this.getBucket();
    const normalizedKey = this.validateAppKeyPrefix(key, appcode);

    await this.send(
      new DeleteObjectCommand({ Bucket: bucket, Key: normalizedKey }),
      parentSignal,
    );

    return {
      appcode,
      bucket,
      key: normalizedKey,
      deleted: true,
    };
  }

  async listFiles(
    appcode: string,
    options: ListFilesOptions,
    parentSignal?: AbortSignal,
  ) {
    const bucket = this.getBucket();
    const prefix = this.createListPrefix(appcode, options.prefix);
    const response = await this.send<ListObjectsV2CommandOutput>(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        MaxKeys: this.normalizeMaxKeys(options.maxKeys),
        ContinuationToken: options.continuationToken,
      }),
      parentSignal,
    );

    return {
      appcode,
      bucket,
      prefix,
      files:
        response.Contents?.filter((object) => object.Key).map((object) => ({
          key: object.Key!,
          url: this.createPublicUrl(bucket, object.Key!),
          size: object.Size ?? 0,
          lastModified: object.LastModified,
          etag: object.ETag?.replace(/^"|"$/g, ''),
        })) ?? [],
      isTruncated: response.IsTruncated ?? false,
      nextContinuationToken: response.NextContinuationToken,
    };
  }

  async getFileInfo(key: string, appcode: string, parentSignal?: AbortSignal) {
    const bucket = this.getBucket();
    const normalizedKey = this.validateAppKeyPrefix(key, appcode);

    try {
      const response = await this.send<HeadObjectCommandOutput>(
        new HeadObjectCommand({
          Bucket: bucket,
          Key: normalizedKey,
        }),
        parentSignal,
      );

      return {
        appcode,
        bucket,
        key: normalizedKey,
        url: this.createPublicUrl(bucket, normalizedKey),
        contentType: response.ContentType,
        contentLength: response.ContentLength ?? 0,
        lastModified: response.LastModified,
        etag: response.ETag?.replace(/^"|"$/g, ''),
        metadata: response.Metadata ?? {},
      };
    } catch (error) {
      this.handleS3NotFound(error, normalizedKey);
    }
  }

  async downloadFile(key: string, appcode: string, parentSignal?: AbortSignal) {
    const bucket = this.getBucket();
    const normalizedKey = this.validateAppKeyPrefix(key, appcode);

    try {
      const response = await this.send<GetObjectCommandOutput>(
        new GetObjectCommand({
          Bucket: bucket,
          Key: normalizedKey,
        }),
        parentSignal,
      );

      if (!response.Body) {
        throw new NotFoundException(
          `S3 파일을 찾을 수 없습니다: ${normalizedKey}`,
        );
      }

      return {
        contentType: response.ContentType ?? 'application/octet-stream',
        contentLength: response.ContentLength,
        contentDisposition: this.createContentDisposition(normalizedKey),
        body: this.toReadable(response.Body),
      };
    } catch (error) {
      this.handleS3NotFound(error, normalizedKey);
    }
  }

  async downloadFileBuffer(
    key: string,
    appcode: string,
    maxBytes: number,
    parentSignal?: AbortSignal,
  ) {
    return runAwsRequest(
      async (abortSignal) => {
        const file = await this.downloadFile(key, appcode, abortSignal);
        const tooLargeMessage = `S3 파일 크기는 ${Math.floor(maxBytes / 1024 / 1024)}MB 이하여야 합니다.`;
        const abortStream = () => {
          const error = Object.assign(new Error('S3 download aborted.'), {
            name: 'AbortError',
          });
          file.body.destroy(error);
        };
        abortSignal.addEventListener('abort', abortStream, { once: true });

        try {
          if (
            file.contentLength !== undefined &&
            file.contentLength > maxBytes
          ) {
            file.body.destroy();
            throw new BadRequestException(tooLargeMessage);
          }

          const chunks: Buffer[] = [];
          let size = 0;
          for await (const chunk of file.body) {
            const buffer = Buffer.isBuffer(chunk)
              ? chunk
              : Buffer.from(chunk as Uint8Array);
            size += buffer.length;
            if (size > maxBytes) {
              throw new BadRequestException(tooLargeMessage);
            }
            chunks.push(buffer);
          }

          return { ...file, body: Buffer.concat(chunks, size) };
        } catch (error) {
          file.body.destroy();
          throw error;
        } finally {
          abortSignal.removeEventListener('abort', abortStream);
        }
      },
      { timeoutMs: this.requestTimeoutMs, parentSignal },
    );
  }

  private createObjectKey(appcode: string, originalName: string) {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const day = String(now.getUTCDate()).padStart(2, '0');
    const safeAppcode = this.toSafePathPart(appcode);
    const safeFileName = this.toSafeFileName(originalName);

    return `${safeAppcode}/knowledge/${year}/${month}/${day}/${randomUUID()}-${safeFileName}`;
  }

  private send<T>(
    command: Parameters<S3Client['send']>[0],
    parentSignal?: AbortSignal,
  ) {
    return runAwsRequest(
      (abortSignal) =>
        this.s3Client.send(command, { abortSignal }) as Promise<T>,
      { timeoutMs: this.requestTimeoutMs, parentSignal },
    );
  }

  private createListPrefix(appcode: string, prefix?: string) {
    const appPrefix = `${this.toSafePathPart(appcode)}/`;

    if (!prefix) {
      return appPrefix;
    }

    const normalizedPrefix = prefix
      .trim()
      .replace(/\\/g, '/')
      .replace(/^\/+|\/+$/g, '');

    if (!normalizedPrefix || normalizedPrefix.includes('..')) {
      throw new BadRequestException('유효한 prefix가 필요합니다.');
    }

    return `${appPrefix}${normalizedPrefix}/`;
  }

  private validateAppKeyPrefix(key: string, appcode: string) {
    const normalizedKey = key.trim().replace(/\\/g, '/').replace(/^\/+/, '');
    const appPrefix = `${this.toSafePathPart(appcode)}/`;

    if (!normalizedKey || normalizedKey.includes('..')) {
      throw new BadRequestException('유효한 key가 필요합니다.');
    }

    if (!normalizedKey.startsWith(appPrefix)) {
      throw new ForbiddenException('현재 appkey로 접근할 수 없는 파일입니다.');
    }

    return normalizedKey;
  }

  private createPublicUrl(bucket: string, key: string) {
    const cdnUrl = this.configService.get<string>('AWS_S3_CDN_URL');
    const encodedKey = key.split('/').map(encodeURIComponent).join('/');

    if (cdnUrl) {
      return `${cdnUrl.replace(/\/+$/, '')}/${encodedKey}`;
    }

    return `https://${bucket}.s3.${this.getRegion()}.amazonaws.com/${encodedKey}`;
  }

  private getRegion() {
    return (
      this.configService.get<string>('AWS_S3_REGION') ??
      this.configService.get<string>('AWS_REGION') ??
      'us-east-1'
    );
  }

  private getBucket() {
    const bucket = this.configService.get<string>('AWS_S3_BUCKET');

    if (!bucket) {
      throw new InternalServerErrorException(
        'AWS_S3_BUCKET 설정이 필요합니다.',
      );
    }

    return bucket;
  }

  private normalizeMaxKeys(maxKeys?: number) {
    if (!maxKeys || Number.isNaN(maxKeys)) {
      return 100;
    }

    return Math.min(Math.max(Math.trunc(maxKeys), 1), 1000);
  }

  private createContentDisposition(key: string) {
    const fileName = key.split('/').at(-1) ?? 'download';

    return `attachment; filename="${encodeURIComponent(
      fileName,
    )}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
  }

  private handleS3NotFound(error: unknown, key: string): never {
    if (
      error &&
      typeof error === 'object' &&
      'name' in error &&
      (error.name === 'NotFound' || error.name === 'NoSuchKey')
    ) {
      throw new NotFoundException(`S3 파일을 찾을 수 없습니다: ${key}`);
    }

    throw error;
  }

  private toReadable(body: unknown) {
    if (body instanceof Readable) return body;
    if (body && typeof body === 'object' && Symbol.asyncIterator in body) {
      return Readable.from(body as AsyncIterable<Uint8Array>);
    }
    throw new InternalServerErrorException(
      'S3 응답 stream을 읽을 수 없습니다.',
    );
  }

  private toSafeFileName(fileName: string) {
    const parsed = parse(fileName);
    const name = this.toSafePathPart(parsed.name) || 'file';
    const extension = extname(fileName).replace(/[^a-zA-Z0-9.]/g, '');

    return `${name}${extension}`;
  }

  private toSafePathPart(value: string) {
    return value
      .trim()
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 100);
  }
}
