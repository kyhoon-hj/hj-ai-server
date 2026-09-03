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

const ISO_DATE_TIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

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

  const previousCredentials = [
    {
      key: 'ADMIN_API_KEY_PREVIOUS',
      validUntilKey: 'ADMIN_API_KEY_PREVIOUS_VALID_UNTIL',
    },
    {
      key: 'KNOWLEDGE_OPERATOR_API_KEY_PREVIOUS',
      validUntilKey: 'KNOWLEDGE_OPERATOR_API_KEY_PREVIOUS_VALID_UNTIL',
    },
  ] as const;
  for (const pair of previousCredentials) {
    const previous = valueOf(config, pair.key);
    const validUntil = valueOf(config, pair.validUntilKey);
    if (Boolean(previous) !== Boolean(validUntil)) {
      errors.push(`${pair.key} and ${pair.validUntilKey} must be set together`);
    }
    if (previous && previous.length < 32) {
      errors.push(`${pair.key} must be at least 32 characters`);
    }
    if (
      validUntil &&
      (!ISO_DATE_TIME_PATTERN.test(validUntil) ||
        !Number.isFinite(Date.parse(validUntil)))
    ) {
      errors.push(`${pair.validUntilKey} must be a valid ISO date-time`);
    }
  }

  const credentialValues = [
    ['APPKEY_JWT_SECRET', appkeySecret],
    ['ADMIN_API_KEY', adminApiKey],
    ['KNOWLEDGE_OPERATOR_API_KEY', knowledgeOperatorApiKey],
    ['ADMIN_API_KEY_PREVIOUS', valueOf(config, 'ADMIN_API_KEY_PREVIOUS')],
    [
      'KNOWLEDGE_OPERATOR_API_KEY_PREVIOUS',
      valueOf(config, 'KNOWLEDGE_OPERATOR_API_KEY_PREVIOUS'),
    ],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]));
  for (let index = 0; index < credentialValues.length; index += 1) {
    for (
      let comparison = index + 1;
      comparison < credentialValues.length;
      comparison += 1
    ) {
      if (credentialValues[index][1] === credentialValues[comparison][1]) {
        errors.push(
          `${credentialValues[index][0]} must differ from ${credentialValues[comparison][0]}`,
        );
      }
    }
  }

  const appkeyTtlDays = Number(valueOf(config, 'APPKEY_TTL_DAYS') || 90);
  if (
    !Number.isInteger(appkeyTtlDays) ||
    appkeyTtlDays < 1 ||
    appkeyTtlDays > 3650
  ) {
    errors.push('APPKEY_TTL_DAYS must be an integer between 1 and 3650');
  }

  const maxRotationGraceSeconds = Number(
    valueOf(config, 'APPKEY_MAX_ROTATION_GRACE_SECONDS') || 86400,
  );
  if (
    !Number.isInteger(maxRotationGraceSeconds) ||
    maxRotationGraceSeconds < 0 ||
    maxRotationGraceSeconds > 86400
  ) {
    errors.push(
      'APPKEY_MAX_ROTATION_GRACE_SECONDS must be an integer between 0 and 86400',
    );
  }

  const port = Number(valueOf(config, 'PORT') || 11000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    errors.push('PORT must be an integer between 1 and 65535');
  }

  const knowledgeMaxFileSizeMb = Number(
    valueOf(config, 'KNOWLEDGE_MAX_FILE_SIZE_MB') || 30,
  );
  if (
    !Number.isInteger(knowledgeMaxFileSizeMb) ||
    knowledgeMaxFileSizeMb < 1 ||
    knowledgeMaxFileSizeMb > 100
  ) {
    errors.push(
      'KNOWLEDGE_MAX_FILE_SIZE_MB must be an integer between 1 and 100',
    );
  }

  const knowledgeIndexMaxAttempts = Number(
    valueOf(config, 'KNOWLEDGE_INDEX_MAX_ATTEMPTS') || 3,
  );
  if (
    !Number.isInteger(knowledgeIndexMaxAttempts) ||
    knowledgeIndexMaxAttempts < 1 ||
    knowledgeIndexMaxAttempts > 10
  ) {
    errors.push(
      'KNOWLEDGE_INDEX_MAX_ATTEMPTS must be an integer between 1 and 10',
    );
  }

  const knowledgeIndexRetryDelayMs = Number(
    valueOf(config, 'KNOWLEDGE_INDEX_RETRY_DELAY_MS') || 1000,
  );
  if (
    !Number.isInteger(knowledgeIndexRetryDelayMs) ||
    knowledgeIndexRetryDelayMs < 100 ||
    knowledgeIndexRetryDelayMs > 60000
  ) {
    errors.push(
      'KNOWLEDGE_INDEX_RETRY_DELAY_MS must be an integer between 100 and 60000',
    );
  }

  const knowledgeEmbeddingConcurrency = Number(
    valueOf(config, 'KNOWLEDGE_EMBEDDING_CONCURRENCY') || 4,
  );
  if (
    !Number.isInteger(knowledgeEmbeddingConcurrency) ||
    knowledgeEmbeddingConcurrency < 1 ||
    knowledgeEmbeddingConcurrency > 16
  ) {
    errors.push(
      'KNOWLEDGE_EMBEDDING_CONCURRENCY must be an integer between 1 and 16',
    );
  }

  const awsConnectionTimeoutMs = Number(
    valueOf(config, 'AWS_CONNECTION_TIMEOUT_MS') || 5000,
  );
  if (
    !Number.isInteger(awsConnectionTimeoutMs) ||
    awsConnectionTimeoutMs < 100 ||
    awsConnectionTimeoutMs > 60000
  ) {
    errors.push(
      'AWS_CONNECTION_TIMEOUT_MS must be an integer between 100 and 60000',
    );
  }

  const awsRequestTimeoutMs = Number(
    valueOf(config, 'AWS_REQUEST_TIMEOUT_MS') || 30000,
  );
  if (
    !Number.isInteger(awsRequestTimeoutMs) ||
    awsRequestTimeoutMs < 100 ||
    awsRequestTimeoutMs > 300000
  ) {
    errors.push(
      'AWS_REQUEST_TIMEOUT_MS must be an integer between 100 and 300000',
    );
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
    APPKEY_TTL_DAYS: String(appkeyTtlDays),
    APPKEY_MAX_ROTATION_GRACE_SECONDS: String(maxRotationGraceSeconds),
    KNOWLEDGE_MAX_FILE_SIZE_MB: String(knowledgeMaxFileSizeMb),
    KNOWLEDGE_INDEX_MAX_ATTEMPTS: String(knowledgeIndexMaxAttempts),
    KNOWLEDGE_INDEX_RETRY_DELAY_MS: String(knowledgeIndexRetryDelayMs),
    KNOWLEDGE_EMBEDDING_CONCURRENCY: String(knowledgeEmbeddingConcurrency),
    AWS_CONNECTION_TIMEOUT_MS: String(awsConnectionTimeoutMs),
    AWS_REQUEST_TIMEOUT_MS: String(awsRequestTimeoutMs),
  };
}
