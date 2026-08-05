import {
  ForbiddenException,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import { AppkeyGuard } from './appkey.guard';

describe('AppkeyGuard contract', () => {
  const contextWithHeaders = (headers: Record<string, string>) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ headers }),
      }),
    }) as ExecutionContext;

  it.each(['appkey', 'x-app-key', 'x-appkey'])(
    'accepts the compatible %s header',
    async (header) => {
      const appInfo = {
        id: 'app-id',
        appcode: 'APP_A',
        allowedAccessLevels: [],
        status: 'active',
      };
      const appInfoService = {
        validateAppKey: jest.fn().mockResolvedValue(appInfo),
      };
      const guard = new AppkeyGuard(appInfoService as never);
      const context = contextWithHeaders({ [header]: 'valid-key' });

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(appInfoService.validateAppKey).toHaveBeenCalledWith('valid-key');
    },
  );

  it('rejects a missing or invalid key', async () => {
    const guard = new AppkeyGuard({
      validateAppKey: jest.fn().mockResolvedValue(null),
    } as never);

    await expect(
      guard.canActivate(contextWithHeaders({})),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects an inactive app', async () => {
    const guard = new AppkeyGuard({
      validateAppKey: jest
        .fn()
        .mockResolvedValue({ appcode: 'APP_A', status: 'inactive' }),
    } as never);

    await expect(
      guard.canActivate(contextWithHeaders({ appkey: 'inactive-key' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
