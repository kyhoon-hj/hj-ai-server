import { Injectable, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import {
  DEVELOPMENT_CONSOLE_IDENTITY,
  isDevelopmentConsoleFixtureEnabled,
} from '../security/console-development-fixture';

@Injectable()
export class ConsoleDevelopmentFixtureService implements OnModuleInit {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async onModuleInit() {
    if (!isDevelopmentConsoleFixtureEnabled(this.config)) return;

    const identity = DEVELOPMENT_CONSOLE_IDENTITY;
    const lastSyncedAt = new Date();
    await this.prisma.$transaction(async (transaction) => {
      await transaction.consoleOrganization.upsert({
        where: { id: identity.organizationId },
        create: {
          id: identity.organizationId,
          worksOrganizationId: identity.worksOrganizationId,
          displayName: 'HJ Solution',
          status: identity.organizationStatus,
          lastSyncedAt,
        },
        update: {
          displayName: 'HJ Solution',
          status: identity.organizationStatus,
          lastSyncedAt,
        },
      });
      await transaction.consoleIdentity.upsert({
        where: { id: identity.identityId },
        create: {
          id: identity.identityId,
          worksUserId: identity.worksUserId,
          displayName: '김관리',
          status: identity.identityStatus,
          lastSyncedAt,
        },
        update: {
          displayName: '김관리',
          status: identity.identityStatus,
          lastSyncedAt,
        },
      });
      await transaction.consoleMembership.upsert({
        where: { id: identity.membershipId },
        create: {
          id: identity.membershipId,
          organizationId: identity.organizationId,
          identityId: identity.identityId,
          worksRole: 'ADMIN',
          permissions: [...identity.permissions],
          status: identity.membershipStatus,
          lastSyncedAt,
        },
        update: {
          worksRole: 'ADMIN',
          permissions: [...identity.permissions],
          status: identity.membershipStatus,
          lastSyncedAt,
        },
      });
    });
  }
}
