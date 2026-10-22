import type { JevService } from './jev.service';

type Classification = Awaited<ReturnType<JevService['classifyInquiry']>>;
const nonnegative = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;

/** Explicit allowlist: never expose provider bodies, balances or destination. */
export function summarizeClassification(result: Classification | undefined) {
  const skipped = !result || result.status === 'skipped';
  const classified = result?.status === 'classified' ? result : undefined;
  const attempted = result && result.status !== 'skipped' ? result : undefined;
  const failed = result?.status === 'unavailable' ? result : undefined;
  const intent = classified?.answers?.intent;
  const usage = attempted?.usage;
  return {
    status: result?.status ?? ('skipped' as const),
    category: classified?.category ?? null,
    appliedCategory: classified?.appliedCategory ?? null,
    applied: classified?.applied ?? false,
    confidence: intent?.type === 'choice' ? intent.confidence : null,
    selectedProbability:
      intent?.type === 'choice' ? intent.probabilities[intent.choice] : null,
    minimumConfidence: attempted?.minimumConfidence ?? null,
    policyVersion: attempted?.policyVersion ?? null,
    durationMs: nonnegative(attempted?.durationMs),
    reason: skipped
      ? result?.status === 'skipped'
        ? result.reason
        : 'not_enabled_for_request'
      : failed
        ? 'classification_unavailable'
        : classified?.applied
          ? null
          : 'low_confidence',
    errorCode: failed
      ? failed.code === 'JEV_AI_INVALID_RESPONSE'
        ? 'CLASSIFICATION_INVALID_RESPONSE'
        : 'CLASSIFICATION_UNAVAILABLE'
      : null,
    outcome: skipped ? 'not_sent' : (failed?.outcome ?? 'succeeded'),
    usage:
      usage &&
      Number.isInteger(usage.inputTokens) &&
      Number.isInteger(usage.outputTokens) &&
      usage.inputTokens >= 0 &&
      usage.outputTokens >= 0
        ? { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens }
        : null,
    billing: {
      creditsCharged: nonnegative(attempted?.billing?.creditsCharged),
      paidInputTokensUsed: nonnegative(attempted?.billing?.paidInputTokensUsed),
    },
  };
}
