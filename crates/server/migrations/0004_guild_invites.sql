-- Invites to join a specific *guild*, distinct from the registration
-- invites in the `invites` table (which create an account on the
-- instance). A logged-in user redeems one of these to join another
-- guild without creating a new account.
CREATE TABLE guild_invites (
    id          INTEGER PRIMARY KEY,
    guild_id    INTEGER NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    code        TEXT NOT NULL UNIQUE,
    created_by  INTEGER NOT NULL REFERENCES users(id),
    created_at  INTEGER NOT NULL,
    expires_at  INTEGER,
    max_uses    INTEGER,
    uses        INTEGER NOT NULL DEFAULT 0,
    revoked     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_guild_invites_guild_id ON guild_invites(guild_id);
