import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateConsoleAppDto {
  @ApiProperty({ example: 'Customer Support' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  appname!: string;

  @ApiPropertyOptional({ example: '고객 문의용 RAG 애플리케이션' })
  @IsString()
  @MaxLength(1000)
  @IsOptional()
  remark?: string;
}
