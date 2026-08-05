import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SecurityAuditQueryDto } from './dto/security-audit-query.dto';

export type SecurityAuditInput = {
  eventType: string;
  actorType: 'platform-admin' | 'knowledge-operator' | 'appkey' | 'system';
  actorId?: string;
  credentialSlot?: 'primary' | 'previous';
  appId?: string;
  appcode?: string;
  requestId?: string;
  method?: string;
  path?: string;
  metadata?: Record<string, string | number | boolean | null>;
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

  list(query: SecurityAuditQueryDto) {
    const requestedLimit = Number(query.limit ?? 50);
    const limit = Number.isInteger(requestedLimit)
      ? Math.min(200, Math.max(1, requestedLimit))
      : 50;
    return this.prisma.securityAuditEvent.findMany({
      where: {
        eventType: query.eventType,
        appId: query.appId,
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}
