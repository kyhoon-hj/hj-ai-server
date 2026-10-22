CREATE TABLE "console_auth_state" (
    "hash" VARCHAR(64) NOT NULL PRIMARY KEY,
    "expires_at" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "console_auth_state_expires_at_idx" ON "console_auth_state"("expires_at");
CREATE TABLE "console_session" (
    "hash" VARCHAR(64) NOT NULL PRIMARY KEY,
    "membership_id" UUID NOT NULL REFERENCES "console_membership"("id") ON DELETE RESTRICT,
    "works_role" "ConsoleWorksMembershipRole" NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "console_session_membership_id_idx" ON "console_session"("membership_id");
CREATE INDEX "console_session_expires_at_idx" ON "console_session"("expires_at");
