import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class RotateAppKeyDto {
  @ApiPropertyOptional({
    example: 300,
    default: 0,
    minimum: 0,
    maximum: 86400,
    description: '이전 appkey를 함께 허용할 grace period(초)입니다.',
  })
  @IsInt()
  @Min(0)
  @Max(86400)
  @IsOptional()
  gracePeriodSeconds?: number;

  @ApiPropertyOptional({
    example: 90,
    minimum: 1,
    maximum: 3650,
    description: '새 appkey 유효기간(일)입니다.',
  })
  @IsInt()
  @Min(1)
  @Max(3650)
  @IsOptional()
  ttlDays?: number;
}
