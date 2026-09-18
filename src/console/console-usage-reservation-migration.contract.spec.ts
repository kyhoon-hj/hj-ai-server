import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Console usage reservation migration contract', () => {
  const migration = readFileSync(
    join(
      process.cwd(),
      'prisma/migrations/20260917100000_add_console_usage_reservation/migration.sql',
    ),
    'utf8',
  );

  it('creates an additive monthly reservation ledger with safe constraints', () => {
    expect(migration).toContain('CREATE TABLE "console_usage_reservation"');
    expect(migration).toContain('"operation_key_hash" VARCHAR(64) NOT NULL');
    expect(migration).toContain('"ConsoleUsageReservationState" AS ENUM');
    expect(migration).toContain("'RESERVED'");
    expect(migration).toContain("'SETTLED'");
    expect(migration).toContain("'UNCERTAIN'");
    expect(migration).toContain('console_usage_reservation_counts_check');
    expect(migration).toContain(
      'console_usage_reservation_operation_key_hash_key',
    );
    expect(migration).not.toMatch(/DROP\s+(TABLE|COLUMN)/i);
  });
});
