import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAppInfoDto } from './dto/create-app-info.dto';
import { UpdateAppInfoDto } from './dto/update-app-info.dto';

@Injectable()
export class AppInfoService {
  private readonly publicSelect = {
    id: true,
    appname: true,
    appcode: true,
    remark: true,
    createat: true,
    updateat: true,
  } as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  create(dto: CreateAppInfoDto) {
    const id = randomUUID();
    const appkey = this.createAppKey({
      sub: id,
      appname: dto.appname,
      appcode: dto.appcode,
      iat: Math.floor(Date.now() / 1000),
    });

    return this.prisma.appInfo.create({
      data: {
        id,
        appkey,
        appname: dto.appname,
        appcode: dto.appcode,
        remark: dto.remark,
      },
    });
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

    return this.prisma.appInfo.update({
      where: { id },
      data: dto,
    });
  }

  async remove(id: string) {
    await this.findOne(id);

    return this.prisma.appInfo.delete({
      where: { id },
    });
  }

  async validateAppKey(appkey: string) {
    if (!this.isValidAppKeySignature(appkey)) {
      return null;
    }

    return this.prisma.appInfo.findFirst({
      where: { appkey },
      select: {
        id: true,
        appcode: true,
      },
    });
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
