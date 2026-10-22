import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type {
  ConsoleIdentityContext,
  ConsoleRequest,
} from '../security/console-identity-context';
import { ConsolePermissionGuard } from '../security/console-permission.guard';
import { ConsolePermissions } from '../security/console-permissions.decorator';
import { ConsoleKnowledgeService } from './console-knowledge.service';

@ApiTags('console-knowledge')
@Controller('console-api/v1/knowledge')
@UseGuards(ConsolePermissionGuard)
export class ConsoleKnowledgeSummaryController {
  constructor(private readonly knowledge: ConsoleKnowledgeService) {}

  @Get('index-failures')
  @ConsolePermissions('knowledge:read')
  indexFailures(@Req() request: ConsoleRequest) {
    return this.knowledge.indexFailures(
      request.consoleIdentity as ConsoleIdentityContext,
    );
  }
}
