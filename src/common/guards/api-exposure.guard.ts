import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import {
  API_EXPOSURE_POLICIES,
  API_EXPOSURE_POLICY_KEY,
  type ApiExposurePolicy,
} from './api-exposure.decorator';

@Injectable()
export class ApiExposureGuard implements CanActivate {
  constructor(
    private readonly configService: ConfigService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext) {
    const policy = this.reflector.getAllAndOverride<ApiExposurePolicy>(
      API_EXPOSURE_POLICY_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!policy) return true;

    const environmentKey = API_EXPOSURE_POLICIES[policy];
    const enabled =
      this.configService.get<string>(environmentKey)?.trim().toLowerCase() ===
      'true';

    if (!enabled) {
      throw new NotFoundException('요청한 API 경로를 찾을 수 없습니다.');
    }

    return true;
  }
}
