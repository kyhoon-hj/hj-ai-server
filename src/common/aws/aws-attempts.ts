/** Only SDK-reported counters are measured; absent metadata is not zero. */
export function readAwsAttempts(value: unknown) {
  const metadata =
    value && typeof value === 'object' && '$metadata' in value
      ? (value.$metadata as Record<string, unknown> | undefined)
      : undefined;
  const attempts = metadata?.attempts;
  const delay = metadata?.totalRetryDelay;
  const measured =
    typeof attempts === 'number' && Number.isInteger(attempts) && attempts >= 1;
  return {
    attempts: measured ? attempts : null,
    retryCount: measured ? attempts - 1 : null,
    totalRetryDelayMs:
      typeof delay === 'number' && Number.isFinite(delay) && delay >= 0
        ? delay
        : null,
  };
}
