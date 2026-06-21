import { ApiProperty } from '@nestjs/swagger';

export class TestTableEntity {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'backend-check' })
  name: string;

  @ApiProperty({ example: '2026-06-20T02:06:15.000Z' })
  createdAt: Date;
}
