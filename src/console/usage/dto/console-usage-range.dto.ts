import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';
import { CONSOLE_ENDPOINTS } from '../console-usage-events';

export class ConsoleUsageRangeDto {
  @Type(() => Number)
  @IsInt()
  @IsIn([7, 30, 90])
  days = 30;

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
  appcode?: string;

  @IsOptional()
  @IsIn(['success', 'failed', 'unknown'])
  status?: 'success' | 'failed' | 'unknown';
}
