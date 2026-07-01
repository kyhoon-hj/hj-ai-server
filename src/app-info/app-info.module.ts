import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AppInfoController } from './app-info.controller';
import { AppInfoService } from './app-info.service';

@Module({
  imports: [PrismaModule],
  controllers: [AppInfoController],
  providers: [AppInfoService],
  exports: [AppInfoService],
})
export class AppInfoModule {}
