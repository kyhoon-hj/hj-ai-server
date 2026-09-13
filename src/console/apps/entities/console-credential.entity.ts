import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ConsoleCredentialSummaryEntity {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: ['active', 'expired'] })
  status!: 'active' | 'expired';

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  issuedByIdentityId!: string | null;

  @ApiPropertyOptional({ nullable: true })
  issuedAt!: Date | null;

  @ApiPropertyOptional({ nullable: true })
  lastUsedAt!: Date | null;

  @ApiPropertyOptional({ nullable: true })
  expiresAt!: Date | null;

  @ApiProperty({ enum: ['current', 'previous'] })
  slot!: 'current' | 'previous';
}

export class ConsoleCredentialIssuedEntity {
  @ApiProperty({ type: ConsoleCredentialSummaryEntity })
  credential!: ConsoleCredentialSummaryEntity;

  @ApiProperty({
    description: '이 응답에서만 확인할 수 있는 appkey 원문입니다.',
  })
  appkey!: string;

  @ApiPropertyOptional({ nullable: true })
  previousCredentialValidUntil?: Date | null;
}

export class ConsoleCredentialRevokedEntity {
  @ApiProperty({ format: 'uuid' })
  credentialId!: string;

  @ApiProperty({ enum: ['revoked'] })
  status!: 'revoked';

  @ApiProperty()
  revokedAt!: Date;
}
