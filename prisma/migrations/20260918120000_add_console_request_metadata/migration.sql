-- Historical metadata stays NULL: do not invent request IDs, models or outcomes.
ALTER TABLE bedrock_search_log
  ADD COLUMN request_id TEXT,
  ADD COLUMN endpoint TEXT,
  ADD COLUMN status VARCHAR(32),
  ADD COLUMN result VARCHAR(80),
  ADD COLUMN error_code VARCHAR(80),
  ADD COLUMN failure_stage VARCHAR(32),
  ADD COLUMN model_id TEXT;
CREATE INDEX bedrock_search_log_request_id_idx ON bedrock_search_log(request_id);
ALTER TABLE family_conversation_metric
  ADD COLUMN endpoint TEXT,
  ADD COLUMN result VARCHAR(80),
  ADD COLUMN error_code VARCHAR(80),
  ADD COLUMN failure_stage VARCHAR(32),
  ADD COLUMN model_id TEXT;
