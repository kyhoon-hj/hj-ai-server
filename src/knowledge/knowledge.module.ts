import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { AppInfoModule } from '../app-info/app-info.module';
import { AppkeyGuard } from '../common/guards/appkey.guard';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { ChunkingService } from './chunking.service';
import { DocumentParserService } from './document-parser.service';
import { EmbeddingService } from './embedding.service';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeAdminController } from './knowledge-admin.controller';
import { AdminApiKeyGuard } from '../common/guards/admin-api-key.guard';
import { KnowledgeService } from './knowledge.service';
import { ApiExposureGuard } from '../common/guards/api-exposure.guard';
import { createKnowledgeUploadOptions } from './knowledge-file-security';
import { KnowledgeIndexJobService } from './knowledge-index-job.service';

@Module({
  imports: [
    AppInfoModule,
    PrismaModule,
    StorageModule,
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
        createKnowledgeUploadOptions(
          configService.get<string>('KNOWLEDGE_MAX_FILE_SIZE_MB'),
        ),
    }),
  ],
  controllers: [KnowledgeController, KnowledgeAdminController],
  providers: [
    KnowledgeService,
    KnowledgeIndexJobService,
    DocumentParserService,
    ChunkingService,
    EmbeddingService,
    AppkeyGuard,
    AdminApiKeyGuard,
    ApiExposureGuard,
  ],
})
export class KnowledgeModule {}
