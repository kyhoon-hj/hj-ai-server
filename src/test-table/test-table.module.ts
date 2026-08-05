import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { TestTableController } from './test-table.controller';
import { TestTableService } from './test-table.service';
import { AdminApiKeyGuard } from '../common/guards/admin-api-key.guard';
import { ApiExposureGuard } from '../common/guards/api-exposure.guard';

@Module({
  imports: [PrismaModule],
  controllers: [TestTableController],
  providers: [TestTableService, AdminApiKeyGuard, ApiExposureGuard],
})
export class TestTableModule {}
