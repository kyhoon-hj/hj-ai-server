import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class KnowledgeRetrievalEntity {
  @ApiProperty()
  count!: number;

  @ApiProperty()
  limit!: number;

  @ApiPropertyOptional({ nullable: true })
  scoreThreshold!: number | null;

  @ApiProperty({ description: '호출자가 전달한 검증된 보조 근거 수' })
  supplementalCount!: number;
}

class KnowledgeSourceEntity {
  @ApiProperty()
  index!: number;

  @ApiProperty()
  chunkId!: string;

  @ApiProperty()
  fileId!: string;

  @ApiProperty()
  fileName!: string;

  @ApiProperty()
  key!: string;

  @ApiProperty()
  score!: number;

  @ApiPropertyOptional({ nullable: true, type: Object })
  metadata!: Record<string, unknown> | null;

  @ApiPropertyOptional()
  content?: string;

  @ApiPropertyOptional({
    enum: ['KNOWLEDGE_DOCUMENT', 'SUPPORT_BOARD_APPROVED_ANSWER'],
  })
  sourceType?: 'KNOWLEDGE_DOCUMENT' | 'SUPPORT_BOARD_APPROVED_ANSWER';
}

export class KnowledgeAnswerEntity {
  @ApiProperty()
  query!: string;

  @ApiProperty()
  answer!: string;

  @ApiProperty({ description: '기존 소비자를 위한 answer 호환 alias' })
  response!: string;

  @ApiProperty({
    description:
      '모델의 근거 기반 답변 가능 판단과 출력/출처 검증 결과입니다. 사실 정확도를 보증하거나 신뢰도 점수를 의미하지 않습니다.',
  })
  answerable!: boolean;

  @ApiProperty({
    enum: [
      'answered',
      'insufficient_evidence',
      'invalid_model_response',
      'incomplete_model_response',
    ],
  })
  answerStatus!: string;

  @ApiProperty()
  promptVersion!: string;

  @ApiProperty({ type: String, nullable: true })
  stopReason!: string | null;

  @ApiProperty()
  modelId!: string;

  @ApiProperty()
  embeddingModel!: string;

  @ApiProperty({ type: KnowledgeRetrievalEntity })
  retrieval!: KnowledgeRetrievalEntity;

  @ApiPropertyOptional({ nullable: true, type: Object })
  usage!: Record<string, unknown> | null;

  @ApiProperty()
  latencyMs!: number;

  @ApiPropertyOptional({
    description: '요청의 x-correlation-id와 같은 추적 ID',
  })
  requestId?: string;

  @ApiPropertyOptional({
    type: [KnowledgeSourceEntity],
    description:
      '실제 답변에 사용한 출처만 반환합니다. 답변 불가 시 빈 배열입니다. index는 검색 시 부여된 번호를 유지합니다.',
  })
  sources?: KnowledgeSourceEntity[];
}
