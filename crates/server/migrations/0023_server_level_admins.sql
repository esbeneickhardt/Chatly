-- Retires channel-level admins. Administration now lives at exactly two
-- levels: the *server* (a guild — the owner, plus anyone holding a role
-- with the `ADMINISTRATOR` permission, or narrower ones like
-- `MANAGE_CHANNELS`) and the *instance* (the global admin, `users.is_owner`).
-- A per-channel admin list was a third, overlapping mechanism that the
-- role system had made redundant.
--
-- Nobody loses anything they could do:
--   * A former channel admin keeps *access* to the channel: they're
--     added to `channel_members` first, because access to a restricted
--     channel used to be granted by either table.
--   * Their *authority* (delete the channel, manage its members,
--     delete other people's messages) moves to a per-server "Channel
--     manager" role with exactly `MANAGE_MESSAGES | MANAGE_CHANNELS`
--     (4 | 8) — deliberately not `ADMINISTRATOR`, so nobody is quietly
--     promoted to full server admin. Owners are skipped; they already
--     have everything.

INSERT OR IGNORE INTO channel_members (channel_id, user_id)
SELECT ca.channel_id, ca.user_id
FROM channel_admins ca
JOIN channels c ON c.id = ca.channel_id
WHERE c.restricted = 1;

CREATE TEMP TABLE _channel_manager_roles (
    guild_id INTEGER PRIMARY KEY,
    role_id  INTEGER NOT NULL
);

INSERT INTO _channel_manager_roles (guild_id, role_id)
SELECT DISTINCT c.guild_id, abs(random()) % 9223372036854775807
FROM channel_admins ca
JOIN channels c ON c.id = ca.channel_id
JOIN guilds g ON g.id = c.guild_id
JOIN members m ON m.guild_id = c.guild_id AND m.user_id = ca.user_id
WHERE c.guild_id IS NOT NULL AND ca.user_id != g.owner_id;

INSERT INTO roles (id, guild_id, name, permissions, position)
SELECT role_id, guild_id, 'Channel manager', 12, 0
FROM _channel_manager_roles;

INSERT OR IGNORE INTO member_roles (guild_id, user_id, role_id)
SELECT DISTINCT c.guild_id, ca.user_id, r.role_id
FROM channel_admins ca
JOIN channels c ON c.id = ca.channel_id
JOIN guilds g ON g.id = c.guild_id
JOIN members m ON m.guild_id = c.guild_id AND m.user_id = ca.user_id
JOIN _channel_manager_roles r ON r.guild_id = c.guild_id
WHERE c.guild_id IS NOT NULL AND ca.user_id != g.owner_id;

DROP TABLE _channel_manager_roles;
DROP TABLE channel_admins;
