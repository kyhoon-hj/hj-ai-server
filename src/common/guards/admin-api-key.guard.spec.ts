import {
  ForbiddenException,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { AdminApiKeyGuard } from './admin-api-key.guard';
import type { AdminRole } from './admin-roles.decorator';

describe('AdminApiKeyGuard contract', () => {
  const adminKey = 'admin-key-with-at-least-thirty-two-characters';
  const operatorKey = 'operator-key-with-at-least-thirty-two-characters';
  const previousAdminKey =
    'previous-admin-key-with-at-least-thirty-two-characters';
  const contextWithHeaders = (headers: Record<string, string>) => {
    const request = { headers };
    return {
      request,
      context: {
        switchToHttp: () => ({ getRequest: () => request }),
        getHandler: () => contextWithHeaders,
        getClass: () => AdminApiKeyGuard,
      } as ExecutionContext,
    };
  };

  const createGuard = (
    allowedRoles: AdminRole[] = ['platform-admin'],
    overrides: Record<string, string> = {},
  ) =>
    new AdminApiKeyGuard(
      {
        get: jest.fn(
          (key: string) =>
            ({
              ADMIN_API_KEY: adminKey,
              KNOWLEDGE_OPERATOR_API_KEY: operatorKey,
              ...overrides,
            })[key],
        ),
      } as unknown as ConfigService,
      {
        getAllAndOverride: jest.fn().mockReturnValue(allowedRoles),
      } as unknown as Reflector,
      { record: jest.fn().mockResolvedValue(true) } as never,
    );

  it('accepts x-admin-key and binds the platform-admin role', async () => {
    const guard = createGuard();
    const { context, request } = contextWithHeaders({
      'x-admin-key': adminKey,
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request).toMatchObject({
      admin: { role: 'platform-admin', credentialSlot: 'primary' },
    });
  });

  it('accepts the knowledge operator on an allowed endpoint', async () => {
    const guard = createGuard(['platform-admin', 'knowledge-operator']);
    const { context, request } = contextWithHeaders({
      'x-admin-key': operatorKey,
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request).toMatchObject({
      admin: { role: 'knowledge-operator', credentialSlot: 'primary' },
    });
  });

  it('rejects the knowledge operator on a platform-only endpoint', async () => {
    await expect(
      createGuard().canActivate(
        contextWithHeaders({ 'x-admin-key': operatorKey }).context,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it.each([{}, { 'x-admin-key': 'wrong-key' }])(
    'rejects a missing or invalid administrator key',
    async (headers) => {
      await expect(
        createGuard().canActivate(contextWithHeaders(headers).context),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    },
  );

  it('accepts an unexpired previous administrator key', async () => {
    const guard = createGuard(['platform-admin'], {
      ADMIN_API_KEY_PREVIOUS: previousAdminKey,
      ADMIN_API_KEY_PREVIOUS_VALID_UNTIL: new Date(
        Date.now() + 60_000,
      ).toISOString(),
    });
    const { context, request } = contextWithHeaders({
      'x-admin-key': previousAdminKey,
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request).toMatchObject({
      admin: { role: 'platform-admin', credentialSlot: 'previous' },
    });
  });

  it('rejects an expired previous administrator key', async () => {
    const guard = createGuard(['platform-admin'], {
      ADMIN_API_KEY_PREVIOUS: previousAdminKey,
      ADMIN_API_KEY_PREVIOUS_VALID_UNTIL: new Date(
        Date.now() - 60_000,
      ).toISOString(),
    });

    await expect(
      guard.canActivate(
        contextWithHeaders({ 'x-admin-key': previousAdminKey }).context,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
