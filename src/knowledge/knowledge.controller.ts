import {
  BadRequestException,
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  Param,
  ParseBoolPipe,
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
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { AppkeyGuard, type AppkeyRequest } from '../common/guards/appkey.guard';
import { KnowledgeAnswerEntity } from './entities/knowledge-answer.entity';
import { KnowledgeRagResponseDto } from './dto/knowledge-rag-response.dto';
import { KnowledgeSearchDto } from './dto/knowledge-search.dto';
import { CreateKnowledgeTextDto } from './dto/create-knowledge-text.dto';
import { KnowledgeFileEntity } from './entities/knowledge-file.entity';
import { UpdateKnowledgeFilePolicyDto } from './dto/knowledge-policy.dto';
import { KnowledgeService } from './knowledge.service';

@ApiTags('knowledge')
@UseGuards(AppkeyGuard)
@ApiSecurity('appkey')
@ApiHeader({
  name: 'appkey',
  description: 'app-info API에서 발급된 appkey입니다.',
  required: true,
})
@ApiHeader({
  name: 'x-correlation-id',
  description: '선택 UUID. 생략하면 서버가 생성하고 응답 header에 반환합니다.',
  required: false,
})
@Controller('knowledge')
export class KnowledgeController {
  constructor(private readonly knowledgeService: KnowledgeService) {}

  @Post('files')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
    }),
  )
  @ApiOperation({
    summary: 'RAG 검색에 사용할 파일을 S3에 업로드하고 DB에 등록합니다.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @ApiOkResponse({ type: KnowledgeFileEntity })
  uploadKnowledgeFile(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() request: AppkeyRequest,
  ) {
    if (!file) {
      throw new BadRequestException('업로드할 file이 필요합니다.');
    }

    return this.knowledgeService.uploadKnowledgeFile(file, request.appInfo!);
  }

  @Get('files')
  @ApiOperation({ summary: '등록된 RAG 지식 파일 목록을 조회합니다.' })
  listKnowledgeFiles(
    @Req() request: AppkeyRequest,
    @Query('includeArchived', new DefaultValuePipe(false), ParseBoolPipe)
    includeArchived: boolean,
  ) {
    return this.knowledgeService.listKnowledgeFiles(request.appInfo!.appcode, {
      includeArchived,
    });
  }

  @Get('files/:id')
  @ApiOperation({ summary: '등록된 RAG 지식 파일 상세 정보를 조회합니다.' })
  @ApiOkResponse({ type: KnowledgeFileEntity })
  getKnowledgeFile(@Param('id') id: string, @Req() request: AppkeyRequest) {
    return this.knowledgeService.getKnowledgeFile(id, request.appInfo!.appcode);
  }

  @Patch('files/:id/policy')
  @ApiOperation({
    summary: '지식 파일의 공개 범위, 게시 상태와 적용 기간을 변경합니다.',
  })
  @ApiOkResponse({ type: KnowledgeFileEntity })
  updateKnowledgeFilePolicy(
    @Param('id') id: string,
    @Body() dto: UpdateKnowledgeFilePolicyDto,
    @Req() request: AppkeyRequest,
  ) {
    return this.knowledgeService.updateKnowledgeFilePolicy(
      id,
      request.appInfo!.appcode,
      dto,
    );
  }

  @Delete('files/:id')
  @ApiOperation({
    summary:
      'RAG 지식 파일을 보관 처리하고 chunk를 삭제합니다. deleteObject=true면 S3 원본도 삭제합니다.',
  })
  deleteKnowledgeFile(
    @Param('id') id: string,
    @Req() request: AppkeyRequest,
    @Query('deleteObject', new DefaultValuePipe(false), ParseBoolPipe)
    deleteObject: boolean,
  ) {
    return this.knowledgeService.deleteKnowledgeFile(
      id,
      request.appInfo!.appcode,
      { deleteObject },
    );
  }

  @Post('texts')
  @ApiOperation({
    summary: '텍스트를 직접 RAG 지식 문서로 등록하고 인덱싱합니다.',
  })
  createKnowledgeText(
    @Body() dto: CreateKnowledgeTextDto,
    @Req() request: AppkeyRequest,
  ) {
    return this.knowledgeService.createKnowledgeText(dto, request.appInfo!);
  }

  @Post('demo/store-seed')
  @ApiOperation({
    summary: '가상 생활용품 매장 안내 데모 데이터를 RAG 지식으로 적재합니다.',
  })
  seedDemoStoreKnowledge(@Req() request: AppkeyRequest) {
    return this.knowledgeService.seedDemoStoreKnowledge(request.appInfo!);
  }

  @Post('files/:id/index')
  @ApiOperation({
    summary: 'S3 파일 내용을 추출해 chunk와 embedding을 생성합니다.',
  })
  indexKnowledgeFile(@Param('id') id: string, @Req() request: AppkeyRequest) {
    return this.knowledgeService.indexKnowledgeFile(id, request.appInfo!);
  }

  @Post('files/:id/reindex')
  @ApiOperation({
    summary: '등록된 지식 파일을 다시 인덱싱합니다.',
  })
  reindexKnowledgeFile(@Param('id') id: string, @Req() request: AppkeyRequest) {
    return this.knowledgeService.indexKnowledgeFile(id, request.appInfo!);
  }

  @Post('search')
  @ApiOperation({ summary: '질문과 관련 있는 지식 chunk를 검색합니다.' })
  searchKnowledge(
    @Body() dto: KnowledgeSearchDto,
    @Req() request: AppkeyRequest,
  ) {
    return this.knowledgeService.search(dto, request.appInfo!);
  }

  @Post('rag-response')
  @ApiOperation({
    summary: '검색된 지식 chunk를 근거로 Bedrock 답변을 생성합니다.',
  })
  createRagResponse(
    @Body() dto: KnowledgeRagResponseDto,
    @Req() request: AppkeyRequest,
  ) {
    return this.knowledgeService.createRagResponse(
      dto,
      request.appInfo!,
      request.correlationId,
    );
  }

  @Post('answers')
  @ApiOperation({
    summary:
      '제품용 RAG Answer API입니다. 검색, 답변 생성, 출처, 사용량 정보를 함께 반환합니다.',
  })
  @ApiOkResponse({ type: KnowledgeAnswerEntity })
  createAnswer(
    @Body() dto: KnowledgeRagResponseDto,
    @Req() request: AppkeyRequest,
  ) {
    return this.knowledgeService.createRagResponse(
      dto,
      request.appInfo!,
      request.correlationId,
    );
  }
}
