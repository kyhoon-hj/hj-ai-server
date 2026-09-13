import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAppInfoDto } from './dto/create-app-info.dto';
import { UpdateAppInfoDto } from './dto/update-app-info.dto';
import { RotateAppKeyDto } from './dto/rotate-appkey.dto';
import { SecurityAuditService } from '../security/security-audit.service';
import type { AdminRequest } from '../common/guards/admin-api-key.guard';

@Injectable()
export class AppInfoService {
  private readonly publicSelect = {
    id: true,
    appname: true,
    appcode: true,
    allowedAccessLevels: true,
    status: true,
    appkeyExpiresAt: true,
    appkeyRotatedAt: true,
    previousAppkeyValidUntil: true,
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
    private readonly securityAudit: SecurityAuditService,
  ) {}

  async create(dto: CreateAppInfoDto, request?: AdminRequest) {
    await this.ensureUniqueAppCode(dto.appcode);

    const id = randomUUID();
    const credential = this.createAppKeyMaterial(
      { id, appname: dto.appname, appcode: dto.appcode },
      dto.appkeyTtlDays,
    );

    const row = await this.prisma.appInfo
      .create({
        data: {
          id,
          appkey: null,
          appkeyId: credential.credentialId,
          appkeyHash: credential.appkeyHash,
          appkeyExpiresAt: credential.expiresAt,
          appkeyRotatedAt: credential.issuedAt,
          appname: dto.appname,
          appcode: dto.appcode,
          allowedAccessLevels: dto.allowedAccessLevels,
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
      })
      .catch((error: unknown) =>
        this.rethrowAppCodeConflict(error, dto.appcode),
      );

    await this.securityAudit.record({
      eventType: 'APPKEY_ISSUED',
      actorType: 'platform-admin',
      appId: row.id,
      appcode: row.appcode,
      credentialSlot: request?.admin?.credentialSlot,
      requestId: request?.correlationId,
      metadata: { expiresAt: credential.expiresAt.toISOString() },
    });

    return {
      ...row,
      appkey: credential.appkey,
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

    try {
      return await this.prisma.appInfo.update({
        where: { id },
        data: {
          appname: dto.appname,
          appcode: dto.appcode,
          allowedAccessLevels: dto.allowedAccessLevels,
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
    } catch (error) {
      this.rethrowAppCodeConflict(error, dto.appcode ?? 'unknown');
    }
  }

  async remove(id: string) {
    await this.findOne(id);

    return this.prisma.appInfo.delete({
      where: { id },
      select: this.publicSelect,
    });
  }

  async rotateAppKey(
    id: string,
    dto: RotateAppKeyDto = {},
    request?: AdminRequest,
  ) {
    const appInfo = await this.prisma.appInfo.findUnique({
      where: { id },
      select: {
        ...this.publicSelect,
        appkey: true,
        appkeyId: true,
        appkeyHash: true,
        appkeyIssuedByIdentityId: true,
        appkeyLastUsedAt: true,
      },
    });
    if (!appInfo) throw new NotFoundException(`AppInfo ${id} not found`);

    const gracePeriodSeconds = this.resolveGracePeriod(
      dto.gracePeriodSeconds ?? 0,
    );
    const currentHash =
      appInfo.appkeyHash ??
      (appInfo.appkey ? this.hashAppKey(appInfo.appkey) : null);
    const credential = this.createAppKeyMaterial(appInfo, dto.ttlDays);
    const previousValidUntil = this.previousCredentialValidUntil(
      credential.issuedAt,
      gracePeriodSeconds,
      currentHash,
      appInfo.appkeyExpiresAt,
    );

    const row = await this.prisma.appInfo.update({
      where: { id },
      data: {
        appkey: null,
        appkeyId: credential.credentialId,
        appkeyHash: credential.appkeyHash,
        appkeyIssuedByIdentityId: null,
        appkeyLastUsedAt: null,
        previousAppkeyId: previousValidUntil ? appInfo.appkeyId : null,
        previousAppkeyHash: previousValidUntil ? currentHash : null,
        previousAppkeyIssuedByIdentityId: previousValidUntil
          ? appInfo.appkeyIssuedByIdentityId
          : null,
        previousAppkeyIssuedAt: previousValidUntil
          ? appInfo.appkeyRotatedAt
          : null,
        previousAppkeyLastUsedAt: previousValidUntil
          ? appInfo.appkeyLastUsedAt
          : null,
        previousAppkeyValidUntil: previousValidUntil,
        appkeyExpiresAt: credential.expiresAt,
        appkeyRotatedAt: credential.issuedAt,
      },
      select: this.publicSelect,
    });

    await this.securityAudit.record({
      eventType: 'APPKEY_ROTATED',
      actorType: 'platform-admin',
      appId: row.id,
      appcode: row.appcode,
      credentialSlot: request?.admin?.credentialSlot,
      requestId: request?.correlationId,
      metadata: {
        gracePeriodSeconds,
        expiresAt: credential.expiresAt.toISOString(),
        previousValidUntil: previousValidUntil?.toISOString() ?? null,
      },
    });

    return {
      ...row,
      appkey: credential.appkey,
    };
  }

  async validateAppKey(appkey: string) {
    if (!this.isValidAppKeySignature(appkey)) {
      return null;
    }

    const hashed = this.hashAppKey(appkey);
    const row = await this.prisma.appInfo.findFirst({
      where: {
        OR: [
          { appkeyHash: hashed },
          { previousAppkeyHash: hashed },
          { appkey },
        ],
      },
      select: {
        id: true,
        appcode: true,
        allowedAccessLevels: true,
        status: true,
        s3Prefix: true,
        defaultModelId: true,
        defaultEmbeddingModelId: true,
        systemPrompt: true,
        maxStorageMb: true,
        monthlyTokenLimit: true,
        metadata: true,
        appkey: true,
        appkeyId: true,
        appkeyHash: true,
        appkeyLastUsedAt: true,
        previousAppkeyHash: true,
        previousAppkeyId: true,
        previousAppkeyLastUsedAt: true,
        appkeyExpiresAt: true,
        previousAppkeyValidUntil: true,
      },
    });

    if (!row) return null;

    const now = new Date();
    const currentMatches = row.appkeyHash === hashed || row.appkey === appkey;
    const previousMatches = row.previousAppkeyHash === hashed;
    if (
      (currentMatches && row.appkeyExpiresAt && row.appkeyExpiresAt <= now) ||
      (previousMatches &&
        (!row.previousAppkeyValidUntil || row.previousAppkeyValidUntil <= now))
    ) {
      return null;
    }

    await this.prisma.appInfo.update({
      where: { id: row.id },
      data: currentMatches
        ? { appkeyLastUsedAt: now }
        : { previousAppkeyLastUsedAt: now },
    });

    return {
      id: row.id,
      appcode: row.appcode,
      allowedAccessLevels: row.allowedAccessLevels,
      status: row.status,
      s3Prefix: row.s3Prefix,
      defaultModelId: row.defaultModelId,
      defaultEmbeddingModelId: row.defaultEmbeddingModelId,
      systemPrompt: row.systemPrompt,
      maxStorageMb: row.maxStorageMb,
      monthlyTokenLimit: row.monthlyTokenLimit,
      metadata: row.metadata,
    };
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

  private rethrowAppCodeConflict(error: unknown, appcode: string): never {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'P2002'
    ) {
      throw new ConflictException(`appcode ${appcode} already exists`);
    }

    throw error;
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

  createAppKeyMaterial(
    app: { id: string; appname: string; appcode: string },
    requestedTtlDays?: number,
  ) {
    const issuedAt = new Date();
    const expiresAt = this.createExpiry(issuedAt, requestedTtlDays);
    const credentialId = randomUUID();
    const appkey = this.createAppKey({
      sub: app.id,
      appname: app.appname,
      appcode: app.appcode,
      iat: Math.floor(issuedAt.getTime() / 1000),
      exp: Math.floor(expiresAt.getTime() / 1000),
      jti: credentialId,
    });
    return {
      credentialId,
      appkey,
      appkeyHash: this.hashAppKey(appkey),
      issuedAt,
      expiresAt,
    };
  }

  resolveRotationGracePeriod(requestedSeconds: number) {
    return this.resolveGracePeriod(requestedSeconds);
  }

  hashAppKeyValue(appkey: string) {
    return this.hashAppKey(appkey);
  }

  previousCredentialValidUntil(
    issuedAt: Date,
    gracePeriodSeconds: number,
    currentHash: string | null,
    currentExpiresAt: Date | null,
  ) {
    if (
      gracePeriodSeconds <= 0 ||
      !currentHash ||
      (currentExpiresAt && currentExpiresAt <= issuedAt)
    ) {
      return null;
    }
    const requested = new Date(issuedAt.getTime() + gracePeriodSeconds * 1000);
    return currentExpiresAt && currentExpiresAt < requested
      ? currentExpiresAt
      : requested;
  }

  private createExpiry(issuedAt: Date, requestedTtlDays?: number) {
    const configuredTtl = Number(
      this.configService.get<string>('APPKEY_TTL_DAYS') ?? 90,
    );
    const ttlDays = requestedTtlDays ?? configuredTtl;
    return new Date(issuedAt.getTime() + ttlDays * 24 * 60 * 60 * 1000);
  }

  private resolveGracePeriod(requestedSeconds: number) {
    const maxSeconds = Number(
      this.configService.get<string>('APPKEY_MAX_ROTATION_GRACE_SECONDS') ??
        86400,
    );
    if (requestedSeconds > maxSeconds) {
      throw new BadRequestException(
        `gracePeriodSeconds must not exceed ${maxSeconds}`,
      );
    }
    return requestedSeconds;
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

    if (!this.safeEqual(signature, expectedSignature)) {
      return false;
    }

    try {
      const header = JSON.parse(
        Buffer.from(encodedHeader, 'base64url').toString('utf8'),
      ) as Record<string, unknown>;
      const payload = JSON.parse(
        Buffer.from(encodedPayload, 'base64url').toString('utf8'),
      ) as Record<string, unknown>;

      if (header.alg !== 'HS256' || header.typ !== 'JWT') {
        return false;
      }

      // Tokens issued before the lifecycle migration have no exp claim and
      // remain bounded by the backfilled DB expiry until they are rotated.
      if (!('exp' in payload)) {
        return true;
      }

      return (
        typeof payload.exp === 'number' &&
        Number.isInteger(payload.exp) &&
        payload.exp > Math.floor(Date.now() / 1000)
      );
    } catch {
      return false;
    }
  }

  private getAppKeySecret() {
    const secret = this.configService.get<string>('APPKEY_JWT_SECRET');

    if (!secret) {
      throw new Error('APPKEY_JWT_SECRET is required');
    }

    return secret;
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
