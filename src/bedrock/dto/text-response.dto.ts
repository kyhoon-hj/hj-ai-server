import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class TextResponseDto {
  @ApiProperty({
    example: 'NestJS에서 AWS Bedrock을 연동하는 방법을 요약해줘.',
  })
  @IsString()
  @IsNotEmpty()
  message!: string;
}
