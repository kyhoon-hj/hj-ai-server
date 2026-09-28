import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ConsoleSecurityModule } from '../security/console-security.module';
import { ConsoleAuditController } from './console-audit.controller';
import { ConsoleAuditService } from './console-audit.service';

@Module({
  imports: [PrismaModule, ConsoleSecurityModule],
  controllers: [ConsoleAuditController],
  providers: [ConsoleAuditService],
})
export class ConsoleAuditModule {}
