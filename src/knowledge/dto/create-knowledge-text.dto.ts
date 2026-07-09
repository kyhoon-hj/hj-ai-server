import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';

export class CreateKnowledgeTextDto {
  @ApiProperty({
    example: 'demo-store-inventory.md',
    description: 'RAG 지식 문서로 등록할 가상 파일명입니다.',
  })
  @IsString()
  @IsNotEmpty()
  originalName!: string;

  @ApiProperty({
    example: '# 매장 상품 안내\n\nAA-01 생활용품 코너에는...',
    description: 'chunk와 embedding으로 변환할 원문 텍스트입니다.',
  })
  @IsString()
  @IsNotEmpty()
  content!: string;

  @ApiPropertyOptional({
    example: { source: 'demo', domain: 'store-guide' },
  })
  @IsObject()
  @IsOptional()
  metadata?: Record<string, unknown>;
}
