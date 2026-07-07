import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Query,
  Req,
  Res,
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
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { AppkeyGuard, type AppkeyRequest } from '../common/guards/appkey.guard';
import { StorageService } from './storage.service';

@ApiTags('storage')
@UseGuards(AppkeyGuard)
@ApiHeader({
  name: 'appkey',
  description: 'app-info API에서 발급된 appkey입니다.',
  required: true,
})
@Controller('storage')
export class StorageController {
  constructor(private readonly storageService: StorageService) {}

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
    }),
  )
  @ApiOperation({
    summary: 'appkey의 appcode 경로로 파일을 S3에 업로드합니다.',
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
  uploadFile(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() request: AppkeyRequest,
  ) {
    if (!file) {
      throw new BadRequestException('업로드할 file이 필요합니다.');
    }

    return this.storageService.uploadFile(file, request.appInfo!.appcode);
  }

  @Get('files')
  @ApiOperation({
    summary: 'appkey의 appcode 경로에 있는 S3 파일 목록을 조회합니다.',
  })
  @ApiQuery({
    name: 'prefix',
    required: false,
    description: 'appcode 이후의 하위 경로입니다. 예: 2026/07/02',
  })
  @ApiQuery({
    name: 'maxKeys',
    required: false,
    description: '조회할 최대 파일 수입니다. 기본값 100, 최대 1000.',
  })
  @ApiQuery({
    name: 'continuationToken',
    required: false,
    description: '다음 페이지 조회용 토큰입니다.',
  })
  listFiles(
    @Req() request: AppkeyRequest,
    @Query('prefix') prefix?: string,
    @Query('maxKeys') maxKeys?: string,
    @Query('continuationToken') continuationToken?: string,
  ) {
    return this.storageService.listFiles(request.appInfo!.appcode, {
      prefix,
      maxKeys: maxKeys ? Number(maxKeys) : undefined,
      continuationToken,
    });
  }

  @Get('files/detail')
  @ApiOperation({
    summary: 'appkey의 appcode 경로에 있는 S3 파일 정보를 조회합니다.',
  })
  @ApiQuery({
    name: 'key',
    required: true,
    description: '조회할 S3 object key입니다.',
  })
  getFileInfo(@Req() request: AppkeyRequest, @Query('key') key?: string) {
    if (!key) {
      throw new BadRequestException('조회할 key가 필요합니다.');
    }

    return this.storageService.getFileInfo(key, request.appInfo!.appcode);
  }

  @Get('download')
  @ApiOperation({
    summary: 'appkey의 appcode 경로에 있는 S3 파일을 다운로드합니다.',
  })
  @ApiQuery({
    name: 'key',
    required: true,
    description: '다운로드할 S3 object key입니다.',
  })
  async downloadFile(
    @Req() request: AppkeyRequest,
    @Query('key') key: string | undefined,
    @Res() response: Response,
  ) {
    if (!key) {
      throw new BadRequestException('다운로드할 key가 필요합니다.');
    }

    const file = await this.storageService.downloadFile(
      key,
      request.appInfo!.appcode,
    );

    response.setHeader('Content-Type', file.contentType);
    response.setHeader('Content-Length', file.contentLength);
    response.setHeader('Content-Disposition', file.contentDisposition);
    response.send(file.body);
  }
}
