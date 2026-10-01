-- Replaces the invite-link/QR friend system (0011) with a real
-- request/accept flow: search someone by username, send them a
-- request, nothing happens until they accept it. `friend_invites` is
-- dropped outright — nothing references it, and the new flow replaces
-- its only purpose.
DROP TABLE friend_invites;

-- One row per pending request, directional (unlike `friendships`,
-- which is undirected/canonical-ordered) since who sent it matters —
-- the recipient can accept/decline, the sender can cancel, and only
-- one of those pairings is valid per row. The UNIQUE constraint stops
-- spamming the same person with repeat requests; a mutual pair
-- (A→B and B→A both pending at once) is resolved in application code
-- by treating the second request as an instant accept, not blocked
-- here.
CREATE TABLE friend_requests (
    id           INTEGER PRIMARY KEY,
    sender_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at   INTEGER NOT NULL,
    UNIQUE (sender_id, recipient_id)
);
CREATE INDEX idx_friend_requests_recipient ON friend_requests(recipient_id);
CREATE INDEX idx_friend_requests_sender ON friend_requests(sender_id);

-- Per-viewer pin on a DM channel (a friend's conversation, a group,
-- or a self-DM) — keeps it pinned to the top of that one user's own
-- DM list regardless of recency, which is why this is keyed by
-- (user_id, channel_id) rather than being a property of the channel
-- itself; one participant pinning a conversation shouldn't pin it for
-- everyone else in it too.
CREATE TABLE pinned_dms (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    pinned_at  INTEGER NOT NULL,
    PRIMARY KEY (user_id, channel_id)
);

-- Lets a user opt out of receiving friend requests entirely — a
-- request against someone with this off is rejected outright (the
-- sender is told plainly, not left guessing), rather than silently
-- swallowed.
ALTER TABLE users ADD COLUMN accepts_friend_requests INTEGER NOT NULL DEFAULT 1;
