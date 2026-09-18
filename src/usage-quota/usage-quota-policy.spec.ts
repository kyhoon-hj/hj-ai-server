import {
  conversationQuotaScope,
  estimateGenerationTokens,
  measuredTokenCount,
  usageOperationHash,
} from './usage-quota-policy';

describe('Monthly quota policy', () => {
  it.each([
    ['', 100],
    ['abcd', 101],
    ['abcde', 102],
    ['가나다라마', 102],
    ['😀', 101],
  ])(
    'estimates max output plus rounded UTF-16 input length for %s',
    (input, expected) => {
      expect(estimateGenerationTokens(100, input)).toBe(expected);
    },
  );

  it.each([undefined, null, -1, 0.5, NaN, Infinity, 2147483648, '10'])(
    'keeps invalid/missing usage %s unmeasured',
    (value) => {
      expect(measuredTokenCount(value)).toBeUndefined();
    },
  );

  it('distinguishes measured zero from unknown and bounds the estimate', () => {
    expect(measuredTokenCount(0)).toBe(0);
    expect(estimateGenerationTokens(2147483647, '')).toBe(2147483647);
    expect(() => estimateGenerationTokens(2147483647, 'x')).toThrow(
      'USAGE_QUOTA_INVALID_TOKEN_RESERVATION',
    );
  });

  it('isolates conversation tenant/session identities without persisting raw identifiers', () => {
    const first = conversationQuotaScope('tenant-a', 'session-a');
    const second = conversationQuotaScope('tenant-b', 'session-a');
    const third = conversationQuotaScope('tenant-a', 'session-b');
    expect(new Set([first, second, third]).size).toBe(3);
    expect(first).not.toContain('tenant-a');
    expect(first).not.toContain('session-a');
    expect(usageOperationHash('APP', '2026-09', 'same-id', first)).not.toBe(
      usageOperationHash('APP', '2026-09', 'same-id', second),
    );
  });
});
