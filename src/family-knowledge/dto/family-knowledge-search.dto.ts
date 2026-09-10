import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import {
  Equals,
  IsInt,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class FamilyKnowledgeSearchDto {
  @ApiProperty({ maxLength: 1000 })
  @IsString()
  @Matches(/\S/)
  @MaxLength(1000)
  query!: string;

  @ApiProperty({ pattern: '^[0-9a-f]{64}$' })
  @Matches(/^[0-9a-f]{64}$/)
  tenantRef!: string;

  @ApiProperty({ enum: ['FAMILY'] })
  @Equals('FAMILY')
  audience!: 'FAMILY';

  @ApiProperty({ minimum: 1, maximum: 5, default: 5, required: false })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  limit = 5;
}

export class FamilyKnowledgeSearchResultDto {
  @ApiProperty()
  sourceId!: string;

  @ApiProperty()
  sourceVersion!: number;

  @ApiProperty({ nullable: true })
  title!: string | null;

  @ApiProperty({ maxLength: 1200 })
  content!: string;

  @ApiProperty()
  score!: number;
}

export class FamilyKnowledgeSearchResponseDto {
  @ApiProperty({ type: [FamilyKnowledgeSearchResultDto] })
  results!: FamilyKnowledgeSearchResultDto[];
}
