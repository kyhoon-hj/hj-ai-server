import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAppInfoDto } from './dto/create-app-info.dto';
import { UpdateAppInfoDto } from './dto/update-app-info.dto';

@Injectable()
export class AppInfoService {
  private readonly publicSelect = {
    id: true,
    appname: true,
    appcode: true,
    status: true,
    s3Prefix: true,
    defaultModelId: true,
    defaultEmbeddingModelId: true,
    systemPrompt: true,
    maxStorageMb: true,
    monthlyTokenLimit: true,
    metadata: true,
    remark: true,
    createat: true,
    updateat: true,
  } as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async create(dto: CreateAppInfoDto) {
    await this.ensureUniqueAppCode(dto.appcode);

    const id = randomUUID();
    const appkey = this.createAppKey({
      sub: id,
      appname: dto.appname,
      appcode: dto.appcode,
      iat: Math.floor(Date.now() / 1000),
      jti: randomBytes(12).toString('base64url'),
    });
    const appkeyHash = this.hashAppKey(appkey);

    const row = await this.prisma.appInfo.create({
      data: {
        id,
        appkey: null,
        appkeyHash,
        appname: dto.appname,
        appcode: dto.appcode,
        status: dto.status ?? 'active',
        s3Prefix: dto.s3Prefix ?? this.createDefaultS3Prefix(dto.appcode),
        defaultModelId: dto.defaultModelId,
        defaultEmbeddingModelId: dto.defaultEmbeddingModelId,
        systemPrompt: dto.systemPrompt,
        maxStorageMb: dto.maxStorageMb,
        monthlyTokenLimit: dto.monthlyTokenLimit,
        metadata: dto.metadata as Prisma.InputJsonObject | undefined,
        remark: dto.remark,
      },
      select: this.publicSelect,
    });

    return {
      ...row,
      appkey,
    };
  }

  findAll() {
    return this.prisma.appInfo.findMany({
      select: this.publicSelect,
      orderBy: { createat: 'desc' },
    });
  }

  async findOne(id: string) {
    const row = await this.prisma.appInfo.findUnique({
      where: { id },
      select: this.publicSelect,
    });

    if (!row) {
      throw new NotFoundException(`AppInfo ${id} not found`);
    }

    return row;
  }

  async update(id: string, dto: UpdateAppInfoDto) {
    await this.findOne(id);

    if (dto.appcode) {
      await this.ensureUniqueAppCode(dto.appcode, id);
    }

    return this.prisma.appInfo.update({
      where: { id },
      data: {
        appname: dto.appname,
        appcode: dto.appcode,
        status: dto.status,
        s3Prefix: dto.s3Prefix,
        defaultModelId: dto.defaultModelId,
        defaultEmbeddingModelId: dto.defaultEmbeddingModelId,
        systemPrompt: dto.systemPrompt,
        maxStorageMb: dto.maxStorageMb,
        monthlyTokenLimit: dto.monthlyTokenLimit,
        metadata: dto.metadata as Prisma.InputJsonObject | undefined,
        remark: dto.remark,
      },
      select: this.publicSelect,
    });
  }

  async remove(id: string) {
    await this.findOne(id);

    return this.prisma.appInfo.delete({
      where: { id },
      select: this.publicSelect,
    });
  }

  async rotateAppKey(id: string) {
    const appInfo = await this.findOne(id);
    const appkey = this.createAppKey({
      sub: id,
      appname: appInfo.appname,
      appcode: appInfo.appcode,
      iat: Math.floor(Date.now() / 1000),
      jti: randomBytes(12).toString('base64url'),
    });

    const row = await this.prisma.appInfo.update({
      where: { id },
      data: {
        appkey: null,
        appkeyHash: this.hashAppKey(appkey),
      },
      select: this.publicSelect,
    });

    return {
      ...row,
      appkey,
    };
  }

  async validateAppKey(appkey: string) {
    if (!this.isValidAppKeySignature(appkey)) {
      return null;
    }

    return this.prisma.appInfo.findFirst({
      where: {
        OR: [{ appkeyHash: this.hashAppKey(appkey) }, { appkey }],
      },
      select: {
        id: true,
        appcode: true,
        status: true,
        s3Prefix: true,
        defaultModelId: true,
        defaultEmbeddingModelId: true,
        systemPrompt: true,
        maxStorageMb: true,
        monthlyTokenLimit: true,
        metadata: true,
      },
    });
  }

  private async ensureUniqueAppCode(appcode: string, exceptId?: string) {
    const existing = await this.prisma.appInfo.findFirst({
      where: {
        appcode,
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictException(`appcode ${appcode} already exists`);
    }
  }

  private createAppKey(payload: Record<string, string | number>) {
    const header = {
      alg: 'HS256',
      typ: 'JWT',
    };
    const encodedHeader = this.base64UrlEncode(JSON.stringify(header));
    const encodedPayload = this.base64UrlEncode(JSON.stringify(payload));
    const unsignedToken = `${encodedHeader}.${encodedPayload}`;
    const signature = createHmac('sha256', this.getAppKeySecret())
      .update(unsignedToken)
      .digest('base64url');

    return `${unsignedToken}.${signature}`;
  }

  private isValidAppKeySignature(appkey: string) {
    const parts = appkey.split('.');

    if (parts.length !== 3) {
      return false;
    }

    const [encodedHeader, encodedPayload, signature] = parts;
    const unsignedToken = `${encodedHeader}.${encodedPayload}`;
    const expectedSignature = createHmac('sha256', this.getAppKeySecret())
      .update(unsignedToken)
      .digest('base64url');

    return this.safeEqual(signature, expectedSignature);
  }

  private getAppKeySecret() {
    return (
      this.configService.get<string>('APPKEY_JWT_SECRET') ??
      this.configService.get<string>('JWT_SECRET') ??
      'hj-ai-server-appkey-secret'
    );
  }

  private hashAppKey(appkey: string) {
    return createHash('sha256').update(appkey).digest('hex');
  }

  private createDefaultS3Prefix(appcode: string) {
    return `${this.toSafePathPart(appcode)}/knowledge`;
  }

  private toSafePathPart(value: string) {
    return (
      value
        .trim()
        .replace(/[^a-zA-Z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 100) || 'app'
    );
  }

  private safeEqual(value: string, expected: string) {
    const valueBuffer = Buffer.from(value);
    const expectedBuffer = Buffer.from(expected);

    if (valueBuffer.length !== expectedBuffer.length) {
      return false;
    }

    return timingSafeEqual(valueBuffer, expectedBuffer);
  }

  private base64UrlEncode(value: string) {
    return Buffer.from(value).toString('base64url');
  }
}
