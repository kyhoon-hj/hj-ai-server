ALTER TABLE "console_usage_reservation"
  ADD COLUMN "usage_log_source" VARCHAR(32),
  ADD COLUMN "usage_log_id" UUID,
  ADD COLUMN "recovery_requests" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "recovery_tokens" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "recovery_key" UUID,
  ADD COLUMN "recovery_hash" VARCHAR(64),
  ADD CONSTRAINT "console_usage_reservation_recovery_counts_check"
    CHECK ("recovery_requests" BETWEEN 0 AND 1 AND "recovery_tokens" >= 0),
  ADD CONSTRAINT "console_usage_reservation_log_reference_check"
    CHECK (("usage_log_source" IS NULL AND "usage_log_id" IS NULL) OR
      ("usage_log_source" IS NOT NULL AND "usage_log_id" IS NOT NULL AND
       "usage_log_source" IN ('bedrock', 'knowledge', 'conversation')));

CREATE UNIQUE INDEX "console_usage_reservation_usage_log_source_usage_log_id_key"
  ON "console_usage_reservation"("usage_log_source", "usage_log_id");
CREATE UNIQUE INDEX "console_usage_reservation_recovery_key_key"
  ON "console_usage_reservation"("recovery_key");
CREATE INDEX "console_usage_reservation_state_updated_at_id_idx"
  ON "console_usage_reservation"("state", "updated_at", "id");
