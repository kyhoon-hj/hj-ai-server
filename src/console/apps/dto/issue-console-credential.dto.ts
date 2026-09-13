import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class IssueConsoleCredentialDto {
  @ApiPropertyOptional({ default: 90, minimum: 1, maximum: 3650 })
  @IsInt()
  @Min(1)
  @Max(3650)
  @IsOptional()
  ttlDays?: number;
}
