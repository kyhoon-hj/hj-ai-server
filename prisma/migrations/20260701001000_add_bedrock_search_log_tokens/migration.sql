-- AlterTable
ALTER TABLE "bedrock_search_log"
ADD COLUMN "inputtokens" INTEGER,
ADD COLUMN "outputtokens" INTEGER,
ADD COLUMN "totaltokens" INTEGER;
