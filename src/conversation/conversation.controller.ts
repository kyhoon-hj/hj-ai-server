import {
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AppkeyGuard, type AppkeyRequest } from '../common/guards/appkey.guard';
import { ConversationTurnDto } from './conversation.dto';
import { ConversationService } from './conversation.service';

@ApiTags('conversation')
@ApiHeader({
  name: 'appkey',
  required: true,
  description: 'Frame capability가 허용된 서버 전용 키',
})
@Controller('conversation/v1')
@UseGuards(AppkeyGuard)
export class ConversationController {
  constructor(private readonly conversation: ConversationService) {}
  @Post('turns')
  @HttpCode(200)
  @ApiOperation({
    summary: '가족 공용 텍스트 대화. 모델·정책은 서버 고정, 본문 비기록.',
  })
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: [
        'text',
        'finishReason',
        'usage',
        'latencyMs',
        'requestId',
        'policyVersion',
      ],
      properties: {
        text: { type: 'string' },
        finishReason: {
          type: 'string',
          enum: [
            'end_turn',
            'stop_sequence',
            'max_tokens',
            'guardrail_intervened',
            'content_filtered',
          ],
        },
        usage: {
          type: 'object',
          nullable: true,
          properties: {
            inputTokens: { type: 'integer' },
            outputTokens: { type: 'integer' },
            totalTokens: { type: 'integer' },
          },
        },
        latencyMs: { type: 'integer' },
        requestId: { type: 'string', format: 'uuid' },
        policyVersion: {
          type: 'string',
          enum: ['frame-family-v1', 'frame-family-v2', 'frame-family-rag-v1'],
        },
      },
    },
  })
  turn(@Body() dto: ConversationTurnDto, @Req() request: AppkeyRequest) {
    return this.conversation.turn(dto, request.appInfo!, request.abortSignal);
  }
}
