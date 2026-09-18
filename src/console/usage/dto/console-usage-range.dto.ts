import { Type } from 'class-transformer';
import { IsIn, IsInt } from 'class-validator';

export class ConsoleUsageRangeDto {
  @Type(() => Number)
  @IsInt()
  @IsIn([7, 30, 90])
  days = 30;
}
