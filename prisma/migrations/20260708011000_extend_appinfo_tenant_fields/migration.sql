ALTER TABLE "appinfo"
  ADD COLUMN IF NOT EXISTS "appkey_hash" TEXT,
  ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS "s3_prefix" TEXT,
  ADD COLUMN IF NOT EXISTS "default_model_id" TEXT,
  ADD COLUMN IF NOT EXISTS "default_embedding_model_id" TEXT,
  ADD COLUMN IF NOT EXISTS "system_prompt" TEXT,
  ADD COLUMN IF NOT EXISTS "max_storage_mb" INTEGER,
  ADD COLUMN IF NOT EXISTS "monthly_token_limit" INTEGER,
  ADD COLUMN IF NOT EXISTS "metadata" JSONB;

ALTER TABLE "appinfo"
  ALTER COLUMN "appkey" DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "appinfo_appkey_hash_key"
  ON "appinfo"("appkey_hash");

CREATE INDEX IF NOT EXISTS "appinfo_appcode_idx"
  ON "appinfo"("appcode");

CREATE INDEX IF NOT EXISTS "appinfo_status_idx"
  ON "appinfo"("status");
