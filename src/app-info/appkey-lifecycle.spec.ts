import { ConfigService } from '@nestjs/config';
import { AppInfoService } from './app-info.service';

describe('AppInfo appkey lifecycle', () => {
  it('발급 만료와 rotation grace window를 적용한다', async () => {
    type AppState = Record<string, unknown> & {
      previousAppkeyValidUntil?: Date;
      appkeyExpiresAt?: Date;
    };
    let state: AppState | null = null;
    const getState = (): AppState | null => state;
    const appInfo = {
      findFirst: jest.fn((args: { where: Record<string, unknown> }) => {
        if ('appcode' in args.where) return null;
        if (!state) return null;
        const conditions = args.where.OR as Array<Record<string, unknown>>;
        return conditions.some((condition) =>
          Object.entries(condition).every(
            ([key, value]) => state?.[key] === value,
          ),
        )
          ? state
          : null;
      }),
      findUnique: jest.fn(() => state),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        state = {
          ...data,
          createat: new Date(),
          updateat: new Date(),
        };
        return Promise.resolve(state);
      }),
      update: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        state = { ...state, ...data, updateat: new Date() };
        return Promise.resolve(state);
      }),
    };
    const config = {
      get: jest.fn(
        (key: string) =>
          ({
            APPKEY_JWT_SECRET: 's'.repeat(32),
            APPKEY_TTL_DAYS: '90',
            APPKEY_MAX_ROTATION_GRACE_SECONDS: '3600',
          })[key],
      ),
    };
    const audit = { record: jest.fn().mockResolvedValue(true) };
    const service = new AppInfoService(
      { appInfo } as never,
      config as unknown as ConfigService,
      audit as never,
    );

    const created = await service.create({
      appname: 'Lifecycle',
      appcode: 'LIFECYCLE',
    });
    const tokenPayload: unknown = JSON.parse(
      Buffer.from(created.appkey.split('.')[1], 'base64url').toString('utf8'),
    );
    if (
      !tokenPayload ||
      typeof tokenPayload !== 'object' ||
      !('iat' in tokenPayload) ||
      typeof tokenPayload.iat !== 'number' ||
      !('exp' in tokenPayload) ||
      typeof tokenPayload.exp !== 'number'
    ) {
      throw new Error('appkey payload must contain numeric iat and exp');
    }
    expect(tokenPayload.exp).toBeGreaterThan(tokenPayload.iat);
    await expect(service.validateAppKey(created.appkey)).resolves.toMatchObject(
      {
        appcode: 'LIFECYCLE',
      },
    );
    expect(getState()?.appkeyLastUsedAt).toBeInstanceOf(Date);

    const rotated = await service.rotateAppKey(created.id, {
      gracePeriodSeconds: 60,
      ttlDays: 30,
    });
    await expect(service.validateAppKey(created.appkey)).resolves.toMatchObject(
      {
        appcode: 'LIFECYCLE',
      },
    );
    expect(getState()?.previousAppkeyLastUsedAt).toBeInstanceOf(Date);
    await expect(service.validateAppKey(rotated.appkey)).resolves.toMatchObject(
      {
        appcode: 'LIFECYCLE',
      },
    );

    const stateAfterRotation = getState();
    if (!stateAfterRotation) throw new Error('app state is required');
    stateAfterRotation.previousAppkeyValidUntil = new Date(Date.now() - 1);
    await expect(service.validateAppKey(created.appkey)).resolves.toBeNull();
    await expect(service.validateAppKey(rotated.appkey)).resolves.toMatchObject(
      {
        appcode: 'LIFECYCLE',
      },
    );

    const rotatedPayload = JSON.parse(
      Buffer.from(rotated.appkey.split('.')[1], 'base64url').toString('utf8'),
    ) as { exp: number };
    const stateBeforeExpiry = getState();
    if (!stateBeforeExpiry) throw new Error('app state is required');
    stateBeforeExpiry.appkeyExpiresAt = new Date(
      (rotatedPayload.exp + 86_400) * 1000,
    );
    jest.useFakeTimers().setSystemTime((rotatedPayload.exp + 1) * 1000);
    try {
      await expect(service.validateAppKey(rotated.appkey)).resolves.toBeNull();
    } finally {
      jest.useRealTimers();
    }
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'APPKEY_ISSUED' }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'APPKEY_ROTATED' }),
    );
  });

  it('never extends a previous key beyond its original expiry', () => {
    const service = new AppInfoService(
      {} as never,
      {
        get: jest.fn().mockReturnValue('s'.repeat(32)),
      } as unknown as ConfigService,
      { record: jest.fn() } as never,
    );
    const issuedAt = new Date('2030-01-01T00:00:00.000Z');
    const originalExpiry = new Date('2030-01-01T00:00:30.000Z');

    expect(
      service.previousCredentialValidUntil(
        issuedAt,
        60,
        'current-hash',
        originalExpiry,
      ),
    ).toEqual(originalExpiry);
    expect(
      service.previousCredentialValidUntil(
        issuedAt,
        60,
        'current-hash',
        issuedAt,
      ),
    ).toBeNull();
  });
});
