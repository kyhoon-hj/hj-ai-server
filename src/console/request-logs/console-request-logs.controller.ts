import {
  Controller,
  Get,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type {
  ConsoleIdentityContext,
  ConsoleRequest,
} from '../security/console-identity-context';
import { ConsolePermissionGuard } from '../security/console-permission.guard';
import { ConsolePermissions } from '../security/console-permissions.decorator';
import { ConsoleRequestLogsService } from './console-request-logs.service';
import { ExportConsoleRequestLogsDto } from './dto/export-console-request-logs.dto';
import { ListConsoleRequestLogsDto } from './dto/list-console-request-logs.dto';

@ApiTags('console-request-logs')
@Controller('console-api/v1/request-logs')
@UseGuards(ConsolePermissionGuard)
export class ConsoleRequestLogsController {
  constructor(private readonly requestLogs: ConsoleRequestLogsService) {}

  @Get()
  @ConsolePermissions('logs:read')
  @ApiOkResponse({ description: '조직 범위 요청 로그 목록' })
  list(
    @Query() query: ListConsoleRequestLogsDto,
    @Req() request: ConsoleRequest,
  ) {
    return this.requestLogs.list(this.identity(request), query);
  }

  @Get('export.csv')
  @ConsolePermissions('logs:read')
  @ApiOkResponse({ description: '원문을 제외한 조직 범위 요청 로그 CSV' })
  async exportCsv(
    @Query() query: ExportConsoleRequestLogsDto,
    @Req() request: ConsoleRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.requestLogs.exportCsv(
      this.identity(request),
      query,
    );
    response.type('text/csv; charset=utf-8');
    response.attachment(
      `hj-ai-request-logs-${new Date().toISOString().slice(0, 10)}.csv`,
    );
    response.setHeader('x-export-row-count', String(result.rowCount));
    response.setHeader('x-export-truncated', String(result.truncated));
    return result.csv;
  }

  @Get(':logId')
  @ConsolePermissions('logs:read')
  @ApiOkResponse({ description: '원문을 제외한 요청 로그 상세' })
  findOne(@Param('logId') logId: string, @Req() request: ConsoleRequest) {
    return this.requestLogs.findOne(logId, this.identity(request));
  }

  private identity(request: ConsoleRequest): ConsoleIdentityContext {
    return request.consoleIdentity as ConsoleIdentityContext;
  }
}
