ALTER TABLE "appinfo"
  ADD COLUMN IF NOT EXISTS "previous_appkey_hash" TEXT,
  ADD COLUMN IF NOT EXISTS "appkey_expires_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "previous_appkey_valid_until" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "appkey_rotated_at" TIMESTAMP(3);

UPDATE "appinfo"
SET "appkey_expires_at" = CURRENT_TIMESTAMP + INTERVAL '90 days'
WHERE ("appkey_hash" IS NOT NULL OR "appkey" IS NOT NULL)
  AND "appkey_expires_at" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "appinfo_previous_appkey_hash_key"
  ON "appinfo"("previous_appkey_hash");

CREATE TABLE IF NOT EXISTS "security_audit_event" (
  "id" UUID NOT NULL,
  "event_type" TEXT NOT NULL,
  "actor_type" TEXT NOT NULL,
  "actor_id" TEXT,
  "credential_slot" TEXT,
  "app_id" UUID,
  "appcode" TEXT,
  "request_id" TEXT,
  "method" TEXT,
  "path" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "security_audit_event_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "security_audit_event_event_type_created_at_idx"
  ON "security_audit_event"("event_type", "created_at");

CREATE INDEX IF NOT EXISTS "security_audit_event_actor_type_actor_id_created_at_idx"
  ON "security_audit_event"("actor_type", "actor_id", "created_at");

CREATE INDEX IF NOT EXISTS "security_audit_event_app_id_created_at_idx"
  ON "security_audit_event"("app_id", "created_at");

CREATE INDEX IF NOT EXISTS "security_audit_event_request_id_idx"
  ON "security_audit_event"("request_id");
