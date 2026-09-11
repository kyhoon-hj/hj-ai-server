import { createHash } from 'node:crypto';
import {
  ConflictException,
  HttpException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type FamilyEmbeddingUsageKind = 'INDEX' | 'SEARCH';

export function calendarMonthUtc(at = new Date()) {
  return at.toISOString().slice(0, 7);
}

@Injectable()
export class FamilyEmbeddingUsageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async execute<T>(
    input: {
      appcode: string;
      kind: FamilyEmbeddingUsageKind;
      operationKey: string;
    },
    work: () => Promise<T>,
  ): Promise<T> {
    const periodKey = calendarMonthUtc();
    const operationKeyHash = createHash('sha256')
      .update(JSON.stringify([input.appcode, periodKey, input.operationKey]))
      .digest('hex');
    const limit = this.monthlyLimit();
    await this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify(
          ['family-embedding', input.appcode, periodKey],
        )}, 0))::text AS "locked"`,
      );
      const existing = await transaction.familyEmbeddingUsage.findUnique({
        where: { operationKeyHash },
        select: { id: true },
      });
      if (existing) {
        throw new ConflictException(
          'FAMILY_EMBEDDING_OPERATION_ALREADY_RESERVED',
        );
      }
      const used = await transaction.familyEmbeddingUsage.count({
        where: { appcode: input.appcode, periodKey },
      });
      if (used >= limit) {
        throw new HttpException('FAMILY_EMBEDDING_MONTHLY_LIMIT_EXCEEDED', 429);
      }
      await transaction.familyEmbeddingUsage.create({
        data: {
          appcode: input.appcode,
          periodKey,
          operationKeyHash,
          kind: input.kind,
        },
      });
    });
    try {
      const result = await work();
      await this.finish(operationKeyHash, 'SUCCEEDED');
      return result;
    } catch (error) {
      await this.finish(operationKeyHash, 'UNCERTAIN').catch(() => undefined);
      throw error;
    }
  }

  private monthlyLimit() {
    const value = Number(
      this.config.get<string>('FRAME_FAMILY_EMBEDDING_MONTHLY_LIMIT'),
    );
    if (!Number.isInteger(value) || value < 1 || value > 1_000_000) {
      throw new ServiceUnavailableException(
        'FAMILY_EMBEDDING_MONTHLY_LIMIT_REQUIRED',
      );
    }
    return value;
  }

  private finish(operationKeyHash: string, state: 'SUCCEEDED' | 'UNCERTAIN') {
    return this.prisma.familyEmbeddingUsage.update({
      where: { operationKeyHash },
      data: { state, completedAt: new Date() },
    });
  }
}
