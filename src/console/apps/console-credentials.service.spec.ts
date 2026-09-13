import { ConflictException, NotFoundException } from '@nestjs/common';
import type { ConsoleIdentityContext } from '../security/console-identity-context';
import { ConsoleCredentialsService } from './console-credentials.service';

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
  permissions: ['credentials:read', 'credentials:rotate', 'credentials:revoke'],
};

const now = new Date('2030-01-01T00:00:00.000Z');
const appId = '66666666-6666-4666-8666-666666666666';
const currentCredentialId = '77777777-7777-4777-8777-777777777777';
const previousCredentialId = '88888888-8888-4888-8888-888888888888';
const appFixture = () => ({
  id: appId,
  appname: 'Support',
  appcode: 'CONSOLE_SUPPORT',
  status: 'active',
  appkey: null as string | null,
  appkeyId: currentCredentialId as string | null,
  appkeyHash: 'current-hash' as string | null,
  appkeyIssuedByIdentityId: identity.identityId as string | null,
  appkeyLastUsedAt: now as Date | null,
  appkeyExpiresAt: new Date('2030-02-01T00:00:00.000Z') as Date | null,
  appkeyRotatedAt: now as Date | null,
  previousAppkeyId: previousCredentialId as string | null,
  previousAppkeyHash: 'previous-hash' as string | null,
  previousAppkeyIssuedByIdentityId: identity.identityId as string | null,
  previousAppkeyIssuedAt: new Date('2029-12-01T00:00:00.000Z') as Date | null,
  previousAppkeyLastUsedAt: null as Date | null,
  previousAppkeyValidUntil: new Date('2030-01-01T00:05:00.000Z') as Date | null,
});

type FindArgs = {
  where: { appInfoId: string; organizationId: string };
  select: unknown;
};
type UpdateArgs = {
  where: Record<string, unknown>;
  data: Record<string, unknown>;
};

describe('ConsoleCredentialsService lifecycle contract', () => {
  const createFixture = (app = appFixture()) => {
    const findFirst = jest.fn<
      Promise<{ appInfo: typeof app } | null>,
      [FindArgs]
    >(() => Promise.resolve({ appInfo: app }));
    const updateMany = jest.fn<Promise<{ count: number }>, [UpdateArgs]>(() =>
      Promise.resolve({ count: 1 }),
    );
    const material = {
      credentialId: '99999999-9999-4999-8999-999999999999',
      appkey: 'one-time-secret',
      appkeyHash: 'new-hash',
      issuedAt: now,
      expiresAt: new Date('2030-04-01T00:00:00.000Z'),
    };
    const createAppKeyMaterial = jest.fn(() => material);
    const resolveRotationGracePeriod = jest.fn((seconds: number) => seconds);
    const previousCredentialValidUntil = jest.fn(
      (
        issuedAt: Date,
        seconds: number,
        hash: string | null,
        expiresAt: Date | null,
      ) => {
        if (!hash || seconds <= 0) return null;
        const requested = new Date(issuedAt.getTime() + seconds * 1000);
        return expiresAt && expiresAt < requested ? expiresAt : requested;
      },
    );
    const hashAppKeyValue = jest.fn(() => 'legacy-hash');
    const recordConsole = jest.fn<Promise<boolean>, [unknown]>(() =>
      Promise.resolve(true),
    );
    const service = new ConsoleCredentialsService(
      {
        consoleAppOwnership: { findFirst },
        appInfo: { updateMany },
      } as never,
      {
        createAppKeyMaterial,
        resolveRotationGracePeriod,
        previousCredentialValidUntil,
        hashAppKeyValue,
      } as never,
      { recordConsole } as never,
    );
    return {
      service,
      findFirst,
      updateMany,
      material,
      recordConsole,
    };
  };

  it('returns credential metadata without hashes or key material', async () => {
    const { service } = createFixture();

    const result = await service.list(appId, identity);
    expect(result).toHaveLength(2);
    expect(result.map((credential) => credential.id)).toEqual([
      currentCredentialId,
      previousCredentialId,
    ]);
    expect(JSON.stringify(result)).not.toMatch(/current-hash|previous-hash/);
  });

  it('issues a one-time key only when no current credential exists', async () => {
    const app = appFixture();
    app.appkeyId = null;
    app.appkeyHash = null;
    const { service, updateMany, material, recordConsole } = createFixture(app);

    const result = await service.issue(appId, { ttlDays: 90 }, identity);
    expect(result.appkey).toBe(material.appkey);
    const update = updateMany.mock.calls[0][0];
    expect(update.where).toEqual({
      id: appId,
      appkeyId: null,
      appkeyHash: null,
      appkey: null,
    });
    expect(update.data).toMatchObject({
      appkeyId: material.credentialId,
      appkeyHash: material.appkeyHash,
      appkeyIssuedByIdentityId: identity.identityId,
    });
    expect(recordConsole).toHaveBeenCalledTimes(1);
  });

  it('requires rotation when an active credential already exists', async () => {
    const { service, updateMany } = createFixture();

    await expect(service.issue(appId, {}, identity)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('rotates with grace while preserving previous credential metadata', async () => {
    const { service, updateMany, material } = createFixture();

    const result = await service.rotate(
      appId,
      { gracePeriodSeconds: 60 },
      identity,
    );
    expect(result.appkey).toBe(material.appkey);
    expect(result.previousCredentialValidUntil).toEqual(
      new Date('2030-01-01T00:01:00.000Z'),
    );
    expect(updateMany.mock.calls[0][0].data).toMatchObject({
      appkeyId: material.credentialId,
      previousAppkeyId: currentCredentialId,
      previousAppkeyHash: 'current-hash',
      previousAppkeyIssuedByIdentityId: identity.identityId,
      previousAppkeyLastUsedAt: now,
    });
  });

  it('revokes an exact credential ID and hides unknown ownership', async () => {
    const { service, findFirst, updateMany } = createFixture();

    await expect(
      service.revoke(appId, currentCredentialId, identity),
    ).resolves.toMatchObject({
      credentialId: currentCredentialId,
      status: 'revoked',
    });
    expect(updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: appId, appkeyId: currentCredentialId },
      data: { appkeyId: null, appkeyHash: null },
    });

    findFirst.mockResolvedValueOnce(null);
    await expect(service.list(appId, identity)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('detects a concurrent credential state change', async () => {
    const app = appFixture();
    app.appkeyId = null;
    app.appkeyHash = null;
    const { service, updateMany } = createFixture(app);
    updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(service.issue(appId, {}, identity)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});
