CREATE TABLE "knowledge_index_job" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "file_id" UUID NOT NULL,
    "appcode" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "idempotency_key" TEXT,
    "error_code" TEXT,
    "error_message" TEXT,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "lease_expires_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_index_job_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "knowledge_index_job_appcode_idempotency_key_key"
ON "knowledge_index_job"("appcode", "idempotency_key");

CREATE INDEX "knowledge_index_job_appcode_status_requested_at_idx"
ON "knowledge_index_job"("appcode", "status", "requested_at");

CREATE INDEX "knowledge_index_job_file_id_status_idx"
ON "knowledge_index_job"("file_id", "status");

CREATE INDEX "knowledge_index_job_status_lease_expires_at_idx"
ON "knowledge_index_job"("status", "lease_expires_at");

ALTER TABLE "knowledge_index_job"
ADD CONSTRAINT "knowledge_index_job_file_id_fkey"
FOREIGN KEY ("file_id") REFERENCES "knowledge_file"("id") ON DELETE CASCADE ON UPDATE CASCADE;
