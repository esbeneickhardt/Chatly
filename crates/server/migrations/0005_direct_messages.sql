-- MANUAL_TRANSACTION
-- Direct messages, modelled as channels with no guild and an explicit
-- member list (per PLAN.md Phase 3.2), reusing the same `messages`
-- table and REST/gateway paths guild channels already use.
--
-- `channels.guild_id` was NOT NULL; SQLite can't drop a NOT NULL
-- constraint in place, so the table has to be rebuilt. That rebuild
-- needs `PRAGMA foreign_keys=OFF` around it: with FKs on, plain
-- `DROP TABLE channels` silently cascade-deletes every row in
-- `messages` (which references it with ON DELETE CASCADE) even though
-- nothing asked to delete a message — confirmed empirically, not
-- assumed. `PRAGMA foreign_keys` is also a no-op inside a transaction,
-- which is why this migration is marked MANUAL_TRANSACTION: the
-- migration runner skips its usual automatic BEGIN/COMMIT wrapping so
-- this file can control transaction boundaries itself.
PRAGMA foreign_keys = OFF;

BEGIN;

CREATE TABLE channels_new (
    id          INTEGER PRIMARY KEY,
    guild_id    INTEGER REFERENCES guilds(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    kind        TEXT NOT NULL CHECK (kind IN ('text', 'voice', 'category')),
    parent_id   INTEGER REFERENCES channels(id),
    position    INTEGER NOT NULL DEFAULT 0,
    topic       TEXT
);
INSERT INTO channels_new SELECT id, guild_id, name, kind, parent_id, position, topic FROM channels;
DROP TABLE channels;
ALTER TABLE channels_new RENAME TO channels;
CREATE INDEX idx_channels_guild_id ON channels(guild_id);

CREATE TABLE dm_participants (
    channel_id  INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (channel_id, user_id)
);
CREATE INDEX idx_dm_participants_user_id ON dm_participants(user_id);

COMMIT;

PRAGMA foreign_keys = ON;
