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

  const createGuard = (allowedRoles: AdminRole[] = ['platform-admin']) =>
    new AdminApiKeyGuard(
      {
        get: jest.fn((key: string) =>
          key === 'ADMIN_API_KEY' ? adminKey : operatorKey,
        ),
      } as unknown as ConfigService,
      {
        getAllAndOverride: jest.fn().mockReturnValue(allowedRoles),
      } as unknown as Reflector,
    );

  it('accepts x-admin-key and binds the platform-admin role', () => {
    const guard = createGuard();
    const { context, request } = contextWithHeaders({
      'x-admin-key': adminKey,
    });

    expect(guard.canActivate(context)).toBe(true);
    expect(request).toMatchObject({ admin: { role: 'platform-admin' } });
  });

  it('accepts the knowledge operator on an allowed endpoint', () => {
    const guard = createGuard(['platform-admin', 'knowledge-operator']);
    const { context, request } = contextWithHeaders({
      'x-admin-key': operatorKey,
    });

    expect(guard.canActivate(context)).toBe(true);
    expect(request).toMatchObject({ admin: { role: 'knowledge-operator' } });
  });

  it('rejects the knowledge operator on a platform-only endpoint', () => {
    expect(() =>
      createGuard().canActivate(
        contextWithHeaders({ 'x-admin-key': operatorKey }).context,
      ),
    ).toThrow(ForbiddenException);
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
