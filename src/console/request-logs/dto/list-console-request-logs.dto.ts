import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class ListConsoleRequestLogsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsIn([7, 30, 90])
  days = 30;

  @IsOptional()
  @IsUUID()
  appId?: string;

  @IsOptional()
  @IsIn(['success', 'failed'])
  status?: 'success' | 'failed';

  @IsOptional()
  @IsString()
  @MaxLength(200)
  requestId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  errorCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 25;
}
