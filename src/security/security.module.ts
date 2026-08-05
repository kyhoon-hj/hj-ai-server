import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SecurityAuditService } from './security-audit.service';
import { SecurityAuditController } from './security-audit.controller';
import { AdminApiKeyGuard } from '../common/guards/admin-api-key.guard';

@Global()
@Module({
  imports: [PrismaModule],
  controllers: [SecurityAuditController],
  providers: [SecurityAuditService, AdminApiKeyGuard],
  exports: [SecurityAuditService],
})
export class SecurityModule {}
