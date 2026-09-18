import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ConsoleSecurityModule } from '../security/console-security.module';
import { ConsoleRequestLogsController } from './console-request-logs.controller';
import { ConsoleRequestLogsService } from './console-request-logs.service';

@Module({
  imports: [PrismaModule, ConsoleSecurityModule],
  controllers: [ConsoleRequestLogsController],
  providers: [ConsoleRequestLogsService],
})
export class ConsoleRequestLogsModule {}
