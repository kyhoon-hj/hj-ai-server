import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type {
  ConsoleIdentityContext,
  ConsoleRequest,
} from '../security/console-identity-context';
import { ConsolePermissionGuard } from '../security/console-permission.guard';
import { ConsolePermissions } from '../security/console-permissions.decorator';
import { ConsoleUsageService } from './console-usage.service';
import { ConsoleUsageRangeDto } from './dto/console-usage-range.dto';

@ApiTags('console-usage')
@Controller('console-api/v1/usage')
@UseGuards(ConsolePermissionGuard)
export class ConsoleUsageController {
  constructor(private readonly usage: ConsoleUsageService) {}

  @Get('monthly')
  @ConsolePermissions('usage:read')
  @ApiOkResponse({ description: 'UTC 이번 달 사용량·예약·한도·잔여량' })
  monthly(@Req() request: ConsoleRequest) {
    return this.usage.monthly(this.identity(request));
  }

  @Get('summary')
  @ConsolePermissions('usage:read')
  @ApiOkResponse({ description: '조직 범위 사용량 합계와 측정 상태' })
  summary(
    @Query() query: ConsoleUsageRangeDto,
    @Req() request: ConsoleRequest,
  ) {
    return this.usage.summary(this.identity(request), query.days, query);
  }

  @Get('timeseries')
  @ConsolePermissions('usage:read')
  @ApiOkResponse({ description: '조직 범위 UTC 일별 사용량' })
  timeseries(
    @Query() query: ConsoleUsageRangeDto,
    @Req() request: ConsoleRequest,
  ) {
    return this.usage.timeseries(this.identity(request), query.days, query);
  }

  @Get('breakdown')
  @ConsolePermissions('usage:read')
  @ApiOkResponse({ description: '조직 소유 앱별 사용량' })
  breakdown(
    @Query() query: ConsoleUsageRangeDto,
    @Req() request: ConsoleRequest,
  ) {
    return this.usage.breakdown(this.identity(request), query.days, query);
  }

  private identity(request: ConsoleRequest): ConsoleIdentityContext {
    return request.consoleIdentity as ConsoleIdentityContext;
  }
}
