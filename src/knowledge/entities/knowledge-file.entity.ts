import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class KnowledgeFileEntity {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  appcode!: string;

  @ApiProperty()
  bucket!: string;

  @ApiProperty()
  key!: string;

  @ApiPropertyOptional()
  url?: string | null;

  @ApiProperty()
  originalName!: string;

  @ApiProperty()
  mimetype!: string;

  @ApiProperty()
  size!: number;

  @ApiPropertyOptional()
  checksum?: string | null;

  @ApiProperty()
  status!: string;

  @ApiProperty({ enum: ['PUBLIC', 'INTERNAL', 'RESTRICTED'] })
  accessLevel!: string;

  @ApiProperty({ enum: ['DRAFT', 'PUBLISHED', 'RETIRED'] })
  businessStatus!: string;

  @ApiProperty({ type: [String] })
  productCodes!: string[];

  @ApiPropertyOptional({ nullable: true })
  effectiveFrom?: Date | null;

  @ApiPropertyOptional({ nullable: true })
  effectiveTo?: Date | null;

  @ApiPropertyOptional()
  errorMessage?: string | null;

  @ApiPropertyOptional()
  metadata?: Record<string, unknown> | null;

  @ApiPropertyOptional()
  indexedAt?: Date | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;

  @ApiPropertyOptional({
    example: {
      chunks: 3,
    },
  })
  _count?: {
    chunks: number;
  };
}
