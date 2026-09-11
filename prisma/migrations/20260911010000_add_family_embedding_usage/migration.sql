CREATE TYPE "FamilyEmbeddingUsageKind" AS ENUM ('INDEX', 'SEARCH');
CREATE TYPE "FamilyEmbeddingUsageState" AS ENUM ('RESERVED', 'SUCCEEDED', 'UNCERTAIN');

CREATE TABLE "family_embedding_usage" (
  "id" UUID NOT NULL,
  "appcode" TEXT NOT NULL,
  "period_key" VARCHAR(7) NOT NULL,
  "operation_key_hash" VARCHAR(64) NOT NULL,
  "kind" "FamilyEmbeddingUsageKind" NOT NULL,
  "state" "FamilyEmbeddingUsageState" NOT NULL DEFAULT 'RESERVED',
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "family_embedding_usage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "family_embedding_usage_period_key_check"
    CHECK ("period_key" ~ '^[0-9]{4}-[0-9]{2}$')
);

CREATE UNIQUE INDEX "family_embedding_usage_operation_key_hash_key"
  ON "family_embedding_usage"("operation_key_hash");
CREATE INDEX "family_embedding_usage_appcode_period_key_created_at_idx"
  ON "family_embedding_usage"("appcode", "period_key", "created_at");
