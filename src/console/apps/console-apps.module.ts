import { Module } from '@nestjs/common';
import { AppInfoModule } from '../../app-info/app-info.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { ConsoleSecurityModule } from '../security/console-security.module';
import { ConsoleAppsController } from './console-apps.controller';
import { ConsoleAppsService } from './console-apps.service';
import { ConsoleCredentialsService } from './console-credentials.service';

@Module({
  imports: [PrismaModule, AppInfoModule, ConsoleSecurityModule],
  controllers: [ConsoleAppsController],
  providers: [ConsoleAppsService, ConsoleCredentialsService],
})
export class ConsoleAppsModule {}
