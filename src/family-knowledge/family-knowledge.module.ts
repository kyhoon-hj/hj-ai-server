import { Module } from '@nestjs/common';
import { AppInfoModule } from '../app-info/app-info.module';
import { AppkeyGuard } from '../common/guards/appkey.guard';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { PrismaModule } from '../prisma/prisma.module';
import { FamilyKnowledgeAccessGuard } from './family-knowledge-access.guard';
import { FamilyEmbeddingUsageService } from './family-embedding-usage.service';
import { FamilyKnowledgeController } from './family-knowledge.controller';
import { FamilyKnowledgeIndexJobService } from './family-knowledge-index-job.service';
import { FamilyKnowledgeIndexService } from './family-knowledge-index.service';
import { FamilyKnowledgeSearchService } from './family-knowledge-search.service';
import { FamilyKnowledgeService } from './family-knowledge.service';

@Module({
  imports: [AppInfoModule, KnowledgeModule, PrismaModule],
  controllers: [FamilyKnowledgeController],
  providers: [
    FamilyKnowledgeService,
    FamilyEmbeddingUsageService,
    FamilyKnowledgeAccessGuard,
    FamilyKnowledgeIndexService,
    FamilyKnowledgeIndexJobService,
    FamilyKnowledgeSearchService,
    AppkeyGuard,
  ],
  exports: [FamilyKnowledgeService, FamilyKnowledgeSearchService],
})
export class FamilyKnowledgeModule {}
