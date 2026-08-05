export function parseCorsAllowedOrigins(value?: string): string[] {
  return [
    ...new Set(
      (value ?? '')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  ];
}

export function isSwaggerEnabled(configuredValue?: string): boolean {
  const normalized = configuredValue?.trim().toLowerCase();
  return normalized === 'true';
}
