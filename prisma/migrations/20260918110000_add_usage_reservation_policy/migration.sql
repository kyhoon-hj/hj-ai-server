ALTER TABLE "console_usage_reservation"
  ADD COLUMN "operation_scope" VARCHAR(128) NOT NULL DEFAULT 'legacy',
  ADD COLUMN "tokens_reserved_at" TIMESTAMP(3);

-- Preserve the legacy hash contract and prevent a second reservation on rows
-- that already held a positive token estimate before this migration.
UPDATE "console_usage_reservation"
SET "tokens_reserved_at" = "created_at"
WHERE "reserved_tokens" > 0;

-- Only durable references written by the previous recovery migration qualify.
-- Keep unknown usage and unlinked historical reservations unchanged.
WITH measured_logs AS (
  SELECT id, 'bedrock' AS source, totaltokens AS tokens FROM bedrock_search_log
  UNION ALL
  SELECT id, 'knowledge', totaltokens FROM knowledge_query_log
  UNION ALL
  SELECT id, 'conversation', total_tokens FROM family_conversation_metric
)
UPDATE "console_usage_reservation" AS reservation
SET "reserved_tokens" = 0,
    "actual_tokens" = log.tokens,
    "updated_at" = CURRENT_TIMESTAMP
FROM measured_logs log
WHERE reservation.usage_log_source = log.source
  AND reservation.usage_log_id = log.id
  AND reservation.state IN ('RESERVED', 'UNCERTAIN')
  AND log.tokens >= 0;
