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

  @ApiProperty({ example: 'active', enum: ['active', 'inactive'] })
  status: string;

  @ApiPropertyOptional({ example: 'external-crm/knowledge', nullable: true })
  s3Prefix: string | null;

  @ApiPropertyOptional({
    example: 'us.anthropic.claude-sonnet-4-6',
    nullable: true,
  })
  defaultModelId: string | null;

  @ApiPropertyOptional({
    example: 'amazon.titan-embed-text-v2:0',
    nullable: true,
  })
  defaultEmbeddingModelId: string | null;

  @ApiPropertyOptional({
    example: '제공된 자료에 근거해서만 한국어로 답변하세요.',
    nullable: true,
  })
  systemPrompt: string | null;

  @ApiPropertyOptional({ example: 1024, nullable: true })
  maxStorageMb: number | null;

  @ApiPropertyOptional({ example: 1000000, nullable: true })
  monthlyTokenLimit: number | null;

  @ApiPropertyOptional({
    example: { industry: 'retail', owner: 'demo-team' },
    nullable: true,
  })
  metadata: Record<string, unknown> | null;

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

export class AppInfoCreatedEntity extends AppInfoEntity {}
