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
import { SecurityAuditService } from '../../security/security-audit.service';

export type AdminRequest = CorrelatedRequest & {
  admin?: { role: AdminRole; credentialSlot: 'primary' | 'previous' };
};

type ResolvedAdminCredential = {
  role: AdminRole;
  credentialSlot: 'primary' | 'previous';
};

@Injectable()
export class AdminApiKeyGuard implements CanActivate {
  constructor(
    private readonly configService: ConfigService,
    private readonly reflector: Reflector,
    private readonly securityAudit: SecurityAuditService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AdminRequest>();
    const provided = this.extractHeader(request);
    const resolved = provided ? this.resolveCredential(provided) : null;

    if (!resolved) {
      await this.recordAccess(request, 'ADMIN_AUTHENTICATION_FAILED');
      throw new UnauthorizedException('유효한 관리자 credential이 필요합니다.');
    }

    const allowedRoles = this.reflector.getAllAndOverride<AdminRole[]>(
      ADMIN_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    ) ?? ['platform-admin'];

    if (!allowedRoles.includes(resolved.role)) {
      await this.recordAccess(request, 'ADMIN_AUTHORIZATION_DENIED', resolved);
      throw new ForbiddenException('이 관리자 역할에는 접근 권한이 없습니다.');
    }

    request.admin = resolved;
    await this.recordAccess(request, 'ADMIN_API_ACCESSED', resolved);
    return true;
  }

  private resolveCredential(provided: string): ResolvedAdminCredential | null {
    const credentials: Array<
      [AdminRole, 'primary' | 'previous', string | undefined, boolean]
    > = [
      ['platform-admin', 'primary', this.value('ADMIN_API_KEY'), true],
      [
        'platform-admin',
        'previous',
        this.value('ADMIN_API_KEY_PREVIOUS'),
        this.isPreviousCredentialActive('ADMIN_API_KEY_PREVIOUS_VALID_UNTIL'),
      ],
      [
        'knowledge-operator',
        'primary',
        this.value('KNOWLEDGE_OPERATOR_API_KEY'),
        true,
      ],
      [
        'knowledge-operator',
        'previous',
        this.value('KNOWLEDGE_OPERATOR_API_KEY_PREVIOUS'),
        this.isPreviousCredentialActive(
          'KNOWLEDGE_OPERATOR_API_KEY_PREVIOUS_VALID_UNTIL',
        ),
      ],
    ];
    const match = credentials.find(
      ([, , expected, active]) =>
        active && expected && this.matches(provided, expected),
    );
    return match ? { role: match[0], credentialSlot: match[1] } : null;
  }

  private value(key: string) {
    return this.configService.get<string>(key)?.trim();
  }

  private isPreviousCredentialActive(validUntilKey: string) {
    const value = this.value(validUntilKey);
    if (!value) return false;
    const validUntil = Date.parse(value);
    return Number.isFinite(validUntil) && validUntil > Date.now();
  }

  private async recordAccess(
    request: AdminRequest,
    eventType: string,
    credential?: ResolvedAdminCredential,
  ) {
    await this.securityAudit.record({
      eventType,
      actorType: credential?.role ?? 'system',
      actorId: credential?.role,
      credentialSlot: credential?.credentialSlot,
      requestId: request.correlationId,
      method: request.method,
      path: request.path,
    });
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
