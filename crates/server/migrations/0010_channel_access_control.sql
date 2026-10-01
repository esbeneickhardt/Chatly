ALTER TABLE channels ADD COLUMN created_by INTEGER REFERENCES users(id);
ALTER TABLE channels ADD COLUMN restricted INTEGER NOT NULL DEFAULT 0;

-- Explicit member list for a restricted channel. Meaningless (and
-- unchecked) when the channel isn't restricted.
CREATE TABLE channel_members (
    channel_id  INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (channel_id, user_id)
);
CREATE INDEX idx_channel_members_user_id ON channel_members(user_id);

-- Who can manage a channel (delete it, add/remove members and other
-- admins) beyond the guild owner, who always retains that authority
-- regardless of this table.
CREATE TABLE channel_admins (
    channel_id  INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (channel_id, user_id)
);
CREATE INDEX idx_channel_admins_user_id ON channel_admins(user_id);
