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
  const vectorMigration = readFileSync(
    resolve(
      process.cwd(),
      'prisma/migrations/20260910110000_add_family_knowledge_vector_index/migration.sql',
    ),
    'utf8',
  );
  const conversationMetricMigration = readFileSync(
    resolve(
      process.cwd(),
      'prisma/migrations/20260910140000_add_family_conversation_metric/migration.sql',
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
    expect(vectorMigration).toContain('cardinality("embedding") IN (0, 1024)');
    expect(vectorMigration).toContain('USING hnsw');
    expect(vectorMigration).toContain('vector_cosine_ops');
  });

  it('stores only content-free Family conversation metrics', () => {
    expect(conversationMetricMigration).toContain('"request_id" UUID');
    expect(conversationMetricMigration).toContain('"result_count" INTEGER');
    expect(conversationMetricMigration).toContain('"input_tokens" INTEGER');
    expect(conversationMetricMigration).not.toMatch(
      /"(?:question|response|content|tenant_ref|member_ref)"/,
    );
  });
});
