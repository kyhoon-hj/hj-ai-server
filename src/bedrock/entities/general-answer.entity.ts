import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class GeneralAnswerEntity {
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
