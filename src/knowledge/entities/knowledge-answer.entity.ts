import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { readAwsAttempts } from '../../common/aws/aws-attempts';
import { JEV_INQUIRY_CATEGORIES } from '../../jev/jev-inquiry-policy';

class ClassificationUsageEntity {
  @ApiProperty({ type: 'integer', minimum: 0 })
  inputTokens!: number;
  @ApiProperty({ type: 'integer', minimum: 0 })
  outputTokens!: number;
}

class ClassificationBillingEntity {
  @ApiProperty({ type: Number, minimum: 0, nullable: true })
  creditsCharged!: number | null;
  @ApiProperty({ type: Number, minimum: 0, nullable: true })
  paidInputTokensUsed!: number | null;
}

export class KnowledgeClassificationEntity {
  @ApiProperty({ enum: ['classified', 'unavailable', 'skipped'] })
  status!: string;
  @ApiProperty({
    type: String,
    enum: Object.keys(JEV_INQUIRY_CATEGORIES),
    nullable: true,
  })
  category!: string | null;
  @ApiProperty({
    type: String,
    enum: Object.keys(JEV_INQUIRY_CATEGORIES),
    nullable: true,
  })
  appliedCategory!: string | null;
  @ApiProperty()
  applied!: boolean;
  @ApiProperty({
    type: Number,
    minimum: 0,
    maximum: 1,
    nullable: true,
    description: '분류 confidence이며 답변 정확도가 아닙니다.',
  })
  confidence!: number | null;
  @ApiProperty({ type: Number, minimum: 0, maximum: 1, nullable: true })
  selectedProbability!: number | null;
  @ApiProperty({ type: Number, minimum: 0, maximum: 1, nullable: true })
  minimumConfidence!: number | null;
  @ApiProperty({ type: String, nullable: true })
  policyVersion!: string | null;
  @ApiProperty({ type: Number, minimum: 0, nullable: true })
  durationMs!: number | null;
  @ApiProperty({
    type: String,
    enum: [
      'low_confidence',
      'classification_unavailable',
      'not_enabled_for_request',
      'request_cancelled',
    ],
    nullable: true,
  })
  reason!: string | null;
  @ApiProperty({
    type: String,
    enum: ['CLASSIFICATION_UNAVAILABLE', 'CLASSIFICATION_INVALID_RESPONSE'],
    nullable: true,
  })
  errorCode!: string | null;
  @ApiProperty({ enum: ['succeeded', 'not_sent', 'failed', 'unknown'] })
  outcome!: string;
  @ApiProperty({ type: ClassificationUsageEntity, nullable: true })
  usage!: ClassificationUsageEntity | null;
  @ApiProperty({ type: ClassificationBillingEntity })
  billing!: ClassificationBillingEntity;
}

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

class KnowledgePerformanceEntity {
  @ApiProperty({ description: '질문 embedding과 지식 검색에 걸린 시간(ms)' })
  retrievalMs!: number;

  @ApiProperty({
    description:
      '생성 요청의 대기·SDK 재시도를 포함한 시간(ms). 모델 미호출 시 0.',
  })
  generationMs!: number;

  @ApiProperty({
    description:
      '서버가 적용한 생성 maxTokens 설정. 실제 사용 토큰 수와 다릅니다.',
  })
  maxTokens!: number;
}

export class KnowledgeAnswerEntity {
  @ApiPropertyOptional({
    type: KnowledgeClassificationEntity,
    description: 'includeClassification=true인 200 응답에 포함됩니다.',
  })
  classification?: KnowledgeClassificationEntity;
  @ApiPropertyOptional({
    type: Object,
    description: '생성 호출의 SDK 시도·재시도·재시도 지연. 누락 측정은 null.',
  })
  sdk?: ReturnType<typeof readAwsAttempts> & { scope: string };

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

  @ApiPropertyOptional({ type: KnowledgePerformanceEntity })
  performance?: KnowledgePerformanceEntity;

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
