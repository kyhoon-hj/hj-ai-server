import { Module } from '@nestjs/common';
import { AppInfoModule } from '../app-info/app-info.module';
import { AppkeyGuard } from '../common/guards/appkey.guard';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { ChunkingService } from './chunking.service';
import { DocumentParserService } from './document-parser.service';
import { EmbeddingService } from './embedding.service';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeService } from './knowledge.service';

@Module({
  imports: [AppInfoModule, PrismaModule, StorageModule],
  controllers: [KnowledgeController],
  providers: [
    KnowledgeService,
    DocumentParserService,
    ChunkingService,
    EmbeddingService,
    AppkeyGuard,
  ],
})
export class KnowledgeModule {}
