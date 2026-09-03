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
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiHeader,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { AppInfoService } from '../app-info/app-info.service';
import { AdminApiKeyGuard } from '../common/guards/admin-api-key.guard';
import { AdminRoles } from '../common/guards/admin-roles.decorator';
import { CreateKnowledgeTextDto } from './dto/create-knowledge-text.dto';
import { UpdateKnowledgeFilePolicyDto } from './dto/knowledge-policy.dto';
import { KnowledgeService } from './knowledge.service';
import { KnowledgeIndexJobService } from './knowledge-index-job.service';
import type { AbortableRequest } from '../common/http/request-abort.middleware';

@ApiTags('admin-knowledge')
@UseGuards(AdminApiKeyGuard)
@AdminRoles('platform-admin', 'knowledge-operator')
@ApiSecurity('adminKey')
@ApiHeader({
  name: 'x-admin-key',
  description: '플랫폼 관리자 또는 지식 운영자 credential입니다.',
  required: true,
})
@Controller('admin/v1/knowledge/apps/:appId')
export class KnowledgeAdminController {
  constructor(
    private readonly appInfoService: AppInfoService,
    private readonly knowledgeService: KnowledgeService,
    private readonly knowledgeIndexJobService: KnowledgeIndexJobService,
  ) {}

  @Post('files')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({ summary: '대상 앱의 지식 파일을 업로드합니다.' })
  async uploadKnowledgeFile(
    @Param('appId', ParseUUIDPipe) appId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() request: AbortableRequest,
  ) {
    if (!file) throw new BadRequestException('업로드할 file이 필요합니다.');
    const appInfo = await this.appInfoService.findOne(appId);
    return this.knowledgeService.uploadKnowledgeFile(
      file,
      appInfo,
      request.abortSignal,
    );
  }

  @Get('files')
  @ApiOperation({ summary: '대상 앱의 지식 파일 목록을 조회합니다.' })
  async listKnowledgeFiles(
    @Param('appId', ParseUUIDPipe) appId: string,
    @Query('includeArchived', new DefaultValuePipe(false), ParseBoolPipe)
    includeArchived: boolean,
  ) {
    const appInfo = await this.appInfoService.findOne(appId);
    return this.knowledgeService.listKnowledgeFiles(appInfo.appcode, {
      includeArchived,
    });
  }

  @Get('files/:id')
  @ApiOperation({ summary: '대상 앱의 지식 파일을 조회합니다.' })
  async getKnowledgeFile(
    @Param('appId', ParseUUIDPipe) appId: string,
    @Param('id') id: string,
  ) {
    const appInfo = await this.appInfoService.findOne(appId);
    return this.knowledgeService.getKnowledgeFile(id, appInfo.appcode);
  }

  @Patch('files/:id/policy')
  @ApiOperation({ summary: '대상 앱의 지식 정책을 변경합니다.' })
  async updateKnowledgeFilePolicy(
    @Param('appId', ParseUUIDPipe) appId: string,
    @Param('id') id: string,
    @Body() dto: UpdateKnowledgeFilePolicyDto,
  ) {
    const appInfo = await this.appInfoService.findOne(appId);
    return this.knowledgeService.updateKnowledgeFilePolicy(
      id,
      appInfo.appcode,
      dto,
    );
  }

  @Delete('files/:id')
  @ApiOperation({ summary: '대상 앱의 지식 파일을 보관 처리합니다.' })
  async deleteKnowledgeFile(
    @Param('appId', ParseUUIDPipe) appId: string,
    @Param('id') id: string,
    @Query('deleteObject', new DefaultValuePipe(false), ParseBoolPipe)
    deleteObject: boolean,
    @Req() request: AbortableRequest,
  ) {
    const appInfo = await this.appInfoService.findOne(appId);
    return this.knowledgeService.deleteKnowledgeFile(
      id,
      appInfo.appcode,
      { deleteObject },
      request.abortSignal,
    );
  }

  @Post('texts')
  @ApiOperation({ summary: '대상 앱에 텍스트 지식을 등록·인덱싱합니다.' })
  async createKnowledgeText(
    @Param('appId', ParseUUIDPipe) appId: string,
    @Body() dto: CreateKnowledgeTextDto,
    @Req() request: AbortableRequest,
  ) {
    const appInfo = await this.appInfoService.findOne(appId);
    return this.knowledgeService.createKnowledgeText(
      dto,
      appInfo,
      request.abortSignal,
    );
  }

  @Post('files/:id/index')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '대상 앱의 지식 파일을 인덱싱합니다.' })
  async indexKnowledgeFile(
    @Param('appId', ParseUUIDPipe) appId: string,
    @Param('id') id: string,
    @Req() request: AbortableRequest,
  ) {
    const appInfo = await this.appInfoService.findOne(appId);
    return this.knowledgeService.indexKnowledgeFile(
      id,
      appInfo,
      request.abortSignal,
    );
  }

  @Post('files/:id/reindex')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '대상 앱의 지식 파일을 재인덱싱합니다.' })
  async reindexKnowledgeFile(
    @Param('appId', ParseUUIDPipe) appId: string,
    @Param('id') id: string,
    @Req() request: AbortableRequest,
  ) {
    const appInfo = await this.appInfoService.findOne(appId);
    return this.knowledgeService.indexKnowledgeFile(
      id,
      appInfo,
      request.abortSignal,
    );
  }

  @Post('files/:id/index-jobs')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: '대상 파일의 비동기 인덱싱 작업을 제출합니다.' })
  async submitIndexJob(
    @Param('appId', ParseUUIDPipe) appId: string,
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const appInfo = await this.appInfoService.findOne(appId);
    return this.knowledgeIndexJobService.submit(
      id,
      appInfo.appcode,
      'index',
      idempotencyKey,
    );
  }

  @Post('files/:id/reindex-jobs')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: '대상 파일의 비동기 재인덱싱 작업을 제출합니다.' })
  async submitReindexJob(
    @Param('appId', ParseUUIDPipe) appId: string,
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const appInfo = await this.appInfoService.findOne(appId);
    return this.knowledgeIndexJobService.submit(
      id,
      appInfo.appcode,
      'reindex',
      idempotencyKey,
    );
  }

  @Get('index-jobs/:jobId')
  @ApiOperation({ summary: '비동기 인덱싱 작업 상태를 조회합니다.' })
  async getIndexJob(
    @Param('appId', ParseUUIDPipe) appId: string,
    @Param('jobId', ParseUUIDPipe) jobId: string,
  ) {
    const appInfo = await this.appInfoService.findOne(appId);
    return this.knowledgeIndexJobService.get(jobId, appInfo.appcode);
  }

  @Post('index-jobs/:jobId/retry')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: '실패한 비동기 인덱싱 작업을 재시도합니다.' })
  async retryIndexJob(
    @Param('appId', ParseUUIDPipe) appId: string,
    @Param('jobId', ParseUUIDPipe) jobId: string,
  ) {
    const appInfo = await this.appInfoService.findOne(appId);
    return this.knowledgeIndexJobService.retry(jobId, appInfo.appcode);
  }
}
