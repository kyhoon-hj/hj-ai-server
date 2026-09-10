import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiHeader,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { AppkeyGuard, type AppkeyRequest } from '../common/guards/appkey.guard';
import {
  FamilyKnowledgeEventDto,
  FamilyKnowledgeEventResponseDto,
} from './dto/family-knowledge-event.dto';
import { FamilyKnowledgeAccessGuard } from './family-knowledge-access.guard';
import { FamilyKnowledgeService } from './family-knowledge.service';

@ApiTags('family-knowledge')
@ApiSecurity('appkey')
@ApiHeader({ name: 'appkey', required: true })
@Controller('family-knowledge')
@UseGuards(AppkeyGuard, FamilyKnowledgeAccessGuard)
export class FamilyKnowledgeController {
  constructor(private readonly familyKnowledge: FamilyKnowledgeService) {}

  @Post('events')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: '인증된 Family 지식 변경 이벤트를 수신합니다.' })
  @ApiAcceptedResponse({ type: FamilyKnowledgeEventResponseDto })
  receiveEvent(
    @Body() dto: FamilyKnowledgeEventDto,
    @Req() request: AppkeyRequest,
  ) {
    return this.familyKnowledge.receiveEvent(dto, request.appInfo!.appcode);
  }
}
