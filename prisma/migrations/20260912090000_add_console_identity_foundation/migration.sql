CREATE TYPE "ConsoleOrganizationStatus" AS ENUM ('ACTIVE', 'DISABLED');
CREATE TYPE "ConsoleIdentityStatus" AS ENUM ('ACTIVE', 'DISABLED');
CREATE TYPE "ConsoleMembershipStatus" AS ENUM ('ACTIVE', 'REMOVED');
CREATE TYPE "ConsoleWorksMembershipRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');

CREATE TABLE "console_organization" (
  "id" UUID NOT NULL,
  "works_organization_id" UUID NOT NULL,
  "display_name" VARCHAR(200) NOT NULL,
  "status" "ConsoleOrganizationStatus" NOT NULL DEFAULT 'ACTIVE',
  "plan_code" VARCHAR(64),
  "monthly_request_limit" INTEGER,
  "monthly_token_limit" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "last_synced_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "console_organization_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "console_organization_monthly_request_limit_check"
    CHECK ("monthly_request_limit" IS NULL OR "monthly_request_limit" >= 0),
  CONSTRAINT "console_organization_monthly_token_limit_check"
    CHECK ("monthly_token_limit" IS NULL OR "monthly_token_limit" >= 0)
);

CREATE TABLE "console_identity" (
  "id" UUID NOT NULL,
  "works_user_id" UUID NOT NULL,
  "display_name" VARCHAR(200),
  "email" VARCHAR(320),
  "profile_image_url" TEXT,
  "status" "ConsoleIdentityStatus" NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "last_synced_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "console_identity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "console_membership" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "identity_id" UUID NOT NULL,
  "works_role" "ConsoleWorksMembershipRole" NOT NULL,
  "role_version" VARCHAR(128),
  "permissions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "status" "ConsoleMembershipStatus" NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "last_synced_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "console_membership_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "console_app_ownership" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "app_info_id" UUID NOT NULL,
  "created_by_identity_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "console_app_ownership_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "console_organization_works_organization_id_key"
  ON "console_organization"("works_organization_id");
CREATE INDEX "console_organization_status_idx"
  ON "console_organization"("status");

CREATE UNIQUE INDEX "console_identity_works_user_id_key"
  ON "console_identity"("works_user_id");
CREATE INDEX "console_identity_status_idx"
  ON "console_identity"("status");

CREATE UNIQUE INDEX "console_membership_organization_id_identity_id_key"
  ON "console_membership"("organization_id", "identity_id");
CREATE INDEX "console_membership_identity_id_status_idx"
  ON "console_membership"("identity_id", "status");
CREATE INDEX "console_membership_organization_id_status_idx"
  ON "console_membership"("organization_id", "status");

CREATE UNIQUE INDEX "console_app_ownership_app_info_id_key"
  ON "console_app_ownership"("app_info_id");
CREATE INDEX "console_app_ownership_organization_id_idx"
  ON "console_app_ownership"("organization_id");
CREATE INDEX "console_app_ownership_created_by_identity_id_idx"
  ON "console_app_ownership"("created_by_identity_id");

ALTER TABLE "console_membership"
  ADD CONSTRAINT "console_membership_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "console_organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "console_membership"
  ADD CONSTRAINT "console_membership_identity_id_fkey"
  FOREIGN KEY ("identity_id") REFERENCES "console_identity"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "console_app_ownership"
  ADD CONSTRAINT "console_app_ownership_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "console_organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "console_app_ownership"
  ADD CONSTRAINT "console_app_ownership_app_info_id_fkey"
  FOREIGN KEY ("app_info_id") REFERENCES "appinfo"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "console_app_ownership"
  ADD CONSTRAINT "console_app_ownership_created_by_identity_id_fkey"
  FOREIGN KEY ("created_by_identity_id") REFERENCES "console_identity"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
