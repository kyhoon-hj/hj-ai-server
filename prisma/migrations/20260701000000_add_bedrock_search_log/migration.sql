-- CreateTable
CREATE TABLE "bedrock_search_log" (
    "id" UUID NOT NULL,
    "appcode" TEXT NOT NULL,
    "searchword" TEXT NOT NULL,
    "searchat" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responsetime" INTEGER NOT NULL,

    CONSTRAINT "bedrock_search_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bedrock_search_log_appcode_idx" ON "bedrock_search_log"("appcode");

-- CreateIndex
CREATE INDEX "bedrock_search_log_searchat_idx" ON "bedrock_search_log"("searchat");
