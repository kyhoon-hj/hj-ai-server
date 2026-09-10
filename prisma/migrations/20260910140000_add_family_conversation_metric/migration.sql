CREATE TABLE "family_conversation_metric" (
  "id" UUID NOT NULL,
  "appcode" TEXT NOT NULL,
  "request_id" UUID NOT NULL,
  "policy_version" VARCHAR(64) NOT NULL,
  "status" VARCHAR(32) NOT NULL,
  "latency_ms" INTEGER NOT NULL,
  "input_tokens" INTEGER,
  "output_tokens" INTEGER,
  "total_tokens" INTEGER,
  "result_count" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "family_conversation_metric_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "family_conversation_metric_latency_check" CHECK ("latency_ms" >= 0),
  CONSTRAINT "family_conversation_metric_result_count_check" CHECK ("result_count" BETWEEN 0 AND 5),
  CONSTRAINT "family_conversation_metric_token_check" CHECK (
    ("input_tokens" IS NULL OR "input_tokens" >= 0) AND
    ("output_tokens" IS NULL OR "output_tokens" >= 0) AND
    ("total_tokens" IS NULL OR "total_tokens" >= 0)
  )
);

CREATE INDEX "family_conversation_metric_appcode_created_at_idx"
  ON "family_conversation_metric"("appcode", "created_at");
CREATE INDEX "family_conversation_metric_request_id_idx"
  ON "family_conversation_metric"("request_id");
