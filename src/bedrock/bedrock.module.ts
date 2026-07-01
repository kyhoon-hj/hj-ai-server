import { Module } from '@nestjs/common';
import { AppInfoModule } from '../app-info/app-info.module';
import { PrismaModule } from '../prisma/prisma.module';
import { BedrockController } from './bedrock.controller';
import { BedrockService } from './bedrock.service';
import { AppkeyGuard } from './guards/appkey.guard';

@Module({
  imports: [AppInfoModule, PrismaModule],
  controllers: [BedrockController],
  providers: [BedrockService, AppkeyGuard],
})
export class BedrockModule {}
