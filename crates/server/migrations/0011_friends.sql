-- Friend invites: a shareable code/link/QR a user generates so someone
-- else can add them as a friend by redeeming it — deliberately not a
-- "search for a username and send them a request" flow (see
-- api::friends), so nobody can be added as a friend without their own
-- action of following a link they were given out-of-band. Otherwise
-- structured just like guild_invites (0004).
CREATE TABLE friend_invites (
    id          INTEGER PRIMARY KEY,
    code        TEXT NOT NULL UNIQUE,
    created_by  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  INTEGER NOT NULL,
    expires_at  INTEGER,
    max_uses    INTEGER,
    uses        INTEGER NOT NULL DEFAULT 0,
    revoked     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_friend_invites_created_by ON friend_invites(created_by);

-- An undirected friendship, stored once per pair with a canonical
-- ordering (user_a_id < user_b_id) so there's no duplicate row in the
-- other direction to keep in sync.
CREATE TABLE friendships (
    user_a_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_b_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  INTEGER NOT NULL,
    PRIMARY KEY (user_a_id, user_b_id),
    CHECK (user_a_id < user_b_id)
);
