import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BedrockService } from './bedrock.service';
import { ConverseDto } from './dto/converse.dto';
import { TextResponseDto } from './dto/text-response.dto';

@ApiTags('bedrock')
@Controller('bedrock')
export class BedrockController {
  constructor(private readonly bedrockService: BedrockService) {}

  @Get('config')
  @ApiOperation({ summary: '현재 Bedrock 연동 설정을 확인합니다.' })
  @ApiOkResponse({
    schema: {
      example: {
        region: 'us-east-1',
        defaultModelId: 'anthropic.claude-3-5-sonnet-20240620-v1:0',
        hasAccessKeyId: true,
        hasSecretAccessKey: true,
        hasSessionToken: false,
        hasBearerToken: false,
      },
    },
  })
  getConfig() {
    return this.bedrockService.getConfig();
  }

  @Get('models')
  @ApiOperation({
    summary:
      '현재 AWS 계정/리전에서 조회 가능한 Bedrock 모델 목록을 확인합니다.',
  })
  listFoundationModels() {
    return this.bedrockService.listFoundationModels();
  }

  @Post('converse')
  @ApiOperation({
    summary: 'Amazon Bedrock Converse API로 텍스트 응답을 생성합니다.',
  })
  converse(@Body() dto: ConverseDto) {
    return this.bedrockService.converse(dto);
  }

  @Post('text-response')
  @ApiOperation({
    summary: '설정된 Bedrock 모델에 message만 전달해 텍스트 응답을 생성합니다.',
  })
  @ApiOkResponse({
    schema: {
      example: {
        response:
          'AWS Bedrock은 다양한 파운데이션 모델을 호출할 수 있는 관리형 서비스입니다.',
      },
    },
  })
  createTextResponse(@Body() dto: TextResponseDto) {
    return this.bedrockService.createTextResponse(dto);
  }
}
