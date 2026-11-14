-- v4.4 account-security extension. Safe to run more than once.
-- Adds account lockout, last-login tracking and forced password change metadata.
ALTER TABLE IF EXISTS "AppUsers"
    ADD COLUMN IF NOT EXISTS "FailedLoginCount" integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "LockoutUntil" timestamp with time zone NULL,
    ADD COLUMN IF NOT EXISTS "LastLoginAt" timestamp with time zone NULL,
    ADD COLUMN IF NOT EXISTS "LastPasswordChangedAt" timestamp with time zone NULL,
    ADD COLUMN IF NOT EXISTS "MustChangePassword" boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "TokenVersion" integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "IX_AppUsers_LockoutUntil" ON "AppUsers" ("LockoutUntil");
CREATE INDEX IF NOT EXISTS "IX_AuditLogs_Username_CreatedAt" ON "AuditLogs" ("Username", "CreatedAt" DESC);
