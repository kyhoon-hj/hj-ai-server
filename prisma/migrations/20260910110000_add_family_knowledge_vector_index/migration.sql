ALTER TABLE "family_knowledge_chunk"
  ADD COLUMN "embedding" DOUBLE PRECISION[] NOT NULL DEFAULT ARRAY[]::DOUBLE PRECISION[];

ALTER TABLE "family_knowledge_chunk"
  ADD CONSTRAINT "family_knowledge_chunk_embedding_dimensions_check"
  CHECK (cardinality("embedding") IN (0, 1024));

CREATE INDEX "family_knowledge_chunk_embedding_vector_hnsw_idx"
  ON "family_knowledge_chunk"
  USING hnsw ("embedding_vector" vector_cosine_ops)
  WHERE "embedding_vector" IS NOT NULL;
