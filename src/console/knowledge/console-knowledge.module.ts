import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { KnowledgeModule } from '../../knowledge/knowledge.module';
import { createKnowledgeUploadOptions } from '../../knowledge/knowledge-file-security';
import { PrismaModule } from '../../prisma/prisma.module';
import { ConsoleSecurityModule } from '../security/console-security.module';
import { ConsoleKnowledgeController } from './console-knowledge.controller';
import { ConsoleKnowledgeSummaryController } from './console-knowledge-summary.controller';
import { ConsoleKnowledgeService } from './console-knowledge.service';

@Module({
  imports: [
    PrismaModule,
    KnowledgeModule,
    ConsoleSecurityModule,
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        createKnowledgeUploadOptions(
          config.get<string>('KNOWLEDGE_MAX_FILE_SIZE_MB'),
        ),
    }),
  ],
  controllers: [ConsoleKnowledgeController, ConsoleKnowledgeSummaryController],
  providers: [ConsoleKnowledgeService],
})
export class ConsoleKnowledgeModule {}
