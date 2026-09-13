import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AppInfoService } from '../../app-info/app-info.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SecurityAuditService } from '../../security/security-audit.service';
import type { ConsoleIdentityContext } from '../security/console-identity-context';
import { IssueConsoleCredentialDto } from './dto/issue-console-credential.dto';
import type { RotateAppKeyDto } from '../../app-info/dto/rotate-appkey.dto';

const CREDENTIAL_APP_SELECT = {
  id: true,
  appname: true,
  appcode: true,
  status: true,
  appkey: true,
  appkeyId: true,
  appkeyHash: true,
  appkeyIssuedByIdentityId: true,
  appkeyLastUsedAt: true,
  appkeyExpiresAt: true,
  appkeyRotatedAt: true,
  previousAppkeyId: true,
  previousAppkeyHash: true,
  previousAppkeyIssuedByIdentityId: true,
  previousAppkeyIssuedAt: true,
  previousAppkeyLastUsedAt: true,
  previousAppkeyValidUntil: true,
} satisfies Prisma.AppInfoSelect;

type CredentialApp = Prisma.AppInfoGetPayload<{
  select: typeof CREDENTIAL_APP_SELECT;
}>;

@Injectable()
export class ConsoleCredentialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly appInfoService: AppInfoService,
    private readonly securityAudit: SecurityAuditService,
  ) {}

  async list(appId: string, identity: ConsoleIdentityContext) {
    const app = await this.findOwnedApp(appId, identity.organizationId);
    const now = new Date();
    return [
      this.summary(app, 'current', now),
      this.summary(app, 'previous', now),
    ].filter((credential) => credential !== null);
  }

  async issue(
    appId: string,
    dto: IssueConsoleCredentialDto,
    identity: ConsoleIdentityContext,
    requestId?: string,
  ) {
    const app = await this.findOwnedApp(appId, identity.organizationId);
    this.ensureActive(app);
    if (app.appkeyId || app.appkeyHash || app.appkey) {
      throw new ConflictException(
        '활성 credential이 있습니다. 회전 API를 사용하세요.',
      );
    }

    const credential = this.appInfoService.createAppKeyMaterial(
      app,
      dto.ttlDays,
    );
    const result = await this.prisma.appInfo.updateMany({
      where: {
        id: app.id,
        appkeyId: null,
        appkeyHash: null,
        appkey: null,
      },
      data: {
        appkeyId: credential.credentialId,
        appkeyHash: credential.appkeyHash,
        appkeyIssuedByIdentityId: identity.identityId,
        appkeyLastUsedAt: null,
        appkeyExpiresAt: credential.expiresAt,
        appkeyRotatedAt: credential.issuedAt,
      },
    });
    if (result.count !== 1) {
      throw new ConflictException('credential 상태가 변경되었습니다.');
    }

    await this.securityAudit.recordConsole({
      eventType: 'CONSOLE_APPKEY_ISSUED',
      identity,
      appId: app.id,
      appcode: app.appcode,
      requestId,
      metadata: {
        credentialId: credential.credentialId,
        expiresAt: credential.expiresAt.toISOString(),
      },
    });
    return {
      credential: {
        id: credential.credentialId,
        status: 'active' as const,
        issuedByIdentityId: identity.identityId,
        issuedAt: credential.issuedAt,
        lastUsedAt: null,
        expiresAt: credential.expiresAt,
        slot: 'current' as const,
      },
      appkey: credential.appkey,
    };
  }

  async rotate(
    appId: string,
    dto: RotateAppKeyDto,
    identity: ConsoleIdentityContext,
    requestId?: string,
  ) {
    const app = await this.findOwnedApp(appId, identity.organizationId);
    this.ensureActive(app);
    const currentHash =
      app.appkeyHash ??
      (app.appkey ? this.appInfoService.hashAppKeyValue(app.appkey) : null);
    if (!currentHash || !app.appkeyId) {
      throw new ConflictException(
        '발급된 credential이 없습니다. 발급 API를 사용하세요.',
      );
    }

    const gracePeriodSeconds = this.appInfoService.resolveRotationGracePeriod(
      dto.gracePeriodSeconds ?? 0,
    );
    const credential = this.appInfoService.createAppKeyMaterial(
      app,
      dto.ttlDays,
    );
    const previousCredentialValidUntil =
      this.appInfoService.previousCredentialValidUntil(
        credential.issuedAt,
        gracePeriodSeconds,
        currentHash,
        app.appkeyExpiresAt,
      );
    const result = await this.prisma.appInfo.updateMany({
      where: {
        id: app.id,
        appkeyId: app.appkeyId,
        appkeyHash: app.appkeyHash,
        appkey: app.appkey,
      },
      data: {
        appkey: null,
        appkeyId: credential.credentialId,
        appkeyHash: credential.appkeyHash,
        appkeyIssuedByIdentityId: identity.identityId,
        appkeyLastUsedAt: null,
        appkeyExpiresAt: credential.expiresAt,
        appkeyRotatedAt: credential.issuedAt,
        previousAppkeyId: previousCredentialValidUntil ? app.appkeyId : null,
        previousAppkeyHash: previousCredentialValidUntil ? currentHash : null,
        previousAppkeyIssuedByIdentityId: previousCredentialValidUntil
          ? app.appkeyIssuedByIdentityId
          : null,
        previousAppkeyIssuedAt: previousCredentialValidUntil
          ? app.appkeyRotatedAt
          : null,
        previousAppkeyLastUsedAt: previousCredentialValidUntil
          ? app.appkeyLastUsedAt
          : null,
        previousAppkeyValidUntil: previousCredentialValidUntil,
      },
    });
    if (result.count !== 1) {
      throw new ConflictException('credential 상태가 변경되었습니다.');
    }

    await this.securityAudit.recordConsole({
      eventType: 'CONSOLE_APPKEY_ROTATED',
      identity,
      appId: app.id,
      appcode: app.appcode,
      requestId,
      metadata: {
        credentialId: credential.credentialId,
        gracePeriodSeconds,
        expiresAt: credential.expiresAt.toISOString(),
        previousCredentialValidUntil:
          previousCredentialValidUntil?.toISOString() ?? null,
      },
    });
    return {
      credential: {
        id: credential.credentialId,
        status: 'active' as const,
        issuedByIdentityId: identity.identityId,
        issuedAt: credential.issuedAt,
        lastUsedAt: null,
        expiresAt: credential.expiresAt,
        slot: 'current' as const,
      },
      appkey: credential.appkey,
      previousCredentialValidUntil,
    };
  }

  async revoke(
    appId: string,
    credentialId: string,
    identity: ConsoleIdentityContext,
    requestId?: string,
  ) {
    const app = await this.findOwnedApp(appId, identity.organizationId);
    const current = app.appkeyId === credentialId;
    const previous = app.previousAppkeyId === credentialId;
    if (!current && !previous) {
      throw new NotFoundException('요청한 credential을 찾을 수 없습니다.');
    }

    const result = await this.prisma.appInfo.updateMany({
      where: current
        ? { id: app.id, appkeyId: credentialId }
        : { id: app.id, previousAppkeyId: credentialId },
      data: current
        ? {
            appkey: null,
            appkeyId: null,
            appkeyHash: null,
            appkeyIssuedByIdentityId: null,
            appkeyLastUsedAt: null,
            appkeyExpiresAt: null,
            appkeyRotatedAt: null,
          }
        : {
            previousAppkeyId: null,
            previousAppkeyHash: null,
            previousAppkeyIssuedByIdentityId: null,
            previousAppkeyIssuedAt: null,
            previousAppkeyLastUsedAt: null,
            previousAppkeyValidUntil: null,
          },
    });
    if (result.count !== 1) {
      throw new NotFoundException('요청한 credential을 찾을 수 없습니다.');
    }

    const revokedAt = new Date();
    await this.securityAudit.recordConsole({
      eventType: 'CONSOLE_APPKEY_REVOKED',
      identity,
      appId: app.id,
      appcode: app.appcode,
      requestId,
      metadata: { credentialId, slot: current ? 'current' : 'previous' },
    });
    return { credentialId, status: 'revoked' as const, revokedAt };
  }

  private async findOwnedApp(appInfoId: string, organizationId: string) {
    const ownership = await this.prisma.consoleAppOwnership.findFirst({
      where: { appInfoId, organizationId },
      select: { appInfo: { select: CREDENTIAL_APP_SELECT } },
    });
    if (!ownership) {
      throw new NotFoundException('요청한 앱을 찾을 수 없습니다.');
    }
    return ownership.appInfo;
  }

  private ensureActive(app: CredentialApp) {
    if (app.status !== 'active') {
      throw new ForbiddenException(
        '비활성 앱에는 credential을 발급할 수 없습니다.',
      );
    }
  }

  private summary(app: CredentialApp, slot: 'current' | 'previous', now: Date) {
    const current = slot === 'current';
    const id = current ? app.appkeyId : app.previousAppkeyId;
    const hash = current
      ? (app.appkeyHash ?? app.appkey)
      : app.previousAppkeyHash;
    if (!id || !hash) return null;
    const expiresAt = current
      ? app.appkeyExpiresAt
      : app.previousAppkeyValidUntil;
    return {
      id,
      status:
        expiresAt && expiresAt <= now
          ? ('expired' as const)
          : ('active' as const),
      issuedByIdentityId: current
        ? app.appkeyIssuedByIdentityId
        : app.previousAppkeyIssuedByIdentityId,
      issuedAt: current ? app.appkeyRotatedAt : app.previousAppkeyIssuedAt,
      lastUsedAt: current ? app.appkeyLastUsedAt : app.previousAppkeyLastUsedAt,
      expiresAt,
      slot,
    };
  }
}
