import { randomUUID } from 'node:crypto';
import { extname, parse } from 'node:path';
import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type ListFilesOptions = {
  prefix?: string;
  maxKeys?: number;
  continuationToken?: string;
};

@Injectable()
export class StorageService {
  private readonly s3Client: S3Client;

  constructor(private readonly configService: ConfigService) {
    this.s3Client = new S3Client({
      region: this.getRegion(),
    });
  }

  async uploadFile(file: Express.Multer.File, appcode: string) {
    const bucket = this.getBucket();

    const key = this.createObjectKey(appcode, file.originalname);

    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: file.buffer,
        ContentLength: file.size,
        ContentType: file.mimetype,
      }),
    );

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

  async listFiles(appcode: string, options: ListFilesOptions) {
    const bucket = this.getBucket();
    const prefix = this.createListPrefix(appcode, options.prefix);
    const response = await this.s3Client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        MaxKeys: this.normalizeMaxKeys(options.maxKeys),
        ContinuationToken: options.continuationToken,
      }),
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

  async getFileInfo(key: string, appcode: string) {
    const bucket = this.getBucket();
    const normalizedKey = this.validateAppKeyPrefix(key, appcode);

    try {
      const response = await this.s3Client.send(
        new HeadObjectCommand({
          Bucket: bucket,
          Key: normalizedKey,
        }),
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

  async downloadFile(key: string, appcode: string) {
    const bucket = this.getBucket();
    const normalizedKey = this.validateAppKeyPrefix(key, appcode);

    try {
      const response = await this.s3Client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: normalizedKey,
        }),
      );

      if (!response.Body) {
        throw new NotFoundException(
          `S3 파일을 찾을 수 없습니다: ${normalizedKey}`,
        );
      }

      return {
        contentType: response.ContentType ?? 'application/octet-stream',
        contentLength: response.ContentLength ?? 0,
        contentDisposition: this.createContentDisposition(normalizedKey),
        body: Buffer.from(await response.Body.transformToByteArray()),
      };
    } catch (error) {
      this.handleS3NotFound(error, normalizedKey);
    }
  }

  private createObjectKey(appcode: string, originalName: string) {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const day = String(now.getUTCDate()).padStart(2, '0');
    const safeAppcode = this.toSafePathPart(appcode);
    const safeFileName = this.toSafeFileName(originalName);

    return `${safeAppcode}/${year}/${month}/${day}/${randomUUID()}-${safeFileName}`;
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
    return this.configService.get<string>('AWS_REGION') ?? 'us-east-1';
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
