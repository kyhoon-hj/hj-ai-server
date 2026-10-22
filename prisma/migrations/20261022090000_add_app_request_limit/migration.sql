ALTER TABLE "appinfo" ADD COLUMN "monthly_request_limit" INTEGER;
ALTER TABLE "appinfo" ADD CONSTRAINT "appinfo_monthly_request_limit_nonnegative"
  CHECK ("monthly_request_limit" IS NULL OR "monthly_request_limit" >= 0);
