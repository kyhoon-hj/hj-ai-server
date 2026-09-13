import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { ConsoleAppsService } from './console-apps.service';
import { CreateConsoleAppDto } from './dto/create-console-app.dto';
import { UpdateConsoleAppDto } from './dto/update-console-app.dto';
import { ConsoleAppEntity } from './entities/console-app.entity';
import type {
  ConsoleIdentityContext,
  ConsoleRequest,
} from '../security/console-identity-context';
import { ConsolePermissionGuard } from '../security/console-permission.guard';
import { ConsolePermissions } from '../security/console-permissions.decorator';
import { ConsoleCredentialsService } from './console-credentials.service';
import { IssueConsoleCredentialDto } from './dto/issue-console-credential.dto';
import { RotateAppKeyDto } from '../../app-info/dto/rotate-appkey.dto';
import {
  ConsoleCredentialIssuedEntity,
  ConsoleCredentialRevokedEntity,
  ConsoleCredentialSummaryEntity,
} from './entities/console-credential.entity';

@ApiTags('console-apps')
@Controller('console-api/v1/apps')
@UseGuards(ConsolePermissionGuard)
export class ConsoleAppsController {
  constructor(
    private readonly apps: ConsoleAppsService,
    private readonly credentials: ConsoleCredentialsService,
  ) {}

  @Get()
  @ConsolePermissions('apps:read')
  @ApiOkResponse({ type: ConsoleAppEntity, isArray: true })
  list(@Req() request: ConsoleRequest) {
    return this.apps.list(this.identity(request));
  }

  @Post()
  @ConsolePermissions('apps:write')
  @ApiCreatedResponse({ type: ConsoleAppEntity })
  create(@Body() dto: CreateConsoleAppDto, @Req() request: ConsoleRequest) {
    return this.apps.create(dto, this.identity(request), request.correlationId);
  }

  @Get(':id')
  @ConsolePermissions('apps:read')
  @ApiOkResponse({ type: ConsoleAppEntity })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: ConsoleRequest,
  ) {
    return this.apps.findOne(id, this.identity(request));
  }

  @Patch(':id')
  @ConsolePermissions('apps:write')
  @ApiOkResponse({ type: ConsoleAppEntity })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateConsoleAppDto,
    @Req() request: ConsoleRequest,
  ) {
    return this.apps.update(
      id,
      dto,
      this.identity(request),
      request.correlationId,
    );
  }

  @Get(':id/credentials')
  @ConsolePermissions('credentials:read')
  @ApiOkResponse({ type: ConsoleCredentialSummaryEntity, isArray: true })
  listCredentials(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: ConsoleRequest,
  ) {
    return this.credentials.list(id, this.identity(request));
  }

  @Post(':id/credentials')
  @ConsolePermissions('credentials:rotate')
  @ApiCreatedResponse({ type: ConsoleCredentialIssuedEntity })
  issueCredential(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: IssueConsoleCredentialDto,
    @Req() request: ConsoleRequest,
  ) {
    return this.credentials.issue(
      id,
      dto,
      this.identity(request),
      request.correlationId,
    );
  }

  @Post(':id/credentials/rotate')
  @ConsolePermissions('credentials:rotate')
  @ApiCreatedResponse({ type: ConsoleCredentialIssuedEntity })
  rotateCredential(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RotateAppKeyDto,
    @Req() request: ConsoleRequest,
  ) {
    return this.credentials.rotate(
      id,
      dto,
      this.identity(request),
      request.correlationId,
    );
  }

  @Delete(':id/credentials/:credentialId')
  @ConsolePermissions('credentials:revoke')
  @ApiOkResponse({ type: ConsoleCredentialRevokedEntity })
  revokeCredential(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('credentialId', ParseUUIDPipe) credentialId: string,
    @Req() request: ConsoleRequest,
  ) {
    return this.credentials.revoke(
      id,
      credentialId,
      this.identity(request),
      request.correlationId,
    );
  }

  private identity(request: ConsoleRequest): ConsoleIdentityContext {
    return request.consoleIdentity as ConsoleIdentityContext;
  }
}
