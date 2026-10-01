-- Replaces two parallel invite systems (the app-registration `invites`
-- table, which could only create a brand-new account and always
-- dropped the new user into "the" guild; and `guild_invites`, which
-- could only add an *existing* account to one more guild) with one:
-- every invite now optionally targets a specific channel via
-- `channel_id`. That channel's own `guild_id` decides what redeeming
-- it actually grants — a guild channel adds guild membership, a DM
-- channel (guild_id NULL) adds DM participancy and nothing else, per
-- the explicit "invited from a DM shouldn't join any server" ask. A
-- `NULL` channel_id (every pre-existing row) keeps behaving exactly as
-- before: join "the" (first) guild, no specific channel to land on.
--
-- `guild_invites` is dropped outright — nothing needs both systems
-- alive at once, and the whole point was to stop there being two.
DROP TABLE guild_invites;

ALTER TABLE invites ADD COLUMN channel_id INTEGER REFERENCES channels(id) ON DELETE SET NULL;
