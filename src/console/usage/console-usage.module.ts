import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ConsoleSecurityModule } from '../security/console-security.module';
import { ConsoleUsageController } from './console-usage.controller';
import { ConsoleUsageService } from './console-usage.service';

@Module({
  imports: [PrismaModule, ConsoleSecurityModule],
  controllers: [ConsoleUsageController],
  providers: [ConsoleUsageService],
})
export class ConsoleUsageModule {}
