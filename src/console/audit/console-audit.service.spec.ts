import { BadRequestException } from '@nestjs/common';
import type { ConsoleIdentityContext } from '../security/console-identity-context';
import { ConsoleAuditService } from './console-audit.service';

const identity: ConsoleIdentityContext = {
  authenticationSource: 'test-fixture',
  identityId: '11111111-1111-4111-8111-111111111111',
  worksUserId: '22222222-2222-4222-8222-222222222222',
  identityStatus: 'ACTIVE',
  organizationId: '33333333-3333-4333-8333-333333333333',
  worksOrganizationId: '44444444-4444-4444-8444-444444444444',
  organizationStatus: 'ACTIVE',
  membershipId: '55555555-5555-4555-8555-555555555555',
  membershipStatus: 'ACTIVE',
  permissions: ['audit:read'],
};

const row = (id: string, createdAt: Date) => ({
  id,
  eventType: 'CONSOLE_APPKEY_ROTATED',
  actorType: 'console-user',
  appId: '66666666-6666-4666-8666-666666666666',
  appcode: 'APP_A',
  requestId: 'request-1',
  method: null,
  path: null,
  metadata: {
    credentialId: 'credential-1',
    gracePeriodSeconds: 300,
    recoveryKey: 'must-not-leak',
    secret: 'must-not-leak',
  },
  consoleIdentityId: identity.identityId,
  worksUserId: identity.worksUserId,
  createdAt,
});

describe('ConsoleAuditService', () => {
  it('forces organization scope, filters and metadata-only projection', async () => {
    const findMany = jest
      .fn<Promise<Array<ReturnType<typeof row>>>, [unknown]>()
      .mockResolvedValue([
        row(
          '77777777-7777-4777-8777-777777777777',
          new Date('2026-09-28T02:00:00.000Z'),
        ),
        row(
          '77777777-7777-4777-8777-777777777776',
          new Date('2026-09-28T01:00:00.000Z'),
        ),
      ]);
    const service = new ConsoleAuditService({
      securityAuditEvent: { findMany },
    } as never);

    const result = await service.list(identity, {
      days: 7,
      eventType: 'CONSOLE_APPKEY_ROTATED',
      appId: '66666666-6666-4666-8666-666666666666',
      worksUserId: identity.worksUserId,
      limit: 1,
    });

    const input = findMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
      take: number;
    };
    expect(input.where).toMatchObject({
      consoleOrganizationId: identity.organizationId,
      eventType: 'CONSOLE_APPKEY_ROTATED',
      appId: '66666666-6666-4666-8666-666666666666',
      worksUserId: identity.worksUserId,
    });
    expect(input.take).toBe(2);
    expect(result.items).toEqual([
      expect.objectContaining({
        eventType: 'CONSOLE_APPKEY_ROTATED',
        details: { credentialId: 'credential-1', gracePeriodSeconds: 300 },
      }),
    ]);
    expect(result.nextCursor).toEqual(expect.any(String));
    expect(JSON.stringify(result)).not.toMatch(
      /must-not-leak|recoveryKey|consoleSessionIdHash|metadata/,
    );
  });

  it('applies a stable createdAt and id cursor', async () => {
    const findMany = jest
      .fn<Promise<never[]>, [unknown]>()
      .mockResolvedValue([]);
    const service = new ConsoleAuditService({
      securityAuditEvent: { findMany },
    } as never);
    const cursor = Buffer.from(
      JSON.stringify({
        id: '77777777-7777-4777-8777-777777777777',
        createdAt: '2026-09-28T02:00:00.000Z',
      }),
    ).toString('base64url');

    await service.list(identity, { days: 30, limit: 25, cursor });

    const input = findMany.mock.calls[0][0] as {
      where: { AND: unknown[] };
    };
    expect(input.where.AND).toContainEqual({
      OR: [
        { createdAt: { lt: new Date('2026-09-28T02:00:00.000Z') } },
        {
          createdAt: new Date('2026-09-28T02:00:00.000Z'),
          id: { lt: '77777777-7777-4777-8777-777777777777' },
        },
      ],
    });
  });

  it('rejects an invalid cursor before querying the database', async () => {
    const findMany = jest.fn();
    const service = new ConsoleAuditService({
      securityAuditEvent: { findMany },
    } as never);

    await expect(
      service.list(identity, { days: 30, limit: 25, cursor: 'invalid' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(findMany).not.toHaveBeenCalled();
  });
});
