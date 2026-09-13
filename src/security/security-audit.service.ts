import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SecurityAuditQueryDto } from './dto/security-audit-query.dto';
import type { ConsoleIdentityContext } from '../console/security/console-identity-context';

export type SecurityAuditInput = {
  eventType: string;
  actorType:
    | 'platform-admin'
    | 'knowledge-operator'
    | 'console-user'
    | 'appkey'
    | 'system';
  actorId?: string;
  credentialSlot?: 'primary' | 'previous';
  appId?: string;
  appcode?: string;
  requestId?: string;
  method?: string;
  path?: string;
  consoleIdentityId?: string;
  consoleOrganizationId?: string;
  worksUserId?: string;
  worksOrganizationId?: string;
  consoleSessionIdHash?: string;
  metadata?: Record<string, string | number | boolean | null>;
};

export type ConsoleSecurityAuditInput = Omit<
  SecurityAuditInput,
  | 'actorType'
  | 'actorId'
  | 'consoleIdentityId'
  | 'consoleOrganizationId'
  | 'worksUserId'
  | 'worksOrganizationId'
  | 'consoleSessionIdHash'
> & {
  identity: ConsoleIdentityContext;
  consoleSessionIdHash?: string;
};

@Injectable()
export class SecurityAuditService {
  private readonly logger = new Logger(SecurityAuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(input: SecurityAuditInput): Promise<boolean> {
    try {
      await this.prisma.securityAuditEvent.create({
        data: {
          eventType: input.eventType,
          actorType: input.actorType,
          actorId: input.actorId,
          credentialSlot: input.credentialSlot,
          appId: input.appId,
          appcode: input.appcode,
          requestId: input.requestId,
          method: input.method,
          path: input.path,
          consoleIdentityId: input.consoleIdentityId,
          consoleOrganizationId: input.consoleOrganizationId,
          worksUserId: input.worksUserId,
          worksOrganizationId: input.worksOrganizationId,
          consoleSessionIdHash: input.consoleSessionIdHash,
          metadata: input.metadata,
        },
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      this.logger.error(`Security audit persistence failed: ${message}`);
      return false;
    }
  }

  recordConsole(input: ConsoleSecurityAuditInput): Promise<boolean> {
    const { identity, consoleSessionIdHash, ...event } = input;
    if (consoleSessionIdHash && !/^[0-9a-f]{64}$/.test(consoleSessionIdHash)) {
      this.logger.error(
        'Security audit persistence failed: invalid Console session ID hash',
      );
      return Promise.resolve(false);
    }

    return this.record({
      ...event,
      actorType: 'console-user',
      actorId: identity.worksUserId,
      consoleIdentityId: identity.identityId,
      consoleOrganizationId: identity.organizationId,
      worksUserId: identity.worksUserId,
      worksOrganizationId: identity.worksOrganizationId,
      consoleSessionIdHash,
    });
  }

  list(query: SecurityAuditQueryDto) {
    const requestedLimit = Number(query.limit ?? 50);
    const limit = Number.isInteger(requestedLimit)
      ? Math.min(200, Math.max(1, requestedLimit))
      : 50;
    return this.prisma.securityAuditEvent.findMany({
      where: {
        eventType: query.eventType,
        appId: query.appId,
        consoleOrganizationId: query.consoleOrganizationId,
        worksUserId: query.worksUserId,
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}
