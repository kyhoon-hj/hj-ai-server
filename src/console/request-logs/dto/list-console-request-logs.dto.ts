import { CONSOLE_ENDPOINTS } from '../../usage/console-usage-events';
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
  @IsIn(['month'])
  period?: 'month';

  @IsOptional()
  @IsUUID()
  appId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  appcode?: string;

  @IsOptional()
  @IsIn(['success', 'failed', 'unknown'])
  status?: 'success' | 'failed' | 'unknown';

  @IsOptional()
  @IsIn(CONSOLE_ENDPOINTS)
  endpoint?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  modelId?: string;

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
