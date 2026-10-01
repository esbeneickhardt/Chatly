-- An append-only record of administrative actions, so "who did that?" has
-- an answer. One table serves both administration levels:
--
--   * `guild_id` set    — something a *server* admin (or moderator) did in
--                         that server: promoting an admin, removing a
--                         member, editing roles, creating or deleting a
--                         channel, changing the invite policy, and so on.
--   * `guild_id` NULL   — something the *global* admin did to the
--                         deployment: deleting an account or a server,
--                         reassigning a server's owner.
--
-- `actor_name` and `target_name` are captured at the time of the action:
-- an entry must still read correctly after the person renames themselves
-- or the thing it was about is deleted (which is often the very action
-- being recorded). Entries for a server go with the server; `actor_id`
-- goes NULL if the account is deleted, the name staying as written.

CREATE TABLE audit_log (
    id          INTEGER PRIMARY KEY,
    guild_id    INTEGER REFERENCES guilds(id) ON DELETE CASCADE,
    actor_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    actor_name  TEXT NOT NULL,
    action      TEXT NOT NULL,
    target_id   INTEGER,
    target_name TEXT,
    detail      TEXT,
    created_at  INTEGER NOT NULL
);
CREATE INDEX idx_audit_log_guild ON audit_log(guild_id, id DESC);
