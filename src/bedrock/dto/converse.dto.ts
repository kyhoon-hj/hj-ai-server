import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class ConverseDto {
  @ApiPropertyOptional({
    example: 'anthropic.claude-3-5-sonnet-20240620-v1:0',
    description:
      '요청별로 사용할 Bedrock model ID입니다. 없으면 BEDROCK_MODEL_ID를 사용합니다.',
  })
  @IsString()
  @IsOptional()
  modelId?: string;

  @ApiProperty({
    example: 'NestJS에서 AWS Bedrock을 연동하는 방법을 요약해줘.',
  })
  @IsString()
  @IsNotEmpty()
  message!: string;

  @ApiPropertyOptional({ example: 'You are a concise Korean assistant.' })
  @IsString()
  @IsOptional()
  system?: string;

  @ApiPropertyOptional({ example: 1024, minimum: 1, maximum: 8192 })
  @IsInt()
  @Min(1)
  @Max(8192)
  @IsOptional()
  maxTokens?: number;

  @ApiPropertyOptional({ example: 0.7, minimum: 0, maximum: 1 })
  @Min(0)
  @Max(1)
  @IsOptional()
  temperature?: number;

  @ApiPropertyOptional({ example: { userId: 'demo-user' } })
  @IsObject()
  @IsOptional()
  metadata?: Record<string, unknown>;
}
