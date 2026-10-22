import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  IsInt,
  Min,
  Max,
} from 'class-validator';

export class UpdateConsoleAppDto {
  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    minimum: 0,
    maximum: 2147483647,
    description: 'UTC 월간 요청 한도. null은 무제한, 0은 사용 차단.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2147483647)
  monthlyRequestLimit?: number | null;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    minimum: 0,
    maximum: 2147483647,
    description:
      'UTC 월간 생성 입력·출력 토큰 합계 한도. null은 무제한, 0은 사용 차단.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2147483647)
  monthlyTokenLimit?: number | null;

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
