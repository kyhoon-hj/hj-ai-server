import { Type } from 'class-transformer';
import {
  Equals,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class UsageReservationQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  appcode?: string;

  @IsOptional()
  @IsUUID()
  organizationId?: string;

  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  periodKey?: string;

  @IsOptional()
  @IsIn(['RESERVED', 'UNCERTAIN', 'SETTLED'])
  state?: 'RESERVED' | 'UNCERTAIN' | 'SETTLED';

  @IsOptional()
  @IsDateString({ strict: true })
  updatedBefore?: string;

  @IsOptional()
  @IsUUID()
  after?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit = 50;
}

export class ReconcileUsageReservationDto {
  @IsUUID()
  recoveryKey!: string;

  @IsDateString({ strict: true })
  expectedUpdatedAt!: string;

  @IsIn(['SETTLE_LOG', 'CONFIRM_USAGE', 'RELEASE'])
  action!: 'SETTLE_LOG' | 'CONFIRM_USAGE' | 'RELEASE';

  // Quiescing the original executor is an operational prerequisite, not inferred
  // merely from the age of the reservation.
  @Equals(true)
  executorStopped!: true;

  @Matches(/^[A-Za-z0-9][A-Za-z0-9._:/-]{2,199}$/)
  evidenceRef!: string;

  @IsOptional()
  @IsIn(['bedrock', 'knowledge', 'conversation'])
  logSource?: 'bedrock' | 'knowledge' | 'conversation';

  @IsOptional()
  @IsUUID()
  logId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2147483647)
  actualTokens?: number;
}
