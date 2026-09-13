import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Console credential metadata migration contract', () => {
  const migration = readFileSync(
    resolve(
      process.cwd(),
      'prisma/migrations/20260913100000_add_console_credential_metadata/migration.sql',
    ),
    'utf8',
  );

  it('adds IDs, issuer attribution and last-used timestamps for both slots', () => {
    expect(migration).toContain('"appkey_id" UUID');
    expect(migration).toContain('"appkey_issued_by_identity_id" UUID');
    expect(migration).toContain('"appkey_last_used_at" TIMESTAMP(3)');
    expect(migration).toContain('"previous_appkey_id" UUID');
    expect(migration).toContain('"previous_appkey_issued_by_identity_id" UUID');
    expect(migration).toContain('"previous_appkey_issued_at" TIMESTAMP(3)');
    expect(migration).toContain('"previous_appkey_last_used_at" TIMESTAMP(3)');
  });

  it('backfills opaque IDs without changing existing key material', () => {
    expect(migration).toContain('SET "appkey_id" = gen_random_uuid()');
    expect(migration).toContain('SET "previous_appkey_id" = gen_random_uuid()');
    expect(migration).toContain(
      'SET "previous_appkey_issued_at" = "appkey_rotated_at"',
    );
    expect(migration).not.toMatch(/SET\s+"appkey(?:_hash)?"\s*=/i);
    expect(migration).not.toMatch(/DROP\s+COLUMN/i);
  });

  it('enforces unique credential IDs and issuer identity references', () => {
    expect(migration).toContain('appinfo_appkey_id_key');
    expect(migration).toContain('appinfo_previous_appkey_id_key');
    expect(migration).toContain('appinfo_appkey_issued_by_identity_id_fkey');
    expect(migration).toContain(
      'appinfo_previous_appkey_issued_by_identity_id_fkey',
    );
  });
});
