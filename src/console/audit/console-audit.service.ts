import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { ConsoleIdentityContext } from '../security/console-identity-context';
import { ListConsoleAuditEventsDto } from './dto/list-console-audit-events.dto';

const SAFE_DETAIL_KEYS = new Set([
  'action',
  'changedFields',
  'credentialId',
  'evidenceRef',
  'expiresAt',
  'gracePeriodSeconds',
  'previousCredentialValidUntil',
  'previousState',
  'reservationId',
  'slot',
]);

const AUDIT_SELECT = {
  id: true,
  eventType: true,
  actorType: true,
  appId: true,
  appcode: true,
  requestId: true,
  method: true,
  path: true,
  metadata: true,
  consoleIdentityId: true,
  worksUserId: true,
  createdAt: true,
} satisfies Prisma.SecurityAuditEventSelect;

type AuditRow = Prisma.SecurityAuditEventGetPayload<{
  select: typeof AUDIT_SELECT;
}>;

@Injectable()
export class ConsoleAuditService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    identity: ConsoleIdentityContext,
    query: ListConsoleAuditEventsDto,
  ) {
    const limit = query.limit ?? 25;
    const from = new Date(Date.now() - (query.days ?? 30) * 86_400_000);
    const cursor = query.cursor ? this.decodeCursor(query.cursor) : null;
    const rows = await this.prisma.securityAuditEvent.findMany({
      where: {
        consoleOrganizationId: identity.organizationId,
        eventType: query.eventType,
        appId: query.appId,
        worksUserId: query.worksUserId,
        AND: [
          { createdAt: { gte: from } },
          ...(cursor
            ? [
                {
                  OR: [
                    { createdAt: { lt: cursor.createdAt } },
                    {
                      createdAt: cursor.createdAt,
                      id: { lt: cursor.id },
                    },
                  ],
                },
              ]
            : []),
        ],
      },
      select: AUDIT_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const hasNext = rows.length > limit;
    const items = rows.slice(0, limit);
    return {
      items: items.map((row) => this.present(row)),
      nextCursor: hasNext ? this.encodeCursor(items[items.length - 1]) : null,
    };
  }

  private present(row: AuditRow) {
    return {
      id: row.id,
      eventType: row.eventType,
      actor: {
        type: row.actorType,
        worksUserId: row.worksUserId,
        consoleIdentityId: row.consoleIdentityId,
      },
      app:
        row.appId || row.appcode
          ? { id: row.appId, appcode: row.appcode }
          : null,
      requestId: row.requestId,
      method: row.method,
      path: row.path,
      details: this.safeDetails(row.metadata),
      createdAt: row.createdAt,
    };
  }

  private safeDetails(metadata: unknown) {
    if (!metadata || Array.isArray(metadata) || typeof metadata !== 'object') {
      return {};
    }
    return Object.fromEntries(
      Object.entries(metadata as Record<string, unknown>).filter(
        ([key, value]) =>
          SAFE_DETAIL_KEYS.has(key) &&
          (value === null ||
            typeof value === 'string' ||
            typeof value === 'number' ||
            typeof value === 'boolean'),
      ),
    );
  }

  private encodeCursor(row: Pick<AuditRow, 'id' | 'createdAt'>) {
    return Buffer.from(
      JSON.stringify({ id: row.id, createdAt: row.createdAt.toISOString() }),
    ).toString('base64url');
  }

  private decodeCursor(value: string) {
    try {
      const parsed = JSON.parse(
        Buffer.from(value, 'base64url').toString('utf8'),
      ) as { id?: unknown; createdAt?: unknown };
      const createdAt = new Date(String(parsed.createdAt));
      if (
        typeof parsed.id !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          parsed.id,
        ) ||
        Number.isNaN(createdAt.getTime())
      ) {
        throw new Error('invalid cursor');
      }
      return { id: parsed.id, createdAt };
    } catch {
      throw new BadRequestException('INVALID_AUDIT_CURSOR');
    }
  }
}
