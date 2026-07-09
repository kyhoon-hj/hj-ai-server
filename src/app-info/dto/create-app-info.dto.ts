import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class CreateAppInfoDto {
  @ApiProperty({ example: 'External CRM' })
  @IsString()
  @IsNotEmpty()
  appname: string;

  @ApiProperty({ example: 'external-crm' })
  @IsString()
  @IsNotEmpty()
  appcode: string;

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
