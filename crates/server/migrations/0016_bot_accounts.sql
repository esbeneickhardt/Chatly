-- The minimal "extension point" for future plugins/integrations
-- (polls, a chess bot, a chatbot, a music-DJ bot, etc.) — a bot is
-- just an ordinary `users` row (so every existing permission check,
-- message/reaction endpoint, and membership model applies to it
-- completely unchanged) authenticated by a long-lived bearer token
-- instead of a session cookie. See UX_FEEDBACK.md and
-- `api::current_user`/`api::bots`.
ALTER TABLE users ADD COLUMN is_bot INTEGER NOT NULL DEFAULT 0;

-- Deliberately separate from `sessions`: a bot token doesn't expire on
-- its own and isn't tied to a login (no password to authenticate
-- with in the first place), so it doesn't belong in that table's
-- login-session lifecycle. Only ever one live token per bot at a
-- time — creating a new one (not implemented yet; delete + recreate
-- the bot for now) would replace it, same spirit as a session token.
CREATE TABLE bot_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    created_by INTEGER NOT NULL REFERENCES users(id)
);
