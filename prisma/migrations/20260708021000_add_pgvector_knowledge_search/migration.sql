CREATE INDEX IF NOT EXISTS "knowledge_chunk_embedding_model_idx"
  ON "knowledge_chunk"("embedding_model");

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_available_extensions
    WHERE name = 'vector'
  ) THEN
    CREATE EXTENSION IF NOT EXISTS vector;

    ALTER TABLE "knowledge_chunk"
      ADD COLUMN IF NOT EXISTS "embedding_vector" vector(1024);

    UPDATE "knowledge_chunk"
    SET "embedding_vector" = ('[' || array_to_string("embedding", ',') || ']')::vector
    WHERE "embedding_vector" IS NULL
      AND cardinality("embedding") = 1024;

    CREATE INDEX IF NOT EXISTS "knowledge_chunk_embedding_vector_hnsw_idx"
      ON "knowledge_chunk"
      USING hnsw ("embedding_vector" vector_cosine_ops)
      WHERE "embedding_vector" IS NOT NULL;
  END IF;
END
$$;
