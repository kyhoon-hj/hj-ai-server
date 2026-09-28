CREATE TYPE "ConsoleUsageThresholdMetric" AS ENUM ('REQUESTS', 'TOKENS');

CREATE TABLE "console_usage_threshold_event" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "period_key" VARCHAR(7) NOT NULL,
  "metric" "ConsoleUsageThresholdMetric" NOT NULL,
  "threshold_percent" INTEGER NOT NULL,
  "limit_value" INTEGER NOT NULL,
  "observed_value" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "console_usage_threshold_event_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "console_usage_threshold_event_period_key_check"
    CHECK ("period_key" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT "console_usage_threshold_event_threshold_check"
    CHECK ("threshold_percent" IN (70, 90, 100)),
  CONSTRAINT "console_usage_threshold_event_limit_check"
    CHECK ("limit_value" > 0),
  CONSTRAINT "console_usage_threshold_event_observed_check"
    CHECK ("observed_value" >= 0),
  CONSTRAINT "console_usage_threshold_event_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "console_organization"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "console_usage_threshold_event_identity_key"
  ON "console_usage_threshold_event"(
    "organization_id",
    "period_key",
    "metric",
    "threshold_percent"
  );

CREATE INDEX "console_usage_threshold_event_period_key_created_at_idx"
  ON "console_usage_threshold_event"("period_key", "created_at");
