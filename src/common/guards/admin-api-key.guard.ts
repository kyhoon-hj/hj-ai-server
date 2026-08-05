import { timingSafeEqual } from 'node:crypto';
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CorrelatedRequest } from '../http/correlation-id.middleware';

export type AdminRequest = CorrelatedRequest & {
  admin?: { role: 'platform-admin' };
};

@Injectable()
export class AdminApiKeyGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AdminRequest>();
    const provided = this.extractHeader(request);
    const expected = this.configService.get<string>('ADMIN_API_KEY')?.trim();

    if (!provided || !expected || !this.matches(provided, expected)) {
      throw new UnauthorizedException('유효한 관리자 credential이 필요합니다.');
    }

    request.admin = { role: 'platform-admin' };
    return true;
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
