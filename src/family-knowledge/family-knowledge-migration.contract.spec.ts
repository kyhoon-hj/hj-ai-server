import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Family knowledge migration contract', () => {
  const migration = readFileSync(
    resolve(
      process.cwd(),
      'prisma/migrations/20260910090000_add_family_knowledge_ingestion/migration.sql',
    ),
    'utf8',
  );

  it('enforces versions, pseudonymous refs, scope and payload hashes in PostgreSQL', () => {
    expect(migration).toContain('"source_version" > 0');
    expect(migration).toContain("'^[0-9a-f]{64}$'");
    expect(migration).toContain('"audience" = \'FAMILY\'');
    expect(migration).toContain('"audience" = \'MEMBER\'');
    expect(migration).toContain(
      'family_knowledge_document_appcode_source_id_key',
    );
    expect(migration).toContain('family_knowledge_event_identity_key');
  });

  it('prevents chunk/document scope drift and declares a 1024-dimension vector', () => {
    expect(migration).toContain('"embedding_vector" vector(1024)');
    expect(migration).toContain('enforce_family_knowledge_chunk_scope');
    expect(migration).toContain('IS DISTINCT FROM NEW."tenant_ref"');
    expect(migration).toContain('IS DISTINCT FROM NEW."member_ref"');
  });
});
