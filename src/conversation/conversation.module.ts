import { Module } from '@nestjs/common';
import { AppInfoModule } from '../app-info/app-info.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AppkeyGuard } from '../common/guards/appkey.guard';
import { ConversationController } from './conversation.controller';
import { ConversationService } from './conversation.service';

@Module({
  imports: [AppInfoModule, PrismaModule],
  controllers: [ConversationController],
  providers: [ConversationService, AppkeyGuard],
})
export class ConversationModule {}
