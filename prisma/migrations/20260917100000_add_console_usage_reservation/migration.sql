CREATE TYPE "ConsoleUsageReservationState" AS ENUM (
  'RESERVED',
  'SETTLED',
  'UNCERTAIN'
);

CREATE TABLE "console_usage_reservation" (
  "id" UUID NOT NULL,
  "organization_id" UUID,
  "appcode" TEXT NOT NULL,
  "period_key" VARCHAR(7) NOT NULL,
  "operation_key_hash" VARCHAR(64) NOT NULL,
  "reserved_requests" INTEGER NOT NULL DEFAULT 1,
  "reserved_tokens" INTEGER NOT NULL DEFAULT 0,
  "actual_tokens" INTEGER,
  "state" "ConsoleUsageReservationState" NOT NULL DEFAULT 'RESERVED',
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "console_usage_reservation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "console_usage_reservation_period_key_check"
    CHECK ("period_key" ~ '^[0-9]{4}-[0-9]{2}$'),
  CONSTRAINT "console_usage_reservation_counts_check"
    CHECK (
      "reserved_requests" >= 0 AND
      "reserved_tokens" >= 0 AND
      ("actual_tokens" IS NULL OR "actual_tokens" >= 0)
    ),
  CONSTRAINT "console_usage_reservation_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "console_organization"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "console_usage_reservation_operation_key_hash_key"
  ON "console_usage_reservation"("operation_key_hash");
CREATE INDEX "console_usage_reservation_appcode_period_key_state_idx"
  ON "console_usage_reservation"("appcode", "period_key", "state");
CREATE INDEX "console_usage_reservation_organization_id_period_key_state_idx"
  ON "console_usage_reservation"("organization_id", "period_key", "state");
