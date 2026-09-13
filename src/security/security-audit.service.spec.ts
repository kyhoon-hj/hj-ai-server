import { Logger } from '@nestjs/common';
import { SecurityAuditService } from './security-audit.service';
import type { ConsoleIdentityContext } from '../console/security/console-identity-context';

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
  permissions: ['apps:write'],
};

describe('SecurityAuditService Console actor contract', () => {
  const createService = () => {
    const create = jest.fn().mockResolvedValue({});
    const findMany = jest.fn().mockResolvedValue([]);
    return {
      create,
      findMany,
      service: new SecurityAuditService({
        securityAuditEvent: { create, findMany },
      } as never),
    };
  };

  it('records immutable Console and Works actor IDs without profile data', async () => {
    const { create, service } = createService();
    const sessionIdHash = 'a'.repeat(64);

    await expect(
      service.recordConsole({
        eventType: 'CONSOLE_APP_CREATED',
        identity,
        consoleSessionIdHash: sessionIdHash,
        requestId: '66666666-6666-4666-8666-666666666666',
        appId: '77777777-7777-4777-8777-777777777777',
      }),
    ).resolves.toBe(true);

    expect(create).toHaveBeenCalledWith({
      data: {
        eventType: 'CONSOLE_APP_CREATED',
        actorType: 'console-user',
        actorId: identity.worksUserId,
        credentialSlot: undefined,
        appId: '77777777-7777-4777-8777-777777777777',
        appcode: undefined,
        requestId: '66666666-6666-4666-8666-666666666666',
        method: undefined,
        path: undefined,
        consoleIdentityId: identity.identityId,
        consoleOrganizationId: identity.organizationId,
        worksUserId: identity.worksUserId,
        worksOrganizationId: identity.worksOrganizationId,
        consoleSessionIdHash: sessionIdHash,
        metadata: undefined,
      },
    });
    expect(JSON.stringify(create.mock.calls)).not.toMatch(
      /displayName|email|permissions/,
    );
  });

  it('rejects a raw or malformed session identifier before persistence', async () => {
    const { create, service } = createService();
    const loggerSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    await expect(
      service.recordConsole({
        eventType: 'CONSOLE_APP_CREATED',
        identity,
        consoleSessionIdHash: 'raw-session-token',
      }),
    ).resolves.toBe(false);
    expect(create).not.toHaveBeenCalled();
    loggerSpy.mockRestore();
  });

  it('preserves existing administrator audit writes', async () => {
    const { create, service } = createService();

    await expect(
      service.record({
        eventType: 'ADMIN_API_ACCESSED',
        actorType: 'platform-admin',
        actorId: 'platform-admin',
      }),
    ).resolves.toBe(true);
    expect(create).toHaveBeenCalledWith({
      data: {
        eventType: 'ADMIN_API_ACCESSED',
        actorType: 'platform-admin',
        actorId: 'platform-admin',
        credentialSlot: undefined,
        appId: undefined,
        appcode: undefined,
        requestId: undefined,
        method: undefined,
        path: undefined,
        consoleIdentityId: undefined,
        consoleOrganizationId: undefined,
        worksUserId: undefined,
        worksOrganizationId: undefined,
        consoleSessionIdHash: undefined,
        metadata: undefined,
      },
    });
  });

  it('supports organization and Works user filters with a bounded limit', async () => {
    const { findMany, service } = createService();

    await service.list({
      consoleOrganizationId: identity.organizationId,
      worksUserId: identity.worksUserId,
      limit: 999,
    });

    expect(findMany).toHaveBeenCalledWith({
      where: {
        eventType: undefined,
        appId: undefined,
        consoleOrganizationId: identity.organizationId,
        worksUserId: identity.worksUserId,
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  });
});
