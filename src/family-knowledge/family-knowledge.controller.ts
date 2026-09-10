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
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { AppkeyGuard, type AppkeyRequest } from '../common/guards/appkey.guard';
import {
  FamilyKnowledgeEventDto,
  FamilyKnowledgeEventResponseDto,
} from './dto/family-knowledge-event.dto';
import {
  FamilyKnowledgeSearchDto,
  FamilyKnowledgeSearchResponseDto,
} from './dto/family-knowledge-search.dto';
import { FamilyKnowledgeAccessGuard } from './family-knowledge-access.guard';
import { FamilyKnowledgeSearchService } from './family-knowledge-search.service';
import { FamilyKnowledgeService } from './family-knowledge.service';

@ApiTags('family-knowledge')
@ApiSecurity('appkey')
@ApiHeader({ name: 'appkey', required: true })
@Controller('family-knowledge')
@UseGuards(AppkeyGuard, FamilyKnowledgeAccessGuard)
export class FamilyKnowledgeController {
  constructor(
    private readonly familyKnowledge: FamilyKnowledgeService,
    private readonly familySearch: FamilyKnowledgeSearchService,
  ) {}

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

  @Post('search')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '인증된 FAMILY 범위의 지식 근거를 검색합니다.' })
  @ApiOkResponse({ type: FamilyKnowledgeSearchResponseDto })
  search(@Body() dto: FamilyKnowledgeSearchDto, @Req() request: AppkeyRequest) {
    return this.familySearch.search(dto, request.appInfo!, request.abortSignal);
  }
}
