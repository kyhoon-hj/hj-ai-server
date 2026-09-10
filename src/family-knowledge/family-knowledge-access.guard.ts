import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppkeyRequest } from '../common/guards/appkey.guard';

@Injectable()
export class FamilyKnowledgeAccessGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext) {
    const enabled =
      this.config
        .get<string>('FRAME_FAMILY_RAG_ENABLED')
        ?.trim()
        .toLowerCase() === 'true';
    if (!enabled) {
      throw new NotFoundException('요청한 API 경로를 찾을 수 없습니다.');
    }

    const allowed = (this.config.get<string>('FRAME_FAMILY_RAG_APPCODES') ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    const request = context.switchToHttp().getRequest<AppkeyRequest>();
    if (!request.appInfo || !allowed.includes(request.appInfo.appcode)) {
      throw new ForbiddenException('FAMILY_KNOWLEDGE_NOT_ALLOWED');
    }

    return true;
  }
}
