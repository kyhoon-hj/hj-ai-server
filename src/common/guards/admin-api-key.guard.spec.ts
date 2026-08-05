import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdminApiKeyGuard } from './admin-api-key.guard';

describe('AdminApiKeyGuard contract', () => {
  const adminKey = 'admin-key-with-at-least-thirty-two-characters';
  const contextWithHeaders = (headers: Record<string, string>) => {
    const request = { headers };
    return {
      request,
      context: {
        switchToHttp: () => ({ getRequest: () => request }),
      } as ExecutionContext,
    };
  };

  const createGuard = () =>
    new AdminApiKeyGuard({
      get: jest.fn().mockReturnValue(adminKey),
    } as unknown as ConfigService);

  it('accepts x-admin-key and binds the platform-admin role', () => {
    const guard = createGuard();
    const { context, request } = contextWithHeaders({
      'x-admin-key': adminKey,
    });

    expect(guard.canActivate(context)).toBe(true);
    expect(request).toMatchObject({ admin: { role: 'platform-admin' } });
  });

  it.each([{}, { 'x-admin-key': 'wrong-key' }])(
    'rejects a missing or invalid administrator key',
    (headers) => {
      expect(() =>
        createGuard().canActivate(contextWithHeaders(headers).context),
      ).toThrow(UnauthorizedException);
    },
  );
});
