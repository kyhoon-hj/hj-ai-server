import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiSecurity, ApiTags } from '@nestjs/swagger';
import {
  AdminApiKeyGuard,
  type AdminRequest,
} from '../common/guards/admin-api-key.guard';
import { AdminRoles } from '../common/guards/admin-roles.decorator';
import { UsageQuotaRecoveryService } from './usage-quota-recovery.service';
import {
  ReconcileUsageReservationDto,
  UsageReservationQueryDto,
} from './usage-quota-recovery.dto';

@ApiTags('admin-usage-quota')
@ApiSecurity('adminKey')
@AdminRoles('platform-admin')
@UseGuards(AdminApiKeyGuard)
@Controller('admin/v1/usage-quota/reservations')
export class UsageQuotaAdminController {
  constructor(private readonly recovery: UsageQuotaRecoveryService) {}

  @Get()
  list(@Query() query: UsageReservationQueryDto) {
    return this.recovery.list(query);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.recovery.get(id);
  }

  @Post(':id/reconcile')
  @HttpCode(200)
  reconcile(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: ReconcileUsageReservationDto,
    @Req() request: AdminRequest,
  ) {
    return this.recovery.reconcile(id, input, {
      credentialSlot: request.admin!.credentialSlot,
      requestId: request.correlationId,
    });
  }
}
