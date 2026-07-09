import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { AppInfoService } from '../../app-info/app-info.service';

export type AppkeyRequest = Request & {
  appInfo?: {
    id: string;
    appcode: string;
    status: string;
    s3Prefix: string | null;
    defaultModelId: string | null;
    defaultEmbeddingModelId: string | null;
    systemPrompt: string | null;
    maxStorageMb: number | null;
    monthlyTokenLimit: number | null;
    metadata: unknown;
  };
};

@Injectable()
export class AppkeyGuard implements CanActivate {
  constructor(private readonly appInfoService: AppInfoService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AppkeyRequest>();
    const appkey = this.extractAppKey(request);
    const appInfo = appkey
      ? await this.appInfoService.validateAppKey(appkey)
      : null;

    if (!appInfo) {
      throw new UnauthorizedException('유효한 appkey가 필요합니다.');
    }

    if (appInfo.status !== 'active') {
      throw new ForbiddenException('비활성화된 appkey입니다.');
    }

    request.appInfo = appInfo;

    return true;
  }

  private extractAppKey(request: Request) {
    const headerValue =
      request.headers.appkey ??
      request.headers['x-app-key'] ??
      request.headers['x-appkey'];

    if (Array.isArray(headerValue)) {
      return headerValue[0];
    }

    return headerValue;
  }
}
