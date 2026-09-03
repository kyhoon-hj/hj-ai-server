import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { AdminApiKeyGuard } from '../common/guards/admin-api-key.guard';
import { AdminRoles } from '../common/guards/admin-roles.decorator';
import { BedrockService } from './bedrock.service';
import type { AbortableRequest } from '../common/http/request-abort.middleware';

@ApiTags('admin-bedrock')
@UseGuards(AdminApiKeyGuard)
@AdminRoles('platform-admin')
@ApiSecurity('adminKey')
@ApiHeader({
  name: 'x-admin-key',
  description: '플랫폼 관리자 credential입니다.',
  required: true,
})
@Controller('admin/v1/bedrock')
export class BedrockAdminController {
  constructor(private readonly bedrockService: BedrockService) {}

  @Get('config')
  @ApiOperation({
    summary: 'Bedrock 연동 설정의 비밀값 존재 여부를 조회합니다.',
  })
  getConfig() {
    return this.bedrockService.getConfig();
  }

  @Get('models')
  @ApiOperation({
    summary: 'AWS 계정과 리전에서 조회 가능한 모델을 확인합니다.',
  })
  listFoundationModels(@Req() request: AbortableRequest) {
    return this.bedrockService.listFoundationModels(request.abortSignal);
  }
}
