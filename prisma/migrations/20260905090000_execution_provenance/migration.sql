-- Nullable additions preserve historical rows without inventing past versions.
ALTER TABLE "knowledge_chunk" ADD COLUMN "index_provenance" JSONB;
ALTER TABLE "knowledge_query_log" ADD COLUMN "execution" JSONB;
