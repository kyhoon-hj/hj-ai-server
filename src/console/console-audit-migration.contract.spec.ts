import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Console audit actor migration contract', () => {
  const migration = readFileSync(
    resolve(
      process.cwd(),
      'prisma/migrations/20260912100000_extend_console_audit_actor/migration.sql',
    ),
    'utf8',
  );

  it('adds Console and immutable Works actor scope without replacing old fields', () => {
    expect(migration).toContain('"console_identity_id" UUID');
    expect(migration).toContain('"console_organization_id" UUID');
    expect(migration).toContain('"works_user_id" UUID');
    expect(migration).toContain('"works_organization_id" UUID');
    expect(migration).not.toMatch(/DROP\s+COLUMN/i);
  });

  it('stores only a bounded SHA-256-shaped Console session reference', () => {
    expect(migration).toContain('"console_session_id_hash" VARCHAR(64)');
    expect(migration).toContain("'^[0-9a-f]{64}$'");
    expect(migration).not.toMatch(/"console_session_id"\s/i);
    expect(migration).not.toMatch(/session_token/i);
  });

  it('indexes organization, identity, Works user and session audit lookups', () => {
    expect(migration).toContain(
      'security_audit_event_console_organization_id_created_at_idx',
    );
    expect(migration).toContain(
      'security_audit_event_console_identity_id_created_at_idx',
    );
    expect(migration).toContain(
      'security_audit_event_works_user_id_created_at_idx',
    );
    expect(migration).toContain(
      'security_audit_event_console_session_id_hash_idx',
    );
  });
});
