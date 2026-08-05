import { ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppInfoService } from './app-info.service';

describe('AppInfo appcode uniqueness contract', () => {
  it('maps a database uniqueness race to HTTP 409', async () => {
    const prisma = {
      appInfo: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockRejectedValue({ code: 'P2002' }),
      },
    };
    const config = {
      get: jest.fn().mockReturnValue('test-secret'),
    };
    const service = new AppInfoService(
      prisma as never,
      config as unknown as ConfigService,
      { record: jest.fn().mockResolvedValue(true) } as never,
    );

    await expect(
      service.create({ appname: 'Support', appcode: 'SUPPORT' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('fails closed when the dedicated appkey signing secret is missing', async () => {
    const prisma = {
      appInfo: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
    };
    const config = {
      get: jest.fn().mockReturnValue(undefined),
    };
    const service = new AppInfoService(
      prisma as never,
      config as unknown as ConfigService,
      { record: jest.fn().mockResolvedValue(true) } as never,
    );

    await expect(
      service.create({ appname: 'Support', appcode: 'SUPPORT' }),
    ).rejects.toThrow('APPKEY_JWT_SECRET is required');
    expect(prisma.appInfo.create).not.toHaveBeenCalled();
    expect(config.get).toHaveBeenCalledWith('APPKEY_JWT_SECRET');
  });
});
