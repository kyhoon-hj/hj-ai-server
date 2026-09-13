import { NotFoundException } from '@nestjs/common';
import type { ConsoleIdentityContext } from '../security/console-identity-context';
import { ConsoleAppsService } from './console-apps.service';

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
  permissions: ['apps:read', 'apps:write'],
};

const app = {
  id: '66666666-6666-4666-8666-666666666666',
  appname: 'Support',
  appcode: 'CONSOLE_66666666666646668666666666666666',
  status: 'active',
  remark: null,
  appkeyExpiresAt: null,
  appkeyRotatedAt: null,
  createat: new Date('2030-01-01T00:00:00.000Z'),
  updateat: new Date('2030-01-01T00:00:00.000Z'),
};

type FindManyArgs = {
  where: { organizationId: string };
  select: unknown;
  orderBy: { createdAt: 'desc' };
};
type FindFirstArgs = {
  where: { appInfoId: string; organizationId: string };
  select: unknown;
};
type AppCreateArgs = {
  data: Record<string, unknown>;
  select: unknown;
};
type OwnershipCreateArgs = {
  data: {
    organizationId: string;
    appInfoId: string;
    createdByIdentityId: string;
  };
};
type AppUpdateArgs = {
  where: { id: string };
  data: Record<string, unknown>;
  select: unknown;
};

describe('ConsoleAppsService organization ownership contract', () => {
  const createFixture = () => {
    const findMany = jest.fn<
      Promise<Array<{ appInfo: typeof app }>>,
      [FindManyArgs]
    >(() => Promise.resolve([{ appInfo: app }]));
    const findFirst = jest.fn<
      Promise<{ appInfo: typeof app } | null>,
      [FindFirstArgs]
    >(() => Promise.resolve({ appInfo: app }));
    const appInfoCreate = jest.fn<Promise<typeof app>, [AppCreateArgs]>(() =>
      Promise.resolve(app),
    );
    const ownershipCreate = jest.fn<
      Promise<Record<string, never>>,
      [OwnershipCreateArgs]
    >(() => Promise.resolve({}));
    const appInfoUpdate = jest.fn<Promise<typeof app>, [AppUpdateArgs]>(() =>
      Promise.resolve(app),
    );
    const transactionClient = {
      appInfo: { create: appInfoCreate },
      consoleAppOwnership: { create: ownershipCreate },
    };
    const transaction = jest.fn<
      Promise<unknown>,
      [(client: typeof transactionClient) => Promise<unknown>]
    >((callback) => callback(transactionClient));
    const recordConsole = jest.fn<Promise<boolean>, [unknown]>(() =>
      Promise.resolve(true),
    );
    const service = new ConsoleAppsService(
      {
        consoleAppOwnership: { findMany, findFirst },
        appInfo: { update: appInfoUpdate },
        $transaction: transaction,
      } as never,
      { recordConsole } as never,
    );
    return {
      service,
      findMany,
      findFirst,
      appInfoCreate,
      ownershipCreate,
      appInfoUpdate,
      transaction,
      recordConsole,
    };
  };

  it('lists only apps owned by the selected organization', async () => {
    const { service, findMany } = createFixture();

    await expect(service.list(identity)).resolves.toEqual([app]);
    expect(findMany.mock.calls[0][0].where).toEqual({
      organizationId: identity.organizationId,
    });
    expect(findMany.mock.calls[0][0].orderBy).toEqual({
      createdAt: 'desc',
    });
  });

  it('returns a non-disclosing 404 when ownership is absent', async () => {
    const { service, findFirst } = createFixture();
    findFirst.mockResolvedValueOnce(null);

    await expect(service.findOne(app.id, identity)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(findFirst.mock.calls[0][0].where).toEqual({
      appInfoId: app.id,
      organizationId: identity.organizationId,
    });
  });

  it('creates the app and ownership in one transaction with server-owned fields', async () => {
    const {
      service,
      transaction,
      appInfoCreate,
      ownershipCreate,
      recordConsole,
    } = createFixture();

    await expect(
      service.create({ appname: 'Support' }, identity),
    ).resolves.toBe(app);
    expect(transaction).toHaveBeenCalledTimes(1);
    const appData = appInfoCreate.mock.calls[0][0].data;
    expect(appData.appcode).toMatch(/^CONSOLE_[0-9A-F]{32}$/);
    expect(appData).toMatchObject({
      appname: 'Support',
      status: 'active',
      allowedAccessLevels: ['PUBLIC'],
    });
    expect(appData).not.toHaveProperty('appkey');
    expect(ownershipCreate).toHaveBeenCalledWith({
      data: {
        organizationId: identity.organizationId,
        appInfoId: app.id,
        createdByIdentityId: identity.identityId,
      },
    });
    expect(recordConsole).toHaveBeenCalledTimes(1);
  });

  it('checks ownership before updating only user-editable fields', async () => {
    const { service, findFirst, appInfoUpdate, recordConsole } =
      createFixture();

    await service.update(
      app.id,
      { appname: 'Updated', status: 'inactive' },
      identity,
    );

    expect(findFirst).toHaveBeenCalledTimes(1);
    const updateCall = appInfoUpdate.mock.calls[0][0];
    expect(updateCall.where).toEqual({ id: app.id });
    expect(updateCall.data).toEqual({
      appname: 'Updated',
      remark: undefined,
      status: 'inactive',
    });
    expect(recordConsole).toHaveBeenCalledTimes(1);
  });
});
