import { validateEnvironment } from './environment';

const validEnvironment = {
  DATABASE_URL: 'postgresql://user:password@localhost:5432/hj-ai',
  APPKEY_JWT_SECRET: 'a'.repeat(32),
  ADMIN_API_KEY: 'b'.repeat(32),
  KNOWLEDGE_OPERATOR_API_KEY: 'c'.repeat(32),
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

  it('지식 운영자 키를 다른 credential과 분리한다', () => {
    expect(() =>
      validateEnvironment({
        ...validEnvironment,
        KNOWLEDGE_OPERATOR_API_KEY: validEnvironment.ADMIN_API_KEY,
      }),
    ).toThrow(/KNOWLEDGE_OPERATOR_API_KEY must differ/);
  });

  it('운영 HTTP 노출 설정의 형식을 검증한다', () => {
    expect(() =>
      validateEnvironment({
        ...validEnvironment,
        SWAGGER_ENABLED: 'yes',
        SWAGGER_PATH: '/api-docs',
        CORS_ALLOWED_ORIGINS: '*,https://app.example.com/path',
      }),
    ).toThrow(
      /SWAGGER_ENABLED must be.*SWAGGER_PATH must be.*CORS_ALLOWED_ORIGINS contains.*CORS_ALLOWED_ORIGINS contains/,
    );
  });

  it('운영 제외 API 플래그는 명시적 boolean만 허용한다', () => {
    expect(() =>
      validateEnvironment({
        ...validEnvironment,
        ENABLE_TEST_TABLE_API: 'yes',
        ENABLE_LEGACY_BEDROCK_INSPECTION_API: '1',
        ENABLE_LEGACY_KNOWLEDGE_WRITE_API: 'enabled',
      }),
    ).toThrow(
      /ENABLE_TEST_TABLE_API must be.*ENABLE_LEGACY_BEDROCK_INSPECTION_API must be.*ENABLE_LEGACY_KNOWLEDGE_WRITE_API must be/,
    );
  });

  it('정확한 CORS origin allowlist와 Swagger 설정을 허용한다', () => {
    expect(
      validateEnvironment({
        ...validEnvironment,
        SWAGGER_ENABLED: 'false',
        SWAGGER_PATH: 'internal/api-docs',
        CORS_ALLOWED_ORIGINS: 'https://app.example.com,http://127.0.0.1:3200',
      }),
    ).toMatchObject({
      SWAGGER_PATH: 'internal/api-docs',
    });
  });
});
