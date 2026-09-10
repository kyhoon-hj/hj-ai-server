import { ApiProperty } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

const REF_PATTERN = /^[0-9a-f]{64}$/;

export class FamilyKnowledgeEventDto {
  @ApiProperty({ maxLength: 191 })
  @IsString()
  @Matches(/\S/)
  @MaxLength(191)
  sourceId!: string;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  sourceVersion!: number;

  @ApiProperty({ enum: ['UPSERT', 'DELETE'] })
  @IsIn(['UPSERT', 'DELETE'])
  operation!: 'UPSERT' | 'DELETE';

  @ApiProperty({ pattern: REF_PATTERN.source })
  @Matches(REF_PATTERN)
  tenantRef!: string;

  @ApiProperty({ enum: ['FAMILY', 'MEMBER'] })
  @IsIn(['FAMILY', 'MEMBER'])
  audience!: 'FAMILY' | 'MEMBER';

  @ApiProperty({ pattern: REF_PATTERN.source, required: false })
  @IsOptional()
  @Matches(REF_PATTERN)
  memberRef?: string;

  @ApiProperty({ enum: ['TEXT', 'PHOTO_DESCRIPTION'] })
  @IsIn(['TEXT', 'PHOTO_DESCRIPTION'])
  sourceType!: 'TEXT' | 'PHOTO_DESCRIPTION';

  @ApiProperty({ enum: ['NON_SENSITIVE', 'SENSITIVE'] })
  @IsIn(['NON_SENSITIVE', 'SENSITIVE'])
  sensitivity!: 'NON_SENSITIVE' | 'SENSITIVE';

  @ApiProperty({ maxLength: 200, required: false })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiProperty({ maxLength: 100000, required: false })
  @ValidateIf((value: FamilyKnowledgeEventDto) => value.operation === 'UPSERT')
  @IsString()
  @Matches(/\S/)
  @MaxLength(100000)
  content?: string;

  @ApiProperty({ format: 'date-time' })
  @IsISO8601({ strict: true })
  publishedAt!: string;
}

export class FamilyKnowledgeEventResponseDto {
  @ApiProperty({ format: 'uuid' })
  eventId!: string;

  @ApiProperty()
  sourceId!: string;

  @ApiProperty()
  sourceVersion!: number;

  @ApiProperty({ enum: ['UPSERT', 'DELETE'] })
  operation!: 'UPSERT' | 'DELETE';

  @ApiProperty({
    enum: ['QUEUED', 'PROCESSING', 'RETRY', 'SUCCEEDED', 'FAILED'],
  })
  status!: string;

  @ApiProperty({ nullable: true })
  resultCode!: string | null;

  @ApiProperty()
  replayed!: boolean;
}
