import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ConsoleAppEntity {
  @ApiProperty({
    type: Number,
    nullable: true,
    minimum: 0,
    description: 'UTC 월 요청 한도. null 무제한, 0 차단.',
  })
  monthlyRequestLimit!: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    minimum: 0,
    description: 'UTC 월 생성 입력·출력 토큰 한도. null 무제한, 0 차단.',
  })
  monthlyTokenLimit!: number | null;
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Customer Support' })
  appname!: string;

  @ApiProperty({
    example: 'CONSOLE_3DF15C398F9D4C18857301F4F06E18DD',
    description: '서버가 생성하는 읽기 전용 애플리케이션 코드입니다.',
  })
  appcode!: string;

  @ApiPropertyOptional({
    nullable: true,
    description: '지식 파일 저장 한도(MB)',
  })
  maxStorageMb!: number | null;

  @ApiProperty({ enum: ['active', 'inactive'] })
  status!: string;

  @ApiPropertyOptional({ nullable: true })
  remark!: string | null;

  @ApiPropertyOptional({ nullable: true })
  appkeyExpiresAt!: Date | null;

  @ApiPropertyOptional({ nullable: true })
  appkeyRotatedAt!: Date | null;

  @ApiProperty()
  createat!: Date;

  @ApiProperty()
  updateat!: Date;
}
