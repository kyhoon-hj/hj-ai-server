DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "appinfo"
    GROUP BY "appcode"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot add appinfo.appcode unique constraint: duplicate appcode values exist. Run the documented preflight query and resolve ownership before retrying.';
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS "appinfo_appcode_key"
  ON "appinfo"("appcode");

DROP INDEX IF EXISTS "appinfo_appcode_idx";

DO $$
BEGIN
  CREATE TYPE "KnowledgeAccessLevel" AS ENUM (
    'PUBLIC',
    'INTERNAL',
    'RESTRICTED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE "KnowledgeBusinessStatus" AS ENUM (
    'DRAFT',
    'PUBLISHED',
    'RETIRED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

ALTER TABLE "appinfo"
  ADD COLUMN IF NOT EXISTS "allowed_access_levels"
    "KnowledgeAccessLevel"[] NOT NULL DEFAULT ARRAY[]::"KnowledgeAccessLevel"[];

ALTER TABLE "knowledge_file"
  ADD COLUMN IF NOT EXISTS "access_level"
    "KnowledgeAccessLevel" NOT NULL DEFAULT 'INTERNAL',
  ADD COLUMN IF NOT EXISTS "business_status"
    "KnowledgeBusinessStatus" NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN IF NOT EXISTS "product_codes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "effective_from" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "effective_to" TIMESTAMP(3);

ALTER TABLE "knowledge_query_log"
  ADD COLUMN IF NOT EXISTS "request_id" TEXT;

CREATE INDEX IF NOT EXISTS "knowledge_file_appcode_status_access_level_business_status_idx"
  ON "knowledge_file"("appcode", "status", "access_level", "business_status");

CREATE INDEX IF NOT EXISTS "knowledge_file_effective_from_idx"
  ON "knowledge_file"("effective_from");

CREATE INDEX IF NOT EXISTS "knowledge_file_effective_to_idx"
  ON "knowledge_file"("effective_to");

CREATE INDEX IF NOT EXISTS "knowledge_file_product_codes_idx"
  ON "knowledge_file" USING GIN ("product_codes");

CREATE INDEX IF NOT EXISTS "knowledge_query_log_request_id_idx"
  ON "knowledge_query_log"("request_id");
