import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type {
  ConsoleIdentityContext,
  ConsoleRequest,
} from '../security/console-identity-context';
import { ConsolePermissionGuard } from '../security/console-permission.guard';
import { ConsolePermissions } from '../security/console-permissions.decorator';
import { ConsoleAuditService } from './console-audit.service';
import { ListConsoleAuditEventsDto } from './dto/list-console-audit-events.dto';

@ApiTags('console-audit')
@Controller('console-api/v1/audit-events')
@UseGuards(ConsolePermissionGuard)
export class ConsoleAuditController {
  constructor(private readonly audit: ConsoleAuditService) {}

  @Get()
  @ConsolePermissions('audit:read')
  @ApiOkResponse({ description: '원문을 제외한 조직 범위 활동·보안 감사 목록' })
  list(
    @Query() query: ListConsoleAuditEventsDto,
    @Req() request: ConsoleRequest,
  ) {
    return this.audit.list(this.identity(request), query);
  }

  private identity(request: ConsoleRequest): ConsoleIdentityContext {
    return request.consoleIdentity as ConsoleIdentityContext;
  }
}
