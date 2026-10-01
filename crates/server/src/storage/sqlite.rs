use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use protocol::{Id, Permissions};
use rusqlite::Connection;

use super::queries;
use super::{migrations, Storage};

/// The `@everyone` role every guild starts with: view + talk + invite,
/// nothing administrative. This is only the *starting* point: a server
/// admin changes what `@everyone` can do later, per server, from
/// Manage server → Roles.
pub(super) const DEFAULT_EVERYONE_PERMISSIONS: Permissions = Permissions::from_bits_truncate(
    Permissions::VIEW_CHANNEL.bits()
        | Permissions::SEND_MESSAGES.bits()
        | Permissions::CREATE_INVITE.bits()
        | Permissions::CONNECT.bits()
        | Permissions::SPEAK.bits(),
);

/// Creates a guild, its `@everyone` role, a `general` text channel and
/// a `General` voice channel, and adds `owner_id` as a member — shared
/// by owner registration and the user-facing "create a server" flow,
/// which are otherwise identical.
pub(super) fn bootstrap_guild(
    conn: &Connection,
    guild_id: Id,
    name: &str,
    owner_id: Id,
    general_channel_id: Id,
    voice_channel_id: Id,
    icon_file_id: Option<Id>,
) -> rusqlite::Result<()> {
    let now = guild_id.timestamp_ms() as i64;
    queries::guilds::create(conn, guild_id, name, owner_id, now, icon_file_id)?;
    queries::guilds::create_everyone_role(conn, guild_id, DEFAULT_EVERYONE_PERMISSIONS)?;
    queries::channels::create_text_channel(conn, general_channel_id, guild_id, "general", 0)?;
    queries::channels::create_voice_channel(conn, voice_channel_id, guild_id, "General", 1)?;
    queries::guilds::add_member(conn, guild_id, owner_id, now)?;
    Ok(())
}

/// SQLite-backed storage. A single connection behind a std mutex, always
/// touched through [`SqliteStorage::with_conn`] on a blocking thread —
/// plenty at the target scale (50-100 concurrent users), and it keeps
/// synchronous rusqlite calls off the async runtime's worker threads.
/// One useful side effect: every transaction below already runs fully
/// serialized (the mutex is held for the whole closure), so check-then-
/// insert races (e.g. "is the invite still valid?") need no extra locking.
///
/// `gate` is a first-in-first-out queue in front of that mutex. Without it
/// every waiting request parks a blocking thread on the (unfair) mutex,
/// which wastes threads and lets some requests be overtaken again and again;
/// with it only the request whose turn it is ever takes a thread.
pub struct SqliteStorage {
    gate: Arc<tokio::sync::Mutex<()>>,
    conn: Arc<Mutex<Connection>>,
    /// Where uploaded file blobs live (`$data_dir/files/<id>`) —
    /// retained so `delete_account` can remove a departing account's
    /// own uploads (avatar, message attachments, any guild icon they
    /// set) from disk, not just their `files` table rows.
    pub(super) data_dir: PathBuf,
}

impl SqliteStorage {
    /// Opens (creating if needed) `$data_dir/chat.db`, applies pragmas,
    /// and runs any pending migrations.
    pub fn open(data_dir: &Path) -> anyhow::Result<Self> {
        std::fs::create_dir_all(data_dir)?;
        std::fs::create_dir_all(data_dir.join("files"))?;

        let db_path = data_dir.join("chat.db");
        let conn = Connection::open(db_path)?;

        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA foreign_keys = ON;
             PRAGMA busy_timeout = 5000;",
        )?;

        migrations::run(&conn, migrations::MIGRATIONS)?;

        // Every query goes through `prepare_cached`; the default cache (16)
        // is smaller than the number of distinct hot queries.
        conn.set_prepared_statement_cache_capacity(128);

        Ok(SqliteStorage {
            gate: Arc::new(tokio::sync::Mutex::new(())),
            conn: Arc::new(Mutex::new(conn)),
            data_dir: data_dir.to_path_buf(),
        })
    }

    /// Runs `f` against the connection on a blocking thread. Every
    /// domain query goes through this so a slow query never stalls the
    /// async executor.
    pub(super) async fn with_conn<T, F>(&self, f: F) -> anyhow::Result<T>
    where
        T: Send + 'static,
        F: FnOnce(&Connection) -> rusqlite::Result<T> + Send + 'static,
    {
        let turn = Arc::clone(&self.gate).lock_owned().await;
        let conn = Arc::clone(&self.conn);
        tokio::task::spawn_blocking(move || {
            let conn = crate::sync::lock(&conn);
            let result = f(&conn);
            drop(turn);
            result
        })
        .await
        .map_err(|e| anyhow::anyhow!("blocking db task panicked: {e}"))?
        .map_err(Into::into)
    }
}

#[async_trait::async_trait]
impl Storage for SqliteStorage {
    async fn health_check(&self) -> anyhow::Result<()> {
        self.with_conn(|conn| conn.query_row("SELECT 1", [], |_| Ok(()))).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn opens_creates_schema_and_reports_healthy() {
        let dir = tempfile::tempdir().unwrap();
        let storage = SqliteStorage::open(dir.path()).unwrap();
        storage.health_check().await.unwrap();
        assert!(dir.path().join("chat.db").exists());
        assert!(dir.path().join("files").is_dir());
    }

    #[tokio::test]
    async fn reopening_an_existing_database_is_safe() {
        let dir = tempfile::tempdir().unwrap();
        SqliteStorage::open(dir.path()).unwrap();
        let storage = SqliteStorage::open(dir.path()).unwrap();
        storage.health_check().await.unwrap();
    }

    /// The queue in front of the connection must keep every closure
    /// serialized: a read-modify-write from many tasks loses no update.
    #[tokio::test]
    async fn queries_from_many_tasks_never_interleave() {
        let dir = tempfile::tempdir().unwrap();
        let storage = Arc::new(SqliteStorage::open(dir.path()).unwrap());
        storage
            .with_conn(|c| c.execute_batch("CREATE TABLE t (n INTEGER); INSERT INTO t VALUES (0);"))
            .await
            .unwrap();
        let mut tasks = Vec::new();
        for _ in 0..50 {
            let storage = storage.clone();
            tasks.push(tokio::spawn(async move {
                storage
                    .with_conn(|c| {
                        let n: i64 = c.query_row("SELECT n FROM t", [], |r| r.get(0))?;
                        std::thread::sleep(std::time::Duration::from_micros(200));
                        c.execute("UPDATE t SET n = ?1", [n + 1]).map(|_| ())
                    })
                    .await
                    .unwrap();
            }));
        }
        for task in tasks {
            task.await.unwrap();
        }
        let n: i64 =
            storage.with_conn(|c| c.query_row("SELECT n FROM t", [], |r| r.get(0))).await.unwrap();
        assert_eq!(n, 50);
    }

    /// A request that gives up while waiting its turn (client hung up)
    /// must not leave the queue jammed for everyone behind it.
    #[tokio::test]
    async fn a_waiter_that_is_cancelled_does_not_block_the_queue() {
        let dir = tempfile::tempdir().unwrap();
        let storage = Arc::new(SqliteStorage::open(dir.path()).unwrap());
        let slow = {
            let storage = storage.clone();
            tokio::spawn(async move {
                storage
                    .with_conn(|_| {
                        std::thread::sleep(std::time::Duration::from_millis(100));
                        Ok(())
                    })
                    .await
            })
        };
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        let abandoned = {
            let storage = storage.clone();
            tokio::spawn(async move { storage.health_check().await })
        };
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        abandoned.abort();
        slow.await.unwrap().unwrap();
        tokio::time::timeout(std::time::Duration::from_secs(2), storage.health_check())
            .await
            .expect("the queue is not jammed")
            .unwrap();
    }
}
