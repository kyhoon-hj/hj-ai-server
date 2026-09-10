CREATE TYPE "FamilyKnowledgeAudience" AS ENUM ('FAMILY', 'MEMBER');
CREATE TYPE "FamilyKnowledgeSourceType" AS ENUM ('TEXT', 'PHOTO_DESCRIPTION');
CREATE TYPE "FamilyKnowledgeSensitivity" AS ENUM ('NON_SENSITIVE', 'SENSITIVE');
CREATE TYPE "FamilyKnowledgeDocumentStatus" AS ENUM ('ACTIVE', 'DELETED');
CREATE TYPE "FamilyKnowledgeOperation" AS ENUM ('UPSERT', 'DELETE');
CREATE TYPE "FamilyKnowledgeEventStatus" AS ENUM (
  'QUEUED',
  'PROCESSING',
  'RETRY',
  'SUCCEEDED',
  'FAILED'
);

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE "family_knowledge_document" (
  "id" UUID NOT NULL,
  "appcode" TEXT NOT NULL,
  "tenant_ref" VARCHAR(64) NOT NULL,
  "member_ref" VARCHAR(64),
  "audience" "FamilyKnowledgeAudience" NOT NULL,
  "source_id" VARCHAR(191) NOT NULL,
  "source_version" INTEGER NOT NULL,
  "source_type" "FamilyKnowledgeSourceType" NOT NULL,
  "sensitivity" "FamilyKnowledgeSensitivity" NOT NULL,
  "status" "FamilyKnowledgeDocumentStatus" NOT NULL DEFAULT 'ACTIVE',
  "title" VARCHAR(200),
  "content" TEXT,
  "published_at" TIMESTAMP(3) NOT NULL,
  "indexed_at" TIMESTAMP(3),
  "embedding_model" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "deleted_at" TIMESTAMP(3),

  CONSTRAINT "family_knowledge_document_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "family_knowledge_document_source_version_check"
    CHECK ("source_version" > 0),
  CONSTRAINT "family_knowledge_document_tenant_ref_check"
    CHECK ("tenant_ref" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "family_knowledge_document_scope_check"
    CHECK (
      ("audience" = 'FAMILY' AND "member_ref" IS NULL) OR
      ("audience" = 'MEMBER' AND "member_ref" ~ '^[0-9a-f]{64}$')
    ),
  CONSTRAINT "family_knowledge_document_status_check"
    CHECK (
      ("status" = 'ACTIVE' AND "content" IS NOT NULL AND "deleted_at" IS NULL) OR
      ("status" = 'DELETED' AND "content" IS NULL AND "title" IS NULL AND "deleted_at" IS NOT NULL)
    )
);

CREATE TABLE "family_knowledge_chunk" (
  "id" UUID NOT NULL,
  "document_id" UUID NOT NULL,
  "appcode" TEXT NOT NULL,
  "tenant_ref" VARCHAR(64) NOT NULL,
  "member_ref" VARCHAR(64),
  "audience" "FamilyKnowledgeAudience" NOT NULL,
  "source_version" INTEGER NOT NULL,
  "chunk_no" INTEGER NOT NULL,
  "content" TEXT NOT NULL,
  "content_hash" VARCHAR(64) NOT NULL,
  "embedding_vector" vector(1024),
  "embedding_model" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "family_knowledge_chunk_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "family_knowledge_chunk_document_id_fkey"
    FOREIGN KEY ("document_id") REFERENCES "family_knowledge_document"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "family_knowledge_chunk_source_version_check"
    CHECK ("source_version" > 0),
  CONSTRAINT "family_knowledge_chunk_chunk_no_check"
    CHECK ("chunk_no" >= 0),
  CONSTRAINT "family_knowledge_chunk_tenant_ref_check"
    CHECK ("tenant_ref" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "family_knowledge_chunk_member_ref_check"
    CHECK ("member_ref" IS NULL OR "member_ref" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "family_knowledge_chunk_content_hash_check"
    CHECK ("content_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "family_knowledge_chunk_scope_check"
    CHECK (
      ("audience" = 'FAMILY' AND "member_ref" IS NULL) OR
      ("audience" = 'MEMBER' AND "member_ref" IS NOT NULL)
    )
);

CREATE TABLE "family_knowledge_event" (
  "id" UUID NOT NULL,
  "appcode" TEXT NOT NULL,
  "source_id" VARCHAR(191) NOT NULL,
  "source_version" INTEGER NOT NULL,
  "operation" "FamilyKnowledgeOperation" NOT NULL,
  "payload_hash" VARCHAR(64) NOT NULL,
  "status" "FamilyKnowledgeEventStatus" NOT NULL DEFAULT 'QUEUED',
  "result_code" VARCHAR(64),
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 3,
  "next_attempt_at" TIMESTAMP(3),
  "lease_expires_at" TIMESTAMP(3),
  "error_code" VARCHAR(128),
  "retryable" BOOLEAN NOT NULL DEFAULT false,
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "family_knowledge_event_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "family_knowledge_event_source_version_check"
    CHECK ("source_version" > 0),
  CONSTRAINT "family_knowledge_event_payload_hash_check"
    CHECK ("payload_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "family_knowledge_event_attempts_check"
    CHECK (
      "attempt_count" >= 0 AND
      "max_attempts" BETWEEN 1 AND 10 AND
      "attempt_count" <= "max_attempts"
    )
);

CREATE UNIQUE INDEX "family_knowledge_document_appcode_source_id_key"
  ON "family_knowledge_document"("appcode", "source_id");
CREATE INDEX "family_knowledge_document_scope_idx"
  ON "family_knowledge_document"("appcode", "tenant_ref", "audience", "member_ref", "status");
CREATE INDEX "family_knowledge_document_status_indexed_at_idx"
  ON "family_knowledge_document"("status", "indexed_at");

CREATE UNIQUE INDEX "family_knowledge_chunk_document_version_chunk_key"
  ON "family_knowledge_chunk"("document_id", "source_version", "chunk_no");
CREATE INDEX "family_knowledge_chunk_scope_model_idx"
  ON "family_knowledge_chunk"("appcode", "tenant_ref", "audience", "member_ref", "embedding_model");
CREATE INDEX "family_knowledge_chunk_document_version_idx"
  ON "family_knowledge_chunk"("document_id", "source_version");

CREATE UNIQUE INDEX "family_knowledge_event_identity_key"
  ON "family_knowledge_event"("appcode", "source_id", "source_version", "operation");
CREATE INDEX "family_knowledge_event_queue_idx"
  ON "family_knowledge_event"("status", "next_attempt_at", "created_at");
CREATE INDEX "family_knowledge_event_lease_idx"
  ON "family_knowledge_event"("status", "lease_expires_at");

CREATE OR REPLACE FUNCTION enforce_family_knowledge_chunk_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent "family_knowledge_document"%ROWTYPE;
BEGIN
  SELECT * INTO parent
  FROM "family_knowledge_document"
  WHERE "id" = NEW."document_id";

  IF NOT FOUND OR
     parent."appcode" IS DISTINCT FROM NEW."appcode" OR
     parent."tenant_ref" IS DISTINCT FROM NEW."tenant_ref" OR
     parent."audience" IS DISTINCT FROM NEW."audience" OR
     parent."member_ref" IS DISTINCT FROM NEW."member_ref" THEN
    RAISE EXCEPTION 'family knowledge chunk scope does not match its document'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "family_knowledge_chunk_scope_match"
BEFORE INSERT OR UPDATE OF "document_id", "appcode", "tenant_ref", "audience", "member_ref"
ON "family_knowledge_chunk"
FOR EACH ROW EXECUTE FUNCTION enforce_family_knowledge_chunk_scope();
