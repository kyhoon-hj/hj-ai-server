import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export const KNOWLEDGE_ACCESS_LEVELS = [
  'PUBLIC',
  'INTERNAL',
  'RESTRICTED',
] as const;

export const KNOWLEDGE_BUSINESS_STATUSES = [
  'DRAFT',
  'PUBLISHED',
  'RETIRED',
] as const;

export type KnowledgeAccessLevelValue =
  (typeof KNOWLEDGE_ACCESS_LEVELS)[number];
export type KnowledgeBusinessStatusValue =
  (typeof KNOWLEDGE_BUSINESS_STATUSES)[number];

export class KnowledgeSearchFiltersDto {
  @ApiPropertyOptional({
    enum: KNOWLEDGE_ACCESS_LEVELS,
    isArray: true,
    example: ['PUBLIC'],
  })
  @IsArray()
  @ArrayMaxSize(3)
  @IsEnum(KNOWLEDGE_ACCESS_LEVELS, { each: true })
  @IsOptional()
  accessLevels?: KnowledgeAccessLevelValue[];

  @ApiPropertyOptional({
    enum: KNOWLEDGE_BUSINESS_STATUSES,
    isArray: true,
    example: ['PUBLISHED'],
  })
  @IsArray()
  @ArrayMaxSize(3)
  @IsEnum(KNOWLEDGE_BUSINESS_STATUSES, { each: true })
  @IsOptional()
  businessStatuses?: KnowledgeBusinessStatusValue[];

  @ApiPropertyOptional({
    type: [String],
    example: ['PRODUCT_A'],
    description:
      '빈 productCodes 문서는 공통 문서로 포함되고, 값이 있는 문서는 하나 이상 일치해야 합니다.',
  })
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @IsOptional()
  productCodes?: string[];

  @ApiPropertyOptional({
    format: 'date-time',
    example: '2026-07-18T00:00:00.000Z',
    description:
      'effectiveFrom은 이하, effectiveTo는 exclusive upper bound로 평가합니다.',
  })
  @IsDateString({ strict: true })
  @IsOptional()
  activeAt?: string;
}

export class UpdateKnowledgeFilePolicyDto {
  @ApiPropertyOptional({ enum: KNOWLEDGE_ACCESS_LEVELS, example: 'PUBLIC' })
  @IsEnum(KNOWLEDGE_ACCESS_LEVELS)
  @IsOptional()
  accessLevel?: KnowledgeAccessLevelValue;

  @ApiPropertyOptional({
    enum: KNOWLEDGE_BUSINESS_STATUSES,
    example: 'PUBLISHED',
  })
  @IsEnum(KNOWLEDGE_BUSINESS_STATUSES)
  @IsOptional()
  businessStatus?: KnowledgeBusinessStatusValue;

  @ApiPropertyOptional({ type: [String], example: ['PRODUCT_A'] })
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @IsOptional()
  productCodes?: string[];

  @ApiPropertyOptional({
    format: 'date-time',
    nullable: true,
    example: '2026-07-01T00:00:00.000Z',
  })
  @IsDateString({ strict: true })
  @IsOptional()
  effectiveFrom?: string | null;

  @ApiPropertyOptional({
    format: 'date-time',
    nullable: true,
    example: '2027-01-01T00:00:00.000Z',
  })
  @IsDateString({ strict: true })
  @IsOptional()
  effectiveTo?: string | null;
}

export class KnowledgeFiltersContainerDto {
  @ApiPropertyOptional({ type: KnowledgeSearchFiltersDto })
  @Type(() => KnowledgeSearchFiltersDto)
  @ValidateNested()
  @IsOptional()
  filters?: KnowledgeSearchFiltersDto;
}
