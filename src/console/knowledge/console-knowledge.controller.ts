import {
  BadRequestException,
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseBoolPipe,
  ParseUUIDPipe,
  Post,
  Patch,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import type { AbortableRequest } from '../../common/http/request-abort.middleware';
import { UpdateKnowledgeFilePolicyDto } from '../../knowledge/dto/knowledge-policy.dto';
import type {
  ConsoleIdentityContext,
  ConsoleRequest,
} from '../security/console-identity-context';
import { ConsolePermissionGuard } from '../security/console-permission.guard';
import { ConsolePermissions } from '../security/console-permissions.decorator';
import { ConsoleKnowledgeService } from './console-knowledge.service';

@ApiTags('console-knowledge')
@Controller('console-api/v1/apps/:appId/knowledge')
@UseGuards(ConsolePermissionGuard)
export class ConsoleKnowledgeController {
  constructor(private readonly knowledge: ConsoleKnowledgeService) {}

  @Post('files')
  @UseInterceptors(FileInterceptor('file'))
  @ConsolePermissions('knowledge:write')
  uploadFile(
    @Param('appId', ParseUUIDPipe) appId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() request: ConsoleRequest & AbortableRequest,
  ) {
    if (!file) throw new BadRequestException('업로드할 file이 필요합니다.');
    return this.knowledge.uploadFile(
      appId,
      file,
      request.consoleIdentity as ConsoleIdentityContext,
      request.abortSignal,
    );
  }

  @Get('files')
  @ConsolePermissions('knowledge:read')
  listFiles(
    @Param('appId', ParseUUIDPipe) appId: string,
    @Query('includeArchived', new DefaultValuePipe(false), ParseBoolPipe)
    includeArchived: boolean,
    @Req() request: ConsoleRequest,
  ) {
    return this.knowledge.listFiles(
      appId,
      request.consoleIdentity as ConsoleIdentityContext,
      includeArchived,
    );
  }

  @Get('files/:fileId')
  @ConsolePermissions('knowledge:read')
  getFile(
    @Param('appId', ParseUUIDPipe) appId: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Req() request: ConsoleRequest,
  ) {
    return this.knowledge.getFile(
      appId,
      fileId,
      request.consoleIdentity as ConsoleIdentityContext,
    );
  }

  @Patch('files/:fileId/policy')
  @ConsolePermissions('knowledge:write')
  updatePolicy(
    @Param('appId', ParseUUIDPipe) appId: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Body() dto: UpdateKnowledgeFilePolicyDto,
    @Req() request: ConsoleRequest,
  ) {
    return this.knowledge.updatePolicy(
      appId,
      fileId,
      dto,
      request.consoleIdentity as ConsoleIdentityContext,
      request.correlationId,
    );
  }

  @Delete('files/:fileId')
  @ConsolePermissions('knowledge:write')
  archiveFile(
    @Param('appId', ParseUUIDPipe) appId: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Query('deleteObject', new DefaultValuePipe(false), ParseBoolPipe)
    deleteObject: boolean,
    @Req() request: ConsoleRequest & AbortableRequest,
  ) {
    return this.knowledge.archiveFile(
      appId,
      fileId,
      request.consoleIdentity as ConsoleIdentityContext,
      deleteObject,
      request.correlationId,
      request.abortSignal,
    );
  }

  @Post('files/:fileId/object-cleanup/retry')
  @ConsolePermissions('knowledge:write')
  retryObjectCleanup(
    @Param('appId', ParseUUIDPipe) appId: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Req() request: ConsoleRequest & AbortableRequest,
  ) {
    return this.knowledge.retryObjectCleanup(
      appId,
      fileId,
      request.consoleIdentity as ConsoleIdentityContext,
      request.correlationId,
      request.abortSignal,
    );
  }

  @Post('files/:fileId/index-jobs')
  @HttpCode(HttpStatus.ACCEPTED)
  @ConsolePermissions('knowledge:write')
  submitIndexJob(
    @Param('appId', ParseUUIDPipe) appId: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: ConsoleRequest,
  ) {
    return this.knowledge.submitIndexJob(
      appId,
      fileId,
      request.consoleIdentity as ConsoleIdentityContext,
      idempotencyKey,
    );
  }

  @Post('files/:fileId/reindex-jobs')
  @HttpCode(HttpStatus.ACCEPTED)
  @ConsolePermissions('knowledge:write')
  submitReindexJob(
    @Param('appId', ParseUUIDPipe) appId: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: ConsoleRequest,
  ) {
    return this.knowledge.submitReindexJob(
      appId,
      fileId,
      request.consoleIdentity as ConsoleIdentityContext,
      idempotencyKey,
    );
  }

  @Get('files/:fileId/index-jobs')
  @ConsolePermissions('knowledge:read')
  listIndexJobs(
    @Param('appId', ParseUUIDPipe) appId: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Req() request: ConsoleRequest,
  ) {
    return this.knowledge.listIndexJobs(
      appId,
      fileId,
      request.consoleIdentity as ConsoleIdentityContext,
    );
  }

  @Get('index-jobs/:jobId')
  @ConsolePermissions('knowledge:read')
  getIndexJob(
    @Param('appId', ParseUUIDPipe) appId: string,
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Req() request: ConsoleRequest,
  ) {
    return this.knowledge.getIndexJob(
      appId,
      jobId,
      request.consoleIdentity as ConsoleIdentityContext,
    );
  }

  @Post('index-jobs/:jobId/retry')
  @HttpCode(HttpStatus.ACCEPTED)
  @ConsolePermissions('knowledge:write')
  retryIndexJob(
    @Param('appId', ParseUUIDPipe) appId: string,
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Req() request: ConsoleRequest,
  ) {
    return this.knowledge.retryIndexJob(
      appId,
      jobId,
      request.consoleIdentity as ConsoleIdentityContext,
    );
  }
}
