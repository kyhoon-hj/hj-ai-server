-- CreateTable
CREATE TABLE "knowledge_file" (
    "id" UUID NOT NULL,
    "appcode" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "url" TEXT,
    "original_name" TEXT NOT NULL,
    "mimetype" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "checksum" TEXT,
    "status" TEXT NOT NULL DEFAULT 'uploaded',
    "error_message" TEXT,
    "metadata" JSONB,
    "indexed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_file_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_chunk" (
    "id" UUID NOT NULL,
    "file_id" UUID NOT NULL,
    "appcode" TEXT NOT NULL,
    "chunk_no" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "content_hash" TEXT,
    "token_count" INTEGER,
    "page" INTEGER,
    "metadata" JSONB,
    "embedding" DOUBLE PRECISION[] NOT NULL DEFAULT ARRAY[]::DOUBLE PRECISION[],
    "embedding_model" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_chunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_query_log" (
    "id" UUID NOT NULL,
    "appcode" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "response" TEXT,
    "matched_chunk_ids" JSONB,
    "model_id" TEXT,
    "embedding_model" TEXT,
    "responsetime" INTEGER,
    "inputtokens" INTEGER,
    "outputtokens" INTEGER,
    "totaltokens" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_query_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_file_appcode_key_key" ON "knowledge_file"("appcode", "key");

-- CreateIndex
CREATE INDEX "knowledge_file_appcode_idx" ON "knowledge_file"("appcode");

-- CreateIndex
CREATE INDEX "knowledge_file_status_idx" ON "knowledge_file"("status");

-- CreateIndex
CREATE INDEX "knowledge_file_created_at_idx" ON "knowledge_file"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_chunk_file_id_chunk_no_key" ON "knowledge_chunk"("file_id", "chunk_no");

-- CreateIndex
CREATE INDEX "knowledge_chunk_appcode_idx" ON "knowledge_chunk"("appcode");

-- CreateIndex
CREATE INDEX "knowledge_chunk_file_id_idx" ON "knowledge_chunk"("file_id");

-- CreateIndex
CREATE INDEX "knowledge_query_log_appcode_idx" ON "knowledge_query_log"("appcode");

-- CreateIndex
CREATE INDEX "knowledge_query_log_created_at_idx" ON "knowledge_query_log"("created_at");

-- AddForeignKey
ALTER TABLE "knowledge_chunk"
ADD CONSTRAINT "knowledge_chunk_file_id_fkey"
FOREIGN KEY ("file_id") REFERENCES "knowledge_file"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
