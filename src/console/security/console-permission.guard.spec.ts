import {
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { ConsoleIdentityContext } from './console-identity-context';
import type { ConsoleIdentityContextResolver } from './console-identity-context.resolver';
import { ConsolePermissionGuard } from './console-permission.guard';
import { ConsoleSecurityModule } from './console-security.module';

const identityFixture = (
  overrides: Partial<ConsoleIdentityContext> = {},
): ConsoleIdentityContext => ({
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
  ...overrides,
});

const contextFixture = (organizationId?: string) => {
  const request = {
    headers: {},
    params: organizationId ? { organizationId } : {},
  };
  return {
    request,
    context: {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => contextFixture,
      getClass: () => ConsolePermissionGuard,
    } as unknown as ExecutionContext,
  };
};

const guardFixture = (
  identity: ConsoleIdentityContext | null,
  permissions: ConsoleIdentityContext['permissions'] = [],
  organizationParam?: string,
) => {
  const resolve = jest.fn().mockResolvedValue(identity);
  const resolver: ConsoleIdentityContextResolver = {
    resolve,
  };
  const reflector = {
    getAllAndOverride: jest.fn((key: string) =>
      key === 'console_permissions' ? permissions : organizationParam,
    ),
  };
  return {
    guard: new ConsolePermissionGuard(
      resolver,
      reflector as unknown as Reflector,
    ),
    resolve,
  };
};

describe('ConsolePermissionGuard contract', () => {
  it('uses a fail-closed resolver in the application module by default', async () => {
    const module = await Test.createTestingModule({
      imports: [ConsoleSecurityModule],
    }).compile();
    const guard = module.get(ConsolePermissionGuard);

    await expect(
      guard.canActivate(contextFixture().context),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await module.close();
  });

  it('attaches an active identity with every required permission', async () => {
    const identity = identityFixture();
    const { guard } = guardFixture(identity, ['apps:read', 'apps:write']);
    const { context, request } = contextFixture();

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request).toMatchObject({ consoleIdentity: identity });
  });

  it('fails closed when no identity adapter resolves the request', async () => {
    const { guard, resolve } = guardFixture(null, ['apps:read']);
    const { context } = contextFixture();

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it.each([
    { identityStatus: 'DISABLED' as const },
    { organizationStatus: 'DISABLED' as const },
    { membershipStatus: 'REMOVED' as const },
  ])('rejects an inactive identity scope: %j', async (override) => {
    const { guard } = guardFixture(identityFixture(override));

    await expect(
      guard.canActivate(contextFixture().context),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('requires every permission declared by the endpoint', async () => {
    const { guard } = guardFixture(identityFixture(), [
      'apps:read',
      'credentials:rotate',
    ]);

    await expect(
      guard.canActivate(contextFixture().context),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('hides a route scoped to another organization', async () => {
    const identity = identityFixture();
    const { guard } = guardFixture(identity, ['apps:read'], 'organizationId');

    await expect(
      guard.canActivate(
        contextFixture('66666666-6666-4666-8666-666666666666').context,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('accepts an explicitly scoped route for the selected organization', async () => {
    const identity = identityFixture();
    const { guard } = guardFixture(identity, ['apps:read'], 'organizationId');

    await expect(
      guard.canActivate(contextFixture(identity.organizationId).context),
    ).resolves.toBe(true);
  });

  it('does not derive identity from spoofed request headers', async () => {
    const { guard } = guardFixture(null);
    const { context, request } = contextFixture();
    request.headers = {
      'x-console-identity-id': '11111111-1111-4111-8111-111111111111 parser',
    };

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
