import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Console identity foundation migration contract', () => {
  const migration = readFileSync(
    resolve(
      process.cwd(),
      'prisma/migrations/20260912090000_add_console_identity_foundation/migration.sql',
    ),
    'utf8',
  );

  it('creates immutable Works identity and organization bindings', () => {
    expect(migration).toContain(
      'console_organization_works_organization_id_key',
    );
    expect(migration).toContain('console_identity_works_user_id_key');
    expect(migration).toContain(
      'console_membership_organization_id_identity_id_key',
    );
    expect(migration).toContain(
      `"ConsoleWorksMembershipRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER')`,
    );
  });

  it('allows each AppInfo to belong to at most one organization', () => {
    expect(migration).toContain('console_app_ownership_app_info_id_key');
    expect(migration).toContain(
      'REFERENCES "appinfo"("id")\n  ON DELETE RESTRICT',
    );
    expect(migration).toContain(
      'console_app_ownership_created_by_identity_id_fkey',
    );
  });

  it('is additive and leaves login sessions and AppInfo credentials untouched', () => {
    expect(migration).not.toMatch(
      /(?:^|\n)\s*(?:DROP\b|DELETE\s+FROM\b|UPDATE\s+(?!CASCADE\b))/i,
    );
    expect(migration).not.toContain('ALTER TABLE "appinfo"');
    expect(migration).not.toMatch(/appkey|appkey_hash/i);
    expect(migration).not.toMatch(/console_session/i);
  });

  it('rejects negative organization limits at the database boundary', () => {
    expect(migration).toContain('"monthly_request_limit" >= 0');
    expect(migration).toContain('"monthly_token_limit" >= 0');
  });
});
