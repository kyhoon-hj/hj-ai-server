import { AdminApiKeyGuard } from '../common/guards/admin-api-key.guard';
import { UsageQuotaAdminController } from './usage-quota-admin.controller';
import { UsageQuotaRecoveryService } from './usage-quota-recovery.service';
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { UsageQuotaService } from './usage-quota.service';

@Module({
  imports: [PrismaModule],
  controllers: [UsageQuotaAdminController],
  providers: [UsageQuotaService, UsageQuotaRecoveryService, AdminApiKeyGuard],
  exports: [UsageQuotaService],
})
export class UsageQuotaModule {}
