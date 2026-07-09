import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class KnowledgeSearchDto {
  @ApiProperty({
    example: 'S3 업로드 파일을 RAG 검색에 활용하는 방법을 알려줘.',
  })
  @IsString()
  @IsNotEmpty()
  query!: string;

  @ApiPropertyOptional({ example: 5, minimum: 1, maximum: 20 })
  @IsInt()
  @Min(1)
  @Max(20)
  @IsOptional()
  limit?: number;

  @ApiPropertyOptional({
    example: 0.35,
    minimum: -1,
    maximum: 1,
    description: '반환할 최소 유사도 점수입니다.',
  })
  @IsNumber()
  @Min(-1)
  @Max(1)
  @IsOptional()
  scoreThreshold?: number;
}
