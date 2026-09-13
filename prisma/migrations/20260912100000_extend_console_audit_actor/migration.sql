ALTER TABLE "security_audit_event"
  ADD COLUMN "console_identity_id" UUID,
  ADD COLUMN "console_organization_id" UUID,
  ADD COLUMN "works_user_id" UUID,
  ADD COLUMN "works_organization_id" UUID,
  ADD COLUMN "console_session_id_hash" VARCHAR(64);

ALTER TABLE "security_audit_event"
  ADD CONSTRAINT "security_audit_event_console_session_id_hash_check"
  CHECK (
    "console_session_id_hash" IS NULL OR
    "console_session_id_hash" ~ '^[0-9a-f]{64}$'
  );

CREATE INDEX "security_audit_event_console_organization_id_created_at_idx"
  ON "security_audit_event"("console_organization_id", "created_at");
CREATE INDEX "security_audit_event_console_identity_id_created_at_idx"
  ON "security_audit_event"("console_identity_id", "created_at");
CREATE INDEX "security_audit_event_works_user_id_created_at_idx"
  ON "security_audit_event"("works_user_id", "created_at");
CREATE INDEX "security_audit_event_console_session_id_hash_idx"
  ON "security_audit_event"("console_session_id_hash");

ALTER TABLE "security_audit_event"
  ADD CONSTRAINT "security_audit_event_console_identity_id_fkey"
  FOREIGN KEY ("console_identity_id") REFERENCES "console_identity"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "security_audit_event"
  ADD CONSTRAINT "security_audit_event_console_organization_id_fkey"
  FOREIGN KEY ("console_organization_id") REFERENCES "console_organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
