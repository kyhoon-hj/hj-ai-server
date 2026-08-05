import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class GeneralAnswerDto {
  @ApiProperty({
    example: '클라우드 컴퓨팅이 무엇인지 간단히 설명해 주세요.',
    description: '일반적이고 비전문적인 저위험 질문만 허용합니다.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  query!: string;
}
