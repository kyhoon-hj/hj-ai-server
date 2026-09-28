import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Console usage threshold migration contract', () => {
  const migration = readFileSync(
    join(
      process.cwd(),
      'prisma/migrations/20260923100000_add_console_usage_threshold_event/migration.sql',
    ),
    'utf8',
  );

  it('creates an additive organization-month threshold event ledger', () => {
    expect(migration).toContain('CREATE TABLE "console_usage_threshold_event"');
    expect(migration).toContain(
      "\"ConsoleUsageThresholdMetric\" AS ENUM ('REQUESTS', 'TOKENS')",
    );
    expect(migration).toContain('console_usage_threshold_event_identity_key');
    expect(migration).toContain('CHECK ("threshold_percent" IN (70, 90, 100))');
    expect(migration).toContain('CHECK ("limit_value" > 0)');
    expect(migration).not.toMatch(/DROP\s+(TABLE|COLUMN)/i);
  });
});
