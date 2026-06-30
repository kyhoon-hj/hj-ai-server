import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';

export class AppInfoEntity {
  @ApiProperty({ example: '3df15c39-8f9d-4c18-8573-01f4f06e18dd' })
  id: string;

  @ApiProperty({ example: 'External CRM' })
  appname: string;

  @ApiProperty({
    example:
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIzZGYxNWMzOS04ZjlkLTRjMTgtODU3My0wMWY0ZjA2ZTE4ZGQiLCJhcHBjb2RlIjoiZXh0ZXJuYWwtY3JtIiwiaWF0IjoxNzgxOTI4MDAwfQ.signature',
  })
  appkey: string;

  @ApiProperty({ example: 'external-crm' })
  appcode: string;

  @ApiPropertyOptional({ example: 'CRM integration app', nullable: true })
  remark: string | null;

  @ApiProperty({ example: '2026-06-22T00:00:00.000Z' })
  createat: Date;

  @ApiProperty({ example: '2026-06-22T00:00:00.000Z' })
  updateat: Date;
}

export class AppInfoPublicEntity extends OmitType(AppInfoEntity, [
  'appkey',
] as const) {}
