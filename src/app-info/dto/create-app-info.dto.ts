import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateAppInfoDto {
  @ApiProperty({ example: 'External CRM' })
  @IsString()
  @IsNotEmpty()
  appname: string;

  @ApiProperty({ example: 'external-crm' })
  @IsString()
  @IsNotEmpty()
  appcode: string;

  @ApiPropertyOptional({ example: 'CRM integration app' })
  @IsString()
  @IsOptional()
  remark?: string;
}
