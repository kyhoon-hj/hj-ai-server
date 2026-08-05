import { validateEnvironment } from './environment';

const validEnvironment = {
  DATABASE_URL: 'postgresql://user:password@localhost:5432/hj-ai',
  APPKEY_JWT_SECRET: 'a'.repeat(32),
  ADMIN_API_KEY: 'b'.repeat(32),
  AWS_REGION: 'us-west-2',
  BEDROCK_MODEL_ID: 'model-id',
  BEDROCK_EMBEDDING_MODEL_ID: 'embedding-model-id',
  AWS_S3_BUCKET: 'bucket-name',
  AWS_S3_REGION: 'ap-northeast-2',
  API_BASE_URL: 'https://ai.example.com',
};

describe('validateEnvironment', () => {
  it('필수 설정과 기본 포트를 검증한다', () => {
    expect(validateEnvironment(validEnvironment)).toMatchObject({
      PORT: '11000',
      API_GLOBAL_PREFIX: '',
    });
  });

  it('필수 설정 누락을 한 번에 보고한다', () => {
    expect(() => validateEnvironment({})).toThrow(
      /DATABASE_URL is required.*APPKEY_JWT_SECRET is required.*AWS_S3_BUCKET is required/,
    );
  });

  it('잘못된 포트와 prefix를 거절한다', () => {
    expect(() =>
      validateEnvironment({
        ...validEnvironment,
        PORT: '70000',
        API_GLOBAL_PREFIX: '/ai',
      }),
    ).toThrow(/PORT must be.*API_GLOBAL_PREFIX must be/);
  });

  it('관리자 키를 appkey 서명 secret과 분리한다', () => {
    expect(() =>
      validateEnvironment({
        ...validEnvironment,
        ADMIN_API_KEY: validEnvironment.APPKEY_JWT_SECRET,
      }),
    ).toThrow(/ADMIN_API_KEY must differ/);
  });
});
