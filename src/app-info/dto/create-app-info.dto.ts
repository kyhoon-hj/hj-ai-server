import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import {
  KNOWLEDGE_ACCESS_LEVELS,
  type KnowledgeAccessLevelValue,
} from '../../knowledge/dto/knowledge-policy.dto';

export class CreateAppInfoDto {
  @ApiProperty({ example: 'External CRM' })
  @IsString()
  @IsNotEmpty()
  appname: string;

  @ApiProperty({ example: 'external-crm' })
  @IsString()
  @IsNotEmpty()
  appcode: string;

  @ApiPropertyOptional({
    enum: KNOWLEDGE_ACCESS_LEVELS,
    isArray: true,
    example: ['PUBLIC'],
    description:
      '비어 있으면 기존 소비자와 같이 access level 제한을 적용하지 않습니다.',
  })
  @IsArray()
  @ArrayMaxSize(3)
  @IsEnum(KNOWLEDGE_ACCESS_LEVELS, { each: true })
  @IsOptional()
  allowedAccessLevels?: KnowledgeAccessLevelValue[];

  @ApiPropertyOptional({ example: 'CRM integration app' })
  @IsString()
  @IsOptional()
  remark?: string;

  @ApiPropertyOptional({ example: 'active', enum: ['active', 'inactive'] })
  @IsIn(['active', 'inactive'])
  @IsOptional()
  status?: string;

  @ApiPropertyOptional({ example: 'external-crm/knowledge' })
  @IsString()
  @IsOptional()
  s3Prefix?: string;

  @ApiPropertyOptional({ example: 'us.anthropic.claude-sonnet-4-6' })
  @IsString()
  @IsOptional()
  defaultModelId?: string;

  @ApiPropertyOptional({ example: 'amazon.titan-embed-text-v2:0' })
  @IsString()
  @IsOptional()
  defaultEmbeddingModelId?: string;

  @ApiPropertyOptional({
    example: '제공된 자료에 근거해서만 한국어로 답변하세요.',
  })
  @IsString()
  @IsOptional()
  systemPrompt?: string;

  @ApiPropertyOptional({ example: 1024, minimum: 1, maximum: 1048576 })
  @IsInt()
  @Min(1)
  @Max(1048576)
  @IsOptional()
  maxStorageMb?: number;

  @ApiPropertyOptional({ example: 1000000, minimum: 1 })
  @IsInt()
  @Min(1)
  @IsOptional()
  monthlyTokenLimit?: number;

  @ApiPropertyOptional({
    example: { industry: 'retail', owner: 'demo-team' },
  })
  @IsObject()
  @IsOptional()
  metadata?: Record<string, unknown>;
}
