import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { KnowledgeFiltersContainerDto } from './knowledge-policy.dto';

export class SupplementalKnowledgeSourceDto {
  @ApiProperty({ enum: ['SUPPORT_BOARD_APPROVED_ANSWER'] })
  @IsIn(['SUPPORT_BOARD_APPROVED_ANSWER'])
  sourceType!: 'SUPPORT_BOARD_APPROVED_ANSWER';

  @ApiProperty({ description: '호출 시스템에서 발급한 불변 출처 ID' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  sourceId!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @ApiProperty({ description: '사람이 검토해 공개한 최종 답변만 허용합니다.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  content!: string;

  @ApiProperty()
  @IsISO8601()
  publishedAt!: string;

  @ApiProperty({ minimum: 0, maximum: 1 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  relevanceScore!: number;

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(40)
  @IsOptional()
  productCode?: string;
}

export class KnowledgeRagResponseDto extends KnowledgeFiltersContainerDto {
  @ApiProperty({
    example: '등록된 자료 기준으로 S3 RAG 검색 기능을 어떻게 사용하나요?',
  })
  @IsString()
  @IsNotEmpty()
  query!: string;

  @ApiPropertyOptional({ example: 5, minimum: 1, maximum: 20 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  @IsOptional()
  limit?: number;

  @ApiPropertyOptional({
    example: 0.35,
    minimum: -1,
    maximum: 1,
    description: '답변 근거로 사용할 최소 유사도 점수입니다.',
  })
  @Type(() => Number)
  @IsNumber()
  @Min(-1)
  @Max(1)
  @IsOptional()
  scoreThreshold?: number;

  @ApiPropertyOptional({
    example: 'us.anthropic.claude-sonnet-4-6',
  })
  @IsString()
  @IsOptional()
  modelId?: string;

  @ApiPropertyOptional({
    example: '답변은 짧게 작성하고, 확인되지 않는 내용은 추측하지 마세요.',
  })
  @IsString()
  @IsOptional()
  system?: string;

  @ApiPropertyOptional({
    enum: ['concise', 'detailed', 'report'],
    example: 'concise',
    description: '답변 길이와 형식에 대한 기본 스타일입니다.',
  })
  @IsEnum(['concise', 'detailed', 'report'])
  @IsOptional()
  answerStyle?: 'concise' | 'detailed' | 'report';

  @ApiPropertyOptional({
    example: true,
    description: 'true면 검색 근거를 응답에 포함합니다.',
  })
  @Type(() => Boolean)
  @IsBoolean()
  @IsOptional()
  includeSources?: boolean;

  @ApiPropertyOptional({
    example: false,
    description:
      'true면 sources에 chunk content 일부를 포함합니다. 운영 API에서는 기본 false를 권장합니다.',
  })
  @Type(() => Boolean)
  @IsBoolean()
  @IsOptional()
  includeSourceContent?: boolean;

  @ApiPropertyOptional({
    example: true,
    description:
      'true면 검색 근거가 없을 때 모델을 호출하지 않고 noAnswerMessage를 반환합니다.',
  })
  @Type(() => Boolean)
  @IsBoolean()
  @IsOptional()
  strict?: boolean;

  @ApiPropertyOptional({
    example: '등록된 자료에서 확인할 수 없습니다.',
  })
  @IsString()
  @IsOptional()
  noAnswerMessage?: string;

  @ApiPropertyOptional({ example: 1024, minimum: 1, maximum: 8192 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(8192)
  @IsOptional()
  maxTokens?: number;

  @ApiPropertyOptional({ example: 0.2, minimum: 0, maximum: 1 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  @IsOptional()
  temperature?: number;

  @ApiPropertyOptional({
    type: [SupplementalKnowledgeSourceDto],
    maxItems: 5,
    description:
      '인증된 호출 시스템이 제공하는 보조 근거입니다. 현재는 공개된 고객지원 게시판 최종 답변만 허용합니다.',
  })
  @IsArray()
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => SupplementalKnowledgeSourceDto)
  @IsOptional()
  supplementalSources?: SupplementalKnowledgeSourceDto[];
}
