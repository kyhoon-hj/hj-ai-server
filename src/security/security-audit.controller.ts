import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { AdminApiKeyGuard } from '../common/guards/admin-api-key.guard';
import { AdminRoles } from '../common/guards/admin-roles.decorator';
import { SecurityAuditQueryDto } from './dto/security-audit-query.dto';
import { SecurityAuditService } from './security-audit.service';

@ApiTags('admin-security')
@UseGuards(AdminApiKeyGuard)
@AdminRoles('platform-admin')
@ApiSecurity('adminKey')
@ApiHeader({
  name: 'x-admin-key',
  description: '플랫폼 관리자 credential입니다.',
  required: true,
})
@Controller('admin/v1/security')
export class SecurityAuditController {
  constructor(private readonly securityAudit: SecurityAuditService) {}

  @Get('audit-events')
  @ApiOperation({
    summary: 'credential 수명주기와 관리자 접근 감사 이벤트를 조회합니다.',
  })
  list(@Query() query: SecurityAuditQueryDto) {
    return this.securityAudit.list(query);
  }
}
