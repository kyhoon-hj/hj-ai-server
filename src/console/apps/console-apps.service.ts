import { randomUUID } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SecurityAuditService } from '../../security/security-audit.service';
import type { ConsoleIdentityContext } from '../security/console-identity-context';
import { CreateConsoleAppDto } from './dto/create-console-app.dto';
import { UpdateConsoleAppDto } from './dto/update-console-app.dto';

const CONSOLE_APP_SELECT = {
  id: true,
  appname: true,
  appcode: true,
  status: true,
  remark: true,
  appkeyExpiresAt: true,
  appkeyRotatedAt: true,
  createat: true,
  updateat: true,
} satisfies Prisma.AppInfoSelect;

@Injectable()
export class ConsoleAppsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly securityAudit: SecurityAuditService,
  ) {}

  async list(identity: ConsoleIdentityContext) {
    const ownerships = await this.prisma.consoleAppOwnership.findMany({
      where: { organizationId: identity.organizationId },
      select: { appInfo: { select: CONSOLE_APP_SELECT } },
      orderBy: { createdAt: 'desc' },
    });
    return ownerships.map((ownership) => ownership.appInfo);
  }

  async findOne(id: string, identity: ConsoleIdentityContext) {
    const ownership = await this.findOwnership(id, identity.organizationId);
    return ownership.appInfo;
  }

  async create(
    dto: CreateConsoleAppDto,
    identity: ConsoleIdentityContext,
    requestId?: string,
  ) {
    const id = randomUUID();
    const appcode = 'CONSOLE_' + id.replaceAll('-', '').toUpperCase();
    const app = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.appInfo.create({
        data: {
          id,
          appname: dto.appname,
          appcode,
          remark: dto.remark,
          status: 'active',
          allowedAccessLevels: ['PUBLIC'],
          s3Prefix: appcode.toLowerCase() + '/knowledge',
        },
        select: CONSOLE_APP_SELECT,
      });
      await transaction.consoleAppOwnership.create({
        data: {
          organizationId: identity.organizationId,
          appInfoId: created.id,
          createdByIdentityId: identity.identityId,
        },
      });
      return created;
    });

    await this.securityAudit.recordConsole({
      eventType: 'CONSOLE_APP_CREATED',
      identity,
      appId: app.id,
      appcode: app.appcode,
      requestId,
    });
    return app;
  }

  async update(
    id: string,
    dto: UpdateConsoleAppDto,
    identity: ConsoleIdentityContext,
    requestId?: string,
  ) {
    await this.findOwnership(id, identity.organizationId);
    const app = await this.prisma.appInfo.update({
      where: { id },
      data: {
        appname: dto.appname,
        remark: dto.remark,
        status: dto.status,
      },
      select: CONSOLE_APP_SELECT,
    });

    await this.securityAudit.recordConsole({
      eventType: 'CONSOLE_APP_UPDATED',
      identity,
      appId: app.id,
      appcode: app.appcode,
      requestId,
      metadata: { changedFields: Object.keys(dto).sort().join(',') },
    });
    return app;
  }

  private async findOwnership(appInfoId: string, organizationId: string) {
    const ownership = await this.prisma.consoleAppOwnership.findFirst({
      where: { appInfoId, organizationId },
      select: { appInfo: { select: CONSOLE_APP_SELECT } },
    });
    if (!ownership) {
      throw new NotFoundException('요청한 앱을 찾을 수 없습니다.');
    }
    return ownership;
  }
}
