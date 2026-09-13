import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  CONSOLE_IDENTITY_CONTEXT_RESOLVER,
  type ConsoleIdentityContextResolver,
} from './console-identity-context.resolver';
import type {
  ConsolePermission,
  ConsoleRequest,
} from './console-identity-context';
import {
  CONSOLE_ORGANIZATION_PARAM_KEY,
  CONSOLE_PERMISSIONS_KEY,
} from './console-permissions.decorator';

@Injectable()
export class ConsolePermissionGuard implements CanActivate {
  constructor(
    @Inject(CONSOLE_IDENTITY_CONTEXT_RESOLVER)
    private readonly identityResolver: ConsoleIdentityContextResolver,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<ConsoleRequest>();
    const identity = await this.identityResolver.resolve(request);

    if (!identity) {
      throw new UnauthorizedException('Console 로그인이 필요합니다.');
    }

    if (
      identity.identityStatus !== 'ACTIVE' ||
      identity.organizationStatus !== 'ACTIVE' ||
      identity.membershipStatus !== 'ACTIVE'
    ) {
      throw new ForbiddenException('비활성화된 Console 접근 권한입니다.');
    }

    const requiredPermissions =
      this.reflector.getAllAndOverride<ConsolePermission[]>(
        CONSOLE_PERMISSIONS_KEY,
        [context.getHandler(), context.getClass()],
      ) ?? [];
    const grantedPermissions = new Set(identity.permissions);
    if (
      requiredPermissions.some(
        (permission) => !grantedPermissions.has(permission),
      )
    ) {
      throw new ForbiddenException('이 작업에 필요한 권한이 없습니다.');
    }

    const organizationParam = this.reflector.getAllAndOverride<string>(
      CONSOLE_ORGANIZATION_PARAM_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (
      organizationParam &&
      request.params?.[organizationParam] !== identity.organizationId
    ) {
      throw new NotFoundException('요청한 리소스를 찾을 수 없습니다.');
    }

    request.consoleIdentity = identity;
    return true;
  }
}
