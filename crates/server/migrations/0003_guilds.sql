CREATE TABLE guilds (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    owner_id    INTEGER NOT NULL REFERENCES users(id),
    created_at  INTEGER NOT NULL
);

-- Every guild gets an implicit @everyone role with id == guild_id
-- (Discord's own trick) so a member with no explicit row still resolves
-- permissions via this table.
CREATE TABLE roles (
    id          INTEGER PRIMARY KEY,
    guild_id    INTEGER NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    color       INTEGER NOT NULL DEFAULT 0,
    position    INTEGER NOT NULL DEFAULT 0,
    permissions INTEGER NOT NULL DEFAULT 0,
    hoist       INTEGER NOT NULL DEFAULT 0,
    mentionable INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE channels (
    id          INTEGER PRIMARY KEY,
    guild_id    INTEGER NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    kind        TEXT NOT NULL CHECK (kind IN ('text', 'voice', 'category')),
    parent_id   INTEGER REFERENCES channels(id),
    position    INTEGER NOT NULL DEFAULT 0,
    topic       TEXT
);
CREATE INDEX idx_channels_guild_id ON channels(guild_id);

CREATE TABLE members (
    guild_id    INTEGER NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    nickname    TEXT,
    joined_at   INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id)
);
CREATE INDEX idx_members_user_id ON members(user_id);

CREATE TABLE messages (
    id          INTEGER PRIMARY KEY,
    channel_id  INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    author_id   INTEGER NOT NULL REFERENCES users(id),
    content     TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    edited_at   INTEGER,
    flags       INTEGER NOT NULL DEFAULT 0,
    reply_to    INTEGER REFERENCES messages(id)
);
CREATE INDEX idx_messages_channel_id ON messages(channel_id, id DESC);
