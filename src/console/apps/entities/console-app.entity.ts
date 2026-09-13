import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ConsoleAppEntity {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Customer Support' })
  appname!: string;

  @ApiProperty({
    example: 'CONSOLE_3DF15C398F9D4C18857301F4F06E18DD',
    description: '서버가 생성하는 읽기 전용 애플리케이션 코드입니다.',
  })
  appcode!: string;

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
