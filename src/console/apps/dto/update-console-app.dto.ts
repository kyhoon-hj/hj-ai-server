import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class UpdateConsoleAppDto {
  @ApiPropertyOptional({ example: 'Customer Support' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  @IsOptional()
  appname?: string;

  @ApiPropertyOptional({ example: '고객 문의용 RAG 애플리케이션' })
  @IsString()
  @MaxLength(1000)
  @IsOptional()
  remark?: string;

  @ApiPropertyOptional({ enum: ['active', 'inactive'] })
  @IsIn(['active', 'inactive'])
  @IsOptional()
  status?: 'active' | 'inactive';
}
