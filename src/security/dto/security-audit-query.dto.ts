import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export class SecurityAuditQueryDto {
  @ApiPropertyOptional({ example: 'APPKEY_ROTATED' })
  @IsString()
  @IsOptional()
  eventType?: string;

  @ApiPropertyOptional({ example: '3df15c39-8f9d-4c18-8573-01f4f06e18dd' })
  @IsUUID()
  @IsOptional()
  appId?: string;

  @ApiPropertyOptional({ example: 'baea61e0-570b-4f73-a8df-529fa96717fb' })
  @IsUUID()
  @IsOptional()
  consoleOrganizationId?: string;

  @ApiPropertyOptional({ example: '70fb3457-5134-4999-9efe-caf5f78a6b08' })
  @IsUUID()
  @IsOptional()
  worksUserId?: string;

  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 200 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  @IsOptional()
  limit?: number;
}
