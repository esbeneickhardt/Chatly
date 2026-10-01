CREATE TABLE users (
    id             INTEGER PRIMARY KEY,
    username       TEXT NOT NULL UNIQUE,
    display_name   TEXT NOT NULL,
    password_hash  TEXT NOT NULL,
    is_owner       INTEGER NOT NULL DEFAULT 0,
    can_invite     INTEGER NOT NULL DEFAULT 0,
    flags          INTEGER NOT NULL DEFAULT 0,
    created_at     INTEGER NOT NULL
);

CREATE TABLE sessions (
    id          INTEGER PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  TEXT NOT NULL UNIQUE,
    created_at  INTEGER NOT NULL,
    expires_at  INTEGER NOT NULL,
    last_seen   INTEGER NOT NULL,
    user_agent  TEXT
);
CREATE INDEX idx_sessions_user_id ON sessions(user_id);

CREATE TABLE invites (
    id          INTEGER PRIMARY KEY,
    code        TEXT NOT NULL UNIQUE,
    created_by  INTEGER NOT NULL REFERENCES users(id),
    created_at  INTEGER NOT NULL,
    expires_at  INTEGER,
    max_uses    INTEGER,
    uses        INTEGER NOT NULL DEFAULT 0,
    revoked     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE mfa_totp (
    user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    secret_enc  BLOB NOT NULL,
    enabled     INTEGER NOT NULL DEFAULT 0,
    last_step   INTEGER,
    created_at  INTEGER NOT NULL
);

CREATE TABLE mfa_recovery (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash  TEXT NOT NULL,
    used_at    INTEGER
);
CREATE INDEX idx_mfa_recovery_user_id ON mfa_recovery(user_id);
