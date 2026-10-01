CREATE TABLE files (
    id          INTEGER PRIMARY KEY,
    uploader_id INTEGER NOT NULL REFERENCES users(id),
    filename    TEXT NOT NULL,
    mime        TEXT NOT NULL,
    size        INTEGER NOT NULL,
    sha256      TEXT NOT NULL,
    created_at  INTEGER NOT NULL
);

CREATE TABLE message_attachments (
    message_id  INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    file_id     INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    PRIMARY KEY (message_id, file_id)
);
CREATE INDEX idx_message_attachments_file_id ON message_attachments(file_id);

CREATE TABLE reactions (
    message_id  INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji       TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    PRIMARY KEY (message_id, user_id, emoji)
);
CREATE INDEX idx_reactions_message_id ON reactions(message_id);
