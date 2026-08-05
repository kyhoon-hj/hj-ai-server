import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

type CheckStatus = 'up' | 'down' | 'configured' | 'missing';

export interface HealthCheck {
  status: CheckStatus;
}

export interface ReadinessResponse {
  status: 'ready' | 'not_ready';
  timestamp: string;
  checks: {
    database: HealthCheck;
    storage: HealthCheck;
    bedrock: HealthCheck;
  };
}

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  getLiveness() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
    };
  }

  async getReadiness(): Promise<ReadinessResponse> {
    const checks = {
      database: await this.checkDatabase(),
      storage: this.checkConfiguration(['AWS_S3_BUCKET', 'AWS_S3_REGION']),
      bedrock: this.checkConfiguration([
        'AWS_REGION',
        'BEDROCK_MODEL_ID',
        'BEDROCK_EMBEDDING_MODEL_ID',
      ]),
    };
    const ready = Object.values(checks).every(
      (check) => check.status === 'up' || check.status === 'configured',
    );

    return {
      status: ready ? 'ready' : 'not_ready',
      timestamp: new Date().toISOString(),
      checks,
    };
  }

  private async checkDatabase(): Promise<HealthCheck> {
    try {
      await this.prisma.$queryRawUnsafe('SELECT 1');
      return { status: 'up' };
    } catch {
      return { status: 'down' };
    }
  }

  private checkConfiguration(keys: string[]): HealthCheck {
    const configured = keys.every((key) =>
      Boolean(this.configService.get<string>(key)?.trim()),
    );
    return { status: configured ? 'configured' : 'missing' };
  }
}
