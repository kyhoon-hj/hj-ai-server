import { Module } from '@nestjs/common';
import { AppInfoModule } from '../app-info/app-info.module';
import { AppkeyGuard } from '../common/guards/appkey.guard';
import { StorageController } from './storage.controller';
import { StorageService } from './storage.service';

@Module({
  imports: [AppInfoModule],
  controllers: [StorageController],
  providers: [StorageService, AppkeyGuard],
  exports: [StorageService],
})
export class StorageModule {}
