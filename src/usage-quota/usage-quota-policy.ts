import { createHash } from 'node:crypto';
import { ServiceUnavailableException } from '@nestjs/common';

export const MAX_QUOTA_TOKENS = 2147483647;

export function measuredTokenCount(value: unknown): number | undefined {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MAX_QUOTA_TOKENS
    ? value
    : undefined;
}

// Admission estimate only; the provider's measured usage is authoritative.
export function estimateGenerationTokens(
  maxOutputTokens: number,
  input: string,
) {
  const estimate = maxOutputTokens + Math.ceil(input.length / 4);
  if (
    measuredTokenCount(maxOutputTokens) === undefined ||
    measuredTokenCount(estimate) === undefined
  ) {
    throw new ServiceUnavailableException(
      'USAGE_QUOTA_INVALID_TOKEN_RESERVATION',
    );
  }
  return estimate;
}

export function usageOperationHash(
  appcode: string,
  periodKey: string,
  operationKey: string,
  scope = 'legacy',
) {
  return createHash('sha256')
    .update(
      JSON.stringify(
        scope === 'legacy'
          ? [appcode, periodKey, operationKey]
          : [appcode, periodKey, scope, operationKey],
      ),
    )
    .digest('hex');
}

export function conversationQuotaScope(tenantRef: string, sessionRef: string) {
  return `conversation:${createHash('sha256')
    .update(JSON.stringify([tenantRef, sessionRef]))
    .digest('hex')}`;
}
