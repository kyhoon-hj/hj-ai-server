import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class KnowledgeRagResponseDto {
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
}
