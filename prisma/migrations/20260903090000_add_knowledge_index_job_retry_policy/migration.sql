ALTER TABLE "knowledge_index_job"
ADD COLUMN "retryable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "next_attempt_at" TIMESTAMP(3);

CREATE INDEX "knowledge_index_job_status_next_attempt_at_requested_at_idx"
ON "knowledge_index_job"("status", "next_attempt_at", "requested_at");
