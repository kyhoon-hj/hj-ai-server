import { Module } from '@nestjs/common';
import { AppInfoModule } from '../app-info/app-info.module';
import { AppkeyGuard } from '../common/guards/appkey.guard';
import { PrismaModule } from '../prisma/prisma.module';
import { BedrockController } from './bedrock.controller';
import { BedrockAdminController } from './bedrock-admin.controller';
import { BedrockService } from './bedrock.service';
import { AdminApiKeyGuard } from '../common/guards/admin-api-key.guard';
import { ApiExposureGuard } from '../common/guards/api-exposure.guard';

@Module({
  imports: [AppInfoModule, PrismaModule],
  controllers: [BedrockController, BedrockAdminController],
  providers: [BedrockService, AppkeyGuard, AdminApiKeyGuard, ApiExposureGuard],
})
export class BedrockModule {}
