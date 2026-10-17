-- Web Push: one row per browser that asked to be woken up for calls, direct
-- messages and mentions while Chatly is closed. A subscription belongs to the
-- session that made it, so logging out (or revoking that session) stops the
-- device's notifications with it. `endpoint` is the push service URL the
-- browser handed out; `p256dh` and `auth` (base64url) are its keys for
-- encrypting what is sent there.

CREATE TABLE push_subscriptions (
    id          INTEGER PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id  INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    endpoint    TEXT NOT NULL UNIQUE,
    p256dh      TEXT NOT NULL,
    auth        TEXT NOT NULL,
    created_at  INTEGER NOT NULL
);
CREATE INDEX idx_push_subscriptions_user ON push_subscriptions(user_id);
