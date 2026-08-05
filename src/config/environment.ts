const REQUIRED_ENVIRONMENT_KEYS = [
  'DATABASE_URL',
  'APPKEY_JWT_SECRET',
  'ADMIN_API_KEY',
  'KNOWLEDGE_OPERATOR_API_KEY',
  'AWS_REGION',
  'BEDROCK_MODEL_ID',
  'BEDROCK_EMBEDDING_MODEL_ID',
  'AWS_S3_BUCKET',
  'AWS_S3_REGION',
] as const;

const BOOLEAN_ENVIRONMENT_KEYS = [
  'SWAGGER_ENABLED',
  'ENABLE_TEST_TABLE_API',
  'ENABLE_LEGACY_BEDROCK_INSPECTION_API',
  'ENABLE_LEGACY_KNOWLEDGE_WRITE_API',
] as const;

function valueOf(config: Record<string, unknown>, key: string): string {
  const value = config[key];
  return typeof value === 'string' || typeof value === 'number'
    ? String(value).trim()
    : '';
}

export function validateEnvironment(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const errors: string[] = [];

  for (const key of REQUIRED_ENVIRONMENT_KEYS) {
    if (!valueOf(config, key)) errors.push(`${key} is required`);
  }

  const appkeySecret = valueOf(config, 'APPKEY_JWT_SECRET');
  if (appkeySecret && appkeySecret.length < 32) {
    errors.push('APPKEY_JWT_SECRET must be at least 32 characters');
  }

  const adminApiKey = valueOf(config, 'ADMIN_API_KEY');
  if (adminApiKey && adminApiKey.length < 32) {
    errors.push('ADMIN_API_KEY must be at least 32 characters');
  }
  if (adminApiKey && appkeySecret && adminApiKey === appkeySecret) {
    errors.push('ADMIN_API_KEY must differ from APPKEY_JWT_SECRET');
  }

  const knowledgeOperatorApiKey = valueOf(config, 'KNOWLEDGE_OPERATOR_API_KEY');
  if (knowledgeOperatorApiKey && knowledgeOperatorApiKey.length < 32) {
    errors.push('KNOWLEDGE_OPERATOR_API_KEY must be at least 32 characters');
  }
  if (
    knowledgeOperatorApiKey &&
    [appkeySecret, adminApiKey].includes(knowledgeOperatorApiKey)
  ) {
    errors.push(
      'KNOWLEDGE_OPERATOR_API_KEY must differ from ADMIN_API_KEY and APPKEY_JWT_SECRET',
    );
  }

  const port = Number(valueOf(config, 'PORT') || 11000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    errors.push('PORT must be an integer between 1 and 65535');
  }

  const prefix = valueOf(config, 'API_GLOBAL_PREFIX');
  if (
    prefix &&
    (!/^[A-Za-z0-9][A-Za-z0-9/_-]*$/.test(prefix) ||
      prefix.includes('..') ||
      prefix.endsWith('/'))
  ) {
    errors.push(
      'API_GLOBAL_PREFIX must be a relative path without leading or trailing slashes',
    );
  }

  const baseUrl = valueOf(config, 'API_BASE_URL');
  if (baseUrl) {
    try {
      const parsed = new URL(baseUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
    } catch {
      errors.push('API_BASE_URL must be a valid http or https URL');
    }
  }

  for (const key of BOOLEAN_ENVIRONMENT_KEYS) {
    const value = valueOf(config, key).toLowerCase();
    if (value && !['true', 'false'].includes(value)) {
      errors.push(`${key} must be true or false`);
    }
  }

  const swaggerPath = valueOf(config, 'SWAGGER_PATH') || 'api-docs';
  if (
    !/^[A-Za-z0-9][A-Za-z0-9/_-]*$/.test(swaggerPath) ||
    swaggerPath.includes('..') ||
    swaggerPath.endsWith('/')
  ) {
    errors.push(
      'SWAGGER_PATH must be a relative path without leading or trailing slashes',
    );
  }

  const corsAllowedOrigins = valueOf(config, 'CORS_ALLOWED_ORIGINS');
  for (const origin of corsAllowedOrigins
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)) {
    try {
      const parsed = new URL(origin);
      if (
        origin === '*' ||
        !['http:', 'https:'].includes(parsed.protocol) ||
        parsed.origin !== origin
      ) {
        throw new Error();
      }
    } catch {
      errors.push(
        `CORS_ALLOWED_ORIGINS contains an invalid exact http(s) origin: ${origin}`,
      );
    }
  }

  if (errors.length > 0) {
    throw new Error(`Environment validation failed: ${errors.join('; ')}`);
  }

  return {
    ...config,
    PORT: String(port),
    API_GLOBAL_PREFIX: prefix,
    SWAGGER_PATH: swaggerPath,
  };
}
