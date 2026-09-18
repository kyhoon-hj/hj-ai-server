import { Module } from '@nestjs/common';
import { AppInfoModule } from '../app-info/app-info.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AppkeyGuard } from '../common/guards/appkey.guard';
import { FamilyKnowledgeModule } from '../family-knowledge/family-knowledge.module';
import { ConversationController } from './conversation.controller';
import { ConversationService } from './conversation.service';
import { UsageQuotaModule } from '../usage-quota/usage-quota.module';

@Module({
  imports: [
    AppInfoModule,
    FamilyKnowledgeModule,
    PrismaModule,
    UsageQuotaModule,
  ],
  controllers: [ConversationController],
  providers: [ConversationService, AppkeyGuard],
})
export class ConversationModule {}
