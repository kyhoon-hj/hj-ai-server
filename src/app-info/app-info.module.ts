import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AppInfoController } from './app-info.controller';
import { AppInfoService } from './app-info.service';
import { AdminApiKeyGuard } from '../common/guards/admin-api-key.guard';

@Module({
  imports: [PrismaModule],
  controllers: [AppInfoController],
  providers: [AppInfoService, AdminApiKeyGuard],
  exports: [AppInfoService],
})
export class AppInfoModule {}
