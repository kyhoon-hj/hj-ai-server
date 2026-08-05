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
      '검색 source 존재 여부입니다. 답변의 사실 정확도나 신뢰도 점수가 아닙니다.',
  })
  answerable!: boolean;

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

  @ApiPropertyOptional({ type: [KnowledgeSourceEntity] })
  sources?: KnowledgeSourceEntity[];
}
