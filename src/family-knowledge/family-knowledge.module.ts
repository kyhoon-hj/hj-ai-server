import { Module } from '@nestjs/common';
import { AppInfoModule } from '../app-info/app-info.module';
import { AppkeyGuard } from '../common/guards/appkey.guard';
import { PrismaModule } from '../prisma/prisma.module';
import { FamilyKnowledgeAccessGuard } from './family-knowledge-access.guard';
import { FamilyKnowledgeController } from './family-knowledge.controller';
import { FamilyKnowledgeService } from './family-knowledge.service';

@Module({
  imports: [AppInfoModule, PrismaModule],
  controllers: [FamilyKnowledgeController],
  providers: [FamilyKnowledgeService, FamilyKnowledgeAccessGuard, AppkeyGuard],
  exports: [FamilyKnowledgeService],
})
export class FamilyKnowledgeModule {}
