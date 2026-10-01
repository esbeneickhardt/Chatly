-- Finishes the RBAC plumbing `roles` (migration 0003) was already
-- shaped for: a member's assignment to a role beyond the implicit
-- `@everyone` one every member already gets via `roles.id ==
-- guild_id`, and per-channel allow/deny overwrites for a role or a
-- specific member. See `protocol::permissions::resolve` for how these
-- combine — that function (and its full test suite) already existed
-- and needed no changes; only the data to feed it was missing.

CREATE TABLE member_roles (
    guild_id    INTEGER NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id     INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    PRIMARY KEY (guild_id, user_id, role_id)
);
CREATE INDEX idx_member_roles_user_id ON member_roles(user_id);
CREATE INDEX idx_member_roles_role_id ON member_roles(role_id);

-- Exactly one of role_id/user_id is set per row — a role-wide overwrite
-- or a member-specific one, matching `protocol::permissions::Overwrite`
-- usage in `resolve`. Enforced by the partial unique indexes below
-- rather than a second table, so "the" overwrite for a given
-- channel+role or channel+user is trivially a single upsert-able row.
CREATE TABLE channel_overwrites (
    channel_id  INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    role_id     INTEGER REFERENCES roles(id) ON DELETE CASCADE,
    user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
    allow       INTEGER NOT NULL DEFAULT 0,
    deny        INTEGER NOT NULL DEFAULT 0,
    CHECK ((role_id IS NULL) != (user_id IS NULL))
);
CREATE UNIQUE INDEX idx_channel_overwrites_role
    ON channel_overwrites(channel_id, role_id) WHERE role_id IS NOT NULL;
CREATE UNIQUE INDEX idx_channel_overwrites_user
    ON channel_overwrites(channel_id, user_id) WHERE user_id IS NOT NULL;
