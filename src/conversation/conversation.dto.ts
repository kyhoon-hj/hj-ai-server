import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  Equals,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsISO8601,
  IsObject,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class ConversationMessageDto {
  @ApiProperty({ enum: ['user', 'assistant'] })
  @IsIn(['user', 'assistant'])
  role!: 'user' | 'assistant';
  @ApiProperty({
    maxLength: 4000,
    description:
      'Text only; latest user message is limited to 1000 characters.',
  })
  @IsString()
  @Matches(/\S/)
  @MaxLength(4000)
  text!: string;
}

export class ConversationScopeDto {
  @ApiProperty({ pattern: '^[a-f0-9]{64}$' })
  @Matches(/^[a-f0-9]{64}$/)
  tenantRef!: string;
  @ApiProperty({ enum: ['FAMILY'] })
  @Equals('FAMILY')
  audience!: 'FAMILY';
}

export class ConversationFactsDto {
  @ApiProperty({ maxLength: 6000 })
  @IsString()
  @Matches(/\S/)
  @MaxLength(6000)
  text!: string;
  @ApiProperty({ pattern: '^[a-f0-9]{64}$' })
  @Matches(/^[a-f0-9]{64}$/)
  version!: string;
  @ApiProperty({ format: 'date-time' })
  @IsISO8601()
  expiresAt!: string;
}

/** v2 permits short, server-verified FAMILY facts; member scope remains forbidden. */
export class ConversationTurnDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  requestId!: string;
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  sessionRef!: string;
  @ApiProperty({ enum: ['frame-family-v1', 'frame-family-v2'] })
  @IsIn(['frame-family-v1', 'frame-family-v2'])
  policyVersion!: 'frame-family-v1' | 'frame-family-v2';
  @ApiProperty({ type: ConversationFactsDto, required: false })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ConversationFactsDto)
  contextFacts?: ConversationFactsDto;
  @ApiProperty({ type: ConversationScopeDto })
  @IsObject()
  @ValidateNested()
  @Type(() => ConversationScopeDto)
  scope!: ConversationScopeDto;
  @ApiProperty({ type: [ConversationMessageDto], minItems: 1, maxItems: 21 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(21)
  @ValidateNested({ each: true })
  @Type(() => ConversationMessageDto)
  messages!: ConversationMessageDto[];
  @ApiProperty({ minimum: 64, maximum: 512, example: 512 })
  @IsInt()
  @Min(64)
  @Max(512)
  maxOutputTokens!: number;
}
