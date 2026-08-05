import { ConfigService } from '@nestjs/config';
import { HealthService } from './health.service';

describe('HealthService', () => {
  const configuredValues: Record<string, string> = {
    AWS_S3_BUCKET: 'bucket',
    AWS_S3_REGION: 'ap-northeast-2',
    AWS_REGION: 'us-west-2',
    BEDROCK_MODEL_ID: 'model',
    BEDROCK_EMBEDDING_MODEL_ID: 'embedding-model',
  };

  function createService(databaseCheck: () => Promise<unknown>) {
    const prisma = { $queryRawUnsafe: databaseCheck };
    const config = {
      get: (key: string) => configuredValues[key],
    };
    return new HealthService(
      prisma as never,
      config as unknown as ConfigService,
    );
  }

  it('프로세스 liveness를 반환한다', () => {
    expect(
      createService(jest.fn().mockResolvedValue(1)).getLiveness(),
    ).toMatchObject({
      status: 'ok',
    });
  });

  it('DB와 필수 설정이 준비되면 ready를 반환한다', async () => {
    await expect(
      createService(jest.fn().mockResolvedValue(1)).getReadiness(),
    ).resolves.toMatchObject({
      status: 'ready',
      checks: {
        database: { status: 'up' },
        storage: { status: 'configured' },
        bedrock: { status: 'configured' },
      },
    });
  });

  it('DB 질의가 실패하면 not_ready를 반환한다', async () => {
    await expect(
      createService(
        jest.fn().mockRejectedValue(new Error('connection failed')),
      ).getReadiness(),
    ).resolves.toMatchObject({
      status: 'not_ready',
      checks: { database: { status: 'down' } },
    });
  });
});
