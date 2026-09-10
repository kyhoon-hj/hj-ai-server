import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class GeneralAnswerEntity {
  @ApiProperty({
    required: false,
    type: Object,
    description: '생성 호출의 SDK 시도 횟수와 재시도 지연',
  })
  sdk?: {
    scope: string;
    attempts: number | null;
    retryCount: number | null;
    totalRetryDelayMs: number | null;
  };

  @ApiProperty()
  query!: string;

  @ApiProperty()
  answer!: string;

  @ApiProperty({ description: '기존 response 명칭 소비자를 위한 alias' })
  response!: string;

  @ApiProperty()
  generalAnswerEligible!: boolean;

  @ApiProperty()
  reviewRecommended!: boolean;

  @ApiProperty({ type: [String] })
  reviewReasons!: string[];

  @ApiProperty()
  modelId!: string;

  @ApiProperty()
  promptVersion!: string;

  @ApiPropertyOptional({ nullable: true, type: Object })
  usage!: Record<string, unknown> | null;

  @ApiProperty()
  latencyMs!: number;

  @ApiPropertyOptional()
  requestId?: string;
}
