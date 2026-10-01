//! Embedded, ordered SQL migrations, applied automatically at startup and
//! tracked in `schema_version` so the admin never runs a separate migrate
//! step.

use rusqlite::Connection;

/// `(version, sql)` pairs, in ascending order. Never renumber or edit an
/// already-released entry — add a new one instead.
pub const MIGRATIONS: &[(i64, &str)] = &[
    (1, include_str!("../../migrations/0001_init.sql")),
    (2, include_str!("../../migrations/0002_identity.sql")),
    (3, include_str!("../../migrations/0003_guilds.sql")),
    (4, include_str!("../../migrations/0004_guild_invites.sql")),
    (5, include_str!("../../migrations/0005_direct_messages.sql")),
    (6, include_str!("../../migrations/0006_attachments_reactions.sql")),
    (7, include_str!("../../migrations/0007_guild_icons.sql")),
    (8, include_str!("../../migrations/0008_user_avatars.sql")),
    (9, include_str!("../../migrations/0009_message_mentions.sql")),
    (10, include_str!("../../migrations/0010_channel_access_control.sql")),
    (11, include_str!("../../migrations/0011_friends.sql")),
    (12, include_str!("../../migrations/0012_friend_requests.sql")),
    (13, include_str!("../../migrations/0013_unified_invites.sql")),
    (14, include_str!("../../migrations/0014_dm_hide_leave.sql")),
    (15, include_str!("../../migrations/0015_account_deletion.sql")),
    (16, include_str!("../../migrations/0016_bot_accounts.sql")),
    (17, include_str!("../../migrations/0017_guest_accounts.sql")),
    (18, include_str!("../../migrations/0018_self_dm_flag.sql")),
    (19, include_str!("../../migrations/0019_guild_departed_members.sql")),
    (20, include_str!("../../migrations/0020_cleanup_orphaned_1on1_dms.sql")),
    (21, include_str!("../../migrations/0021_role_assignments_and_overwrites.sql")),
    (22, include_str!("../../migrations/0022_repair_shared_self_dms.sql")),
    (23, include_str!("../../migrations/0023_server_level_admins.sql")),
    (24, include_str!("../../migrations/0024_message_search.sql")),
    (25, include_str!("../../migrations/0025_audit_log.sql")),
];

/// A migration starting with this marker manages its own transaction
/// (and typically toggles `PRAGMA foreign_keys`, which SQLite only
/// honors outside of one — see 0005 for why: a plain `DROP TABLE` on a
/// table other tables reference with `ON DELETE CASCADE` silently
/// cascades and deletes those rows, even though nothing was explicitly
/// deleted. Confirmed empirically before relying on it — see the git
/// history for this file). The default path below wraps everything
/// else in `BEGIN`/`COMMIT` automatically so ordinary migrations don't
/// need to think about it.
const MANUAL_TRANSACTION_MARKER: &str = "-- MANUAL_TRANSACTION";

pub fn run(conn: &Connection, migrations: &[(i64, &str)]) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_version (
            version    INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        )",
    )?;

    let current: i64 =
        conn.query_row("SELECT COALESCE(MAX(version), 0) FROM schema_version", [], |row| {
            row.get(0)
        })?;

    let mut applied_any = false;
    for &(version, sql) in migrations {
        if version <= current {
            continue;
        }
        tracing::info!(version, "applying migration");

        if sql.trim_start().starts_with(MANUAL_TRANSACTION_MARKER) {
            conn.execute_batch(sql)?;
            conn.execute("INSERT INTO schema_version (version) VALUES (?1)", [version])?;
        } else {
            conn.execute_batch(&format!(
                "BEGIN;\n{sql}\nINSERT INTO schema_version (version) VALUES ({version});\nCOMMIT;"
            ))?;
        }
        applied_any = true;
    }

    // Cheap insurance after any schema change: if a migration (this one
    // or a future one) leaves a dangling foreign key, fail loudly at
    // startup rather than silently serving a corrupt database.
    if applied_any {
        let mut stmt = conn.prepare("PRAGMA foreign_key_check")?;
        let mut violations = stmt.query([])?;
        if violations.next()?.is_some() {
            return Err(rusqlite::Error::SqliteFailure(
                rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_CONSTRAINT),
                Some("foreign_key_check found violations after migrating".to_string()),
            ));
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn applies_migrations_in_order_and_records_versions() {
        let conn = Connection::open_in_memory().unwrap();
        let migrations = [(1, "CREATE TABLE a (id INTEGER);"), (2, "CREATE TABLE b (id INTEGER);")];
        run(&conn, &migrations).unwrap();

        conn.execute("INSERT INTO a (id) VALUES (1)", []).unwrap();
        conn.execute("INSERT INTO b (id) VALUES (1)", []).unwrap();

        let max: i64 =
            conn.query_row("SELECT MAX(version) FROM schema_version", [], |r| r.get(0)).unwrap();
        assert_eq!(max, 2);
    }

    #[test]
    fn is_idempotent_and_skips_already_applied_versions() {
        let conn = Connection::open_in_memory().unwrap();
        let migrations = [(1, "CREATE TABLE a (id INTEGER);")];
        run(&conn, &migrations).unwrap();
        // Running again must not try to re-create table `a`.
        run(&conn, &migrations).unwrap();
    }

    #[test]
    fn applies_only_new_migrations_on_a_later_run() {
        let conn = Connection::open_in_memory().unwrap();
        run(&conn, &[(1, "CREATE TABLE a (id INTEGER);")]).unwrap();
        run(&conn, &[(1, "CREATE TABLE a (id INTEGER);"), (2, "CREATE TABLE b (id INTEGER);")])
            .unwrap();

        conn.execute("INSERT INTO b (id) VALUES (1)", []).unwrap();
    }

    #[test]
    fn real_embedded_migrations_apply_cleanly() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        run(&conn, MIGRATIONS).unwrap();
        conn.execute("INSERT INTO instance_meta (key, value) VALUES ('x', 'y')", []).unwrap();
    }

    /// Regression test for the exact bug this file's doc comment
    /// describes: an instance upgrading from before migration 5, with
    /// real messages already in it, must not have them silently
    /// cascade-deleted when `channels` is rebuilt to make `guild_id`
    /// nullable. This simulates a real upgrade: migrations 1-4 first
    /// (as an existing instance would already have applied), data
    /// inserted, *then* migration 5 alone.
    #[test]
    fn manual_transaction_migration_preserves_rows_across_a_table_rebuild() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();

        run(&conn, &MIGRATIONS[..4]).unwrap();

        conn.execute(
            "INSERT INTO users (id, username, display_name, password_hash, created_at) \
             VALUES (1, 'a', 'A', 'h', 0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO guilds (id, name, owner_id, created_at) VALUES (1, 'g', 1, 0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO channels (id, guild_id, name, kind, position) VALUES (1, 1, 'general', 'text', 0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO messages (id, channel_id, author_id, content, created_at) \
             VALUES (1, 1, 1, 'hello', 0)",
            [],
        )
        .unwrap();

        // The actual regression: applying migration 5 on top of this
        // pre-existing data must not wipe the message.
        run(&conn, MIGRATIONS).unwrap();

        let content: String =
            conn.query_row("SELECT content FROM messages WHERE id = 1", [], |r| r.get(0)).unwrap();
        assert_eq!(content, "hello");

        // The whole point of the rebuild: guild_id is nullable now.
        conn.execute(
            "INSERT INTO channels (id, guild_id, name, kind, position) VALUES (2, NULL, 'dm', 'text', 0)",
            [],
        )
        .unwrap();

        // And FK enforcement must still be fully active afterward.
        let err = conn
            .execute(
                "INSERT INTO channels (id, guild_id, name, kind, position) VALUES (3, 999, 'bad', 'text', 0)",
                [],
            )
            .unwrap_err();
        assert!(matches!(err, rusqlite::Error::SqliteFailure(_, _)));
    }
    /// Migration 22 unflags a "self-DM" that has had someone else added
    /// (the bug `api::dms::add_participant` no longer allows) so the
    /// owner gets a fresh private chat — while leaving a genuine solo
    /// self-DM, and ordinary 1:1s, completely alone.
    #[test]
    fn migration_22_unflags_only_shared_self_dms() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        run(&conn, &MIGRATIONS[..21]).unwrap();

        for (id, name) in [(1, "a"), (2, "b")] {
            conn.execute(
                "INSERT INTO users (id, username, display_name, password_hash, created_at) \
                 VALUES (?1, ?2, ?2, 'h', 0)",
                rusqlite::params![id, name],
            )
            .unwrap();
        }
        // 10: a's self-DM that had b added (the corrupted case).
        // 11: b's untouched solo self-DM.
        // 12: an ordinary 1:1 between a and b (never flagged).
        for (channel, flag) in [(10, 1), (11, 1), (12, 0)] {
            conn.execute(
                "INSERT INTO channels (id, guild_id, name, kind, position, is_self_dm) \
                 VALUES (?1, NULL, '', 'text', 0, ?2)",
                rusqlite::params![channel, flag],
            )
            .unwrap();
        }
        for (channel, user) in [(10, 1), (10, 2), (11, 2), (12, 1), (12, 2)] {
            conn.execute(
                "INSERT INTO dm_participants (channel_id, user_id) VALUES (?1, ?2)",
                rusqlite::params![channel, user],
            )
            .unwrap();
        }

        run(&conn, MIGRATIONS).unwrap();

        let flag = |id: i64| -> i64 {
            conn.query_row("SELECT is_self_dm FROM channels WHERE id = ?1", [id], |r| r.get(0))
                .unwrap()
        };
        assert_eq!(flag(10), 0, "the shared \"self-DM\" should now be an ordinary chat");
        assert_eq!(flag(11), 1, "a genuine solo self-DM must keep its flag");
        assert_eq!(flag(12), 0);
    }

    /// Migration 23 retires channel-level admins without stripping anyone
    /// of what they could do: a former channel admin keeps access to a
    /// restricted channel, and gains a narrowly-scoped "Channel manager"
    /// role (MANAGE_MESSAGES | MANAGE_CHANNELS — never ADMINISTRATOR) in
    /// place of their per-channel authority. Guild owners are skipped.
    #[test]
    fn migration_23_moves_channel_admins_to_a_server_level_role() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        run(&conn, &MIGRATIONS[..22]).unwrap();

        for (id, name) in [(1, "owner"), (2, "chanadmin"), (3, "bystander")] {
            conn.execute(
                "INSERT INTO users (id, username, display_name, password_hash, created_at) \
                 VALUES (?1, ?2, ?2, 'h', 0)",
                rusqlite::params![id, name],
            )
            .unwrap();
        }
        conn.execute(
            "INSERT INTO guilds (id, name, owner_id, created_at) VALUES (10, 'g', 1, 0)",
            [],
        )
        .unwrap();
        for user in [1, 2, 3] {
            conn.execute(
                "INSERT INTO members (guild_id, user_id, joined_at) VALUES (10, ?1, 0)",
                [user],
            )
            .unwrap();
        }
        conn.execute(
            "INSERT INTO channels (id, guild_id, name, kind, position, restricted) \
             VALUES (20, 10, 'private', 'text', 0, 1)",
            [],
        )
        .unwrap();
        // The owner and a delegate were channel admins; the bystander wasn't.
        for user in [1, 2] {
            conn.execute(
                "INSERT INTO channel_admins (channel_id, user_id) VALUES (20, ?1)",
                [user],
            )
            .unwrap();
        }

        run(&conn, MIGRATIONS).unwrap();

        // Access is preserved (it used to come from the admin row).
        let is_member = |user: i64| -> bool {
            conn.query_row(
                "SELECT COUNT(*) FROM channel_members WHERE channel_id = 20 AND user_id = ?1",
                [user],
                |r| r.get::<_, i64>(0),
            )
            .unwrap()
                > 0
        };
        assert!(is_member(2), "the delegate must keep access to the channel");
        assert!(!is_member(3));

        // Authority moved to exactly one scoped role, held only by the delegate.
        let roles: Vec<(String, i64)> = conn
            .prepare("SELECT name, permissions FROM roles WHERE guild_id = 10 AND id != 10")
            .unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(roles, vec![("Channel manager".to_string(), 12)]);
        let holders: Vec<i64> = conn
            .prepare("SELECT user_id FROM member_roles WHERE guild_id = 10")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(holders, vec![2], "not the owner (already all-powerful), not the bystander");

        // And the old table is gone.
        let exists: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE name = 'channel_admins'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(exists, 0);
    }

    /// The FTS index must follow every way a message can change or vanish
    /// — including rows removed by a foreign-key cascade (deleting a
    /// server), which is the case an index kept by hand-written triggers
    /// most easily misses. A stale entry would answer with ghosts and can
    /// corrupt the index on the next write.
    #[test]
    fn migration_24_search_index_tracks_inserts_edits_deletes_and_cascades() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        run(&conn, MIGRATIONS).unwrap();

        conn.execute(
            "INSERT INTO users (id, username, display_name, password_hash, created_at) \
             VALUES (1, 'a', 'A', 'h', 0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO guilds (id, name, owner_id, created_at) VALUES (10, 'g', 1, 0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO channels (id, guild_id, name, kind, position) VALUES (20, 10, 'c', 'text', 0)",
            [],
        )
        .unwrap();
        let hits = |word: &str| -> i64 {
            conn.query_row(
                "SELECT COUNT(*) FROM messages_fts WHERE messages_fts MATCH ?1",
                [word],
                |r| r.get(0),
            )
            .unwrap()
        };
        let integrity = || {
            conn.execute("INSERT INTO messages_fts(messages_fts) VALUES('integrity-check')", [])
                .unwrap()
        };

        conn.execute(
            "INSERT INTO messages (id, channel_id, author_id, content, created_at) \
             VALUES (30, 20, 1, 'remember the alamo', 0)",
            [],
        )
        .unwrap();
        assert_eq!(hits("alamo"), 1);

        conn.execute("UPDATE messages SET content = 'remember the zeppelin' WHERE id = 30", [])
            .unwrap();
        assert_eq!((hits("alamo"), hits("zeppelin")), (0, 1));

        conn.execute("DELETE FROM guilds WHERE id = 10", []).unwrap(); // cascades to the message
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM messages", [], |r| r.get::<_, i64>(0)).unwrap(),
            0
        );
        assert_eq!(hits("zeppelin"), 0, "a cascaded delete must leave the index too");
        integrity();
    }

    /// Existing messages are searchable right after the migration runs
    /// (the index is rebuilt from what's already there).
    #[test]
    fn migration_24_backfills_existing_messages() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        run(&conn, &MIGRATIONS[..23]).unwrap();
        conn.execute(
            "INSERT INTO users (id, username, display_name, password_hash, created_at) \
             VALUES (1, 'a', 'A', 'h', 0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO guilds (id, name, owner_id, created_at) VALUES (10, 'g', 1, 0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO channels (id, guild_id, name, kind, position) VALUES (20, 10, 'c', 'text', 0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO messages (id, channel_id, author_id, content, created_at) \
             VALUES (30, 20, 1, 'written before search existed', 0)",
            [],
        )
        .unwrap();

        run(&conn, MIGRATIONS).unwrap();
        let found: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM messages_fts WHERE messages_fts MATCH 'existed'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(found, 1);
    }
}
