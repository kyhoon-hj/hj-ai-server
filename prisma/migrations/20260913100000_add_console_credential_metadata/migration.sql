ALTER TABLE "appinfo"
  ADD COLUMN "appkey_id" UUID,
  ADD COLUMN "appkey_issued_by_identity_id" UUID,
  ADD COLUMN "appkey_last_used_at" TIMESTAMP(3),
  ADD COLUMN "previous_appkey_id" UUID,
  ADD COLUMN "previous_appkey_issued_by_identity_id" UUID,
  ADD COLUMN "previous_appkey_issued_at" TIMESTAMP(3),
  ADD COLUMN "previous_appkey_last_used_at" TIMESTAMP(3);

UPDATE "appinfo"
SET "appkey_id" = gen_random_uuid()
WHERE "appkey_id" IS NULL
  AND ("appkey_hash" IS NOT NULL OR "appkey" IS NOT NULL);

UPDATE "appinfo"
SET "previous_appkey_id" = gen_random_uuid()
WHERE "previous_appkey_id" IS NULL
  AND "previous_appkey_hash" IS NOT NULL;

UPDATE "appinfo"
SET "previous_appkey_issued_at" = "appkey_rotated_at"
WHERE "previous_appkey_id" IS NOT NULL
  AND "previous_appkey_issued_at" IS NULL;

CREATE UNIQUE INDEX "appinfo_appkey_id_key" ON "appinfo"("appkey_id");
CREATE UNIQUE INDEX "appinfo_previous_appkey_id_key"
  ON "appinfo"("previous_appkey_id");
CREATE INDEX "appinfo_appkey_issued_by_identity_id_idx"
  ON "appinfo"("appkey_issued_by_identity_id");
CREATE INDEX "appinfo_previous_appkey_issued_by_identity_id_idx"
  ON "appinfo"("previous_appkey_issued_by_identity_id");

ALTER TABLE "appinfo"
  ADD CONSTRAINT "appinfo_appkey_issued_by_identity_id_fkey"
  FOREIGN KEY ("appkey_issued_by_identity_id") REFERENCES "console_identity"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "appinfo"
  ADD CONSTRAINT "appinfo_previous_appkey_issued_by_identity_id_fkey"
  FOREIGN KEY ("previous_appkey_issued_by_identity_id") REFERENCES "console_identity"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
