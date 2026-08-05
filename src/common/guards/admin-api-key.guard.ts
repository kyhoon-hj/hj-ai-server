import { timingSafeEqual } from 'node:crypto';
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { CorrelatedRequest } from '../http/correlation-id.middleware';
import { ADMIN_ROLES_KEY, type AdminRole } from './admin-roles.decorator';

export type AdminRequest = CorrelatedRequest & {
  admin?: { role: AdminRole };
};

@Injectable()
export class AdminApiKeyGuard implements CanActivate {
  constructor(
    private readonly configService: ConfigService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AdminRequest>();
    const provided = this.extractHeader(request);
    const role = provided ? this.resolveRole(provided) : null;

    if (!role) {
      throw new UnauthorizedException('유효한 관리자 credential이 필요합니다.');
    }

    const allowedRoles = this.reflector.getAllAndOverride<AdminRole[]>(
      ADMIN_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    ) ?? ['platform-admin'];

    if (!allowedRoles.includes(role)) {
      throw new ForbiddenException('이 관리자 역할에는 접근 권한이 없습니다.');
    }

    request.admin = { role };
    return true;
  }

  private resolveRole(provided: string): AdminRole | null {
    const credentials: Array<[AdminRole, string | undefined]> = [
      [
        'platform-admin',
        this.configService.get<string>('ADMIN_API_KEY')?.trim(),
      ],
      [
        'knowledge-operator',
        this.configService.get<string>('KNOWLEDGE_OPERATOR_API_KEY')?.trim(),
      ],
    ];
    return (
      credentials.find(
        ([, expected]) => expected && this.matches(provided, expected),
      )?.[0] ?? null
    );
  }

  private extractHeader(request: CorrelatedRequest) {
    const value = request.headers['x-admin-key'];
    return Array.isArray(value) ? value[0] : value;
  }

  private matches(provided: string, expected: string) {
    const providedBuffer = Buffer.from(provided);
    const expectedBuffer = Buffer.from(expected);
    return (
      providedBuffer.length === expectedBuffer.length &&
      timingSafeEqual(providedBuffer, expectedBuffer)
    );
  }
}
