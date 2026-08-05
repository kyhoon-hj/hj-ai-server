const REQUIRED_ENVIRONMENT_KEYS = [
  'DATABASE_URL',
  'APPKEY_JWT_SECRET',
  'AWS_REGION',
  'BEDROCK_MODEL_ID',
  'BEDROCK_EMBEDDING_MODEL_ID',
  'AWS_S3_BUCKET',
  'AWS_S3_REGION',
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

  if (errors.length > 0) {
    throw new Error(`Environment validation failed: ${errors.join('; ')}`);
  }

  return { ...config, PORT: String(port), API_GLOBAL_PREFIX: prefix };
}
