-- Phase 0 bootstrap migration. Deliberately minimal: proves the migration
-- runner works end to end. Phase 1 adds users/sessions/invites/mfa here.
CREATE TABLE IF NOT EXISTS instance_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
