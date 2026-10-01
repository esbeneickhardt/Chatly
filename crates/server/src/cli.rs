//! Operator commands: `chatly backup`, `restore`, and the lockout-recovery
//! `admin` commands. Anything other than a bare `chatly` (which serves)
//! is handled here, against the data directory directly — the server
//! doesn't have to be reachable, and for `admin` it shouldn't be the one
//! being asked to fix a locked-out account.
//!
//! No argument-parsing crate: there are five commands, and the whole
//! grammar fits in `parse`.

use std::path::{Path, PathBuf};

use anyhow::{bail, Context};
use rusqlite::Connection;

use crate::auth::password;
use crate::storage::{AccountStore, SessionStore, SqliteStorage};

pub const USAGE: &str = "\
chatly — self-hosted chat server

USAGE:
    chatly                              Run the server (configured by environment; see docs/admin.md)
    chatly backup <dir>                 Write a consistent snapshot of the data directory into <dir>
    chatly restore <dir> [--force]      Restore a snapshot into the data directory (stop the server first)
    chatly admin reset-password <user>  Set a new password and sign the account out everywhere
                                        (new password from $NEW_PASSWORD, else the first line of stdin)
    chatly admin reset-mfa <user>       Turn off two-factor authentication for the account
    chatly --version | --help
";

#[derive(Debug, PartialEq, Eq)]
pub enum Command {
    Serve,
    Backup { dir: PathBuf },
    Restore { dir: PathBuf, force: bool },
    ResetPassword { username: String },
    ResetMfa { username: String },
    Version,
    Help,
}

pub fn parse(args: &[String]) -> Result<Command, String> {
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    match args.as_slice() {
        [] => Ok(Command::Serve),
        ["--version" | "-V" | "version"] => Ok(Command::Version),
        ["--help" | "-h" | "help"] => Ok(Command::Help),
        ["backup", dir] => Ok(Command::Backup { dir: PathBuf::from(dir) }),
        ["restore", dir] => Ok(Command::Restore { dir: PathBuf::from(dir), force: false }),
        ["restore", dir, "--force"] | ["restore", "--force", dir] => {
            Ok(Command::Restore { dir: PathBuf::from(dir), force: true })
        }
        ["admin", "reset-password", user] => {
            Ok(Command::ResetPassword { username: user.to_string() })
        }
        ["admin", "reset-mfa", user] => Ok(Command::ResetMfa { username: user.to_string() }),
        other => Err(format!("unrecognized command: {}", other.join(" "))),
    }
}

/// Runs every command except `Serve`.
pub async fn run(command: Command, data_dir: &Path) -> anyhow::Result<()> {
    match command {
        Command::Serve => unreachable!("serving is handled by main"),
        Command::Version => println!("chatly {}", env!("CARGO_PKG_VERSION")),
        Command::Help => print!("{USAGE}"),
        Command::Backup { dir } => {
            let report = backup(data_dir, &dir)?;
            println!(
                "Backed up to {} (schema version {}, {} file(s)).",
                dir.display(),
                report.schema_version,
                report.files
            );
        }
        Command::Restore { dir, force } => {
            restore(&dir, data_dir, force)?;
            println!("Restored {} into {}. Start the server.", dir.display(), data_dir.display());
        }
        Command::ResetPassword { username } => {
            let new_password = read_new_password()?;
            reset_password(data_dir, &username, &new_password).await?;
            println!("Password changed for {username}; every session for the account was ended.");
        }
        Command::ResetMfa { username } => {
            reset_mfa(data_dir, &username).await?;
            println!("Two-factor authentication turned off for {username}.");
        }
    }
    Ok(())
}

pub struct BackupReport {
    pub schema_version: i64,
    pub files: usize,
}

/// Snapshots `data_dir` into `out_dir`: `chat.db` (a transactionally
/// consistent copy made with `VACUUM INTO`, safe while the server runs),
/// `files/` (attachments), and `secret_key` (if the key wasn't supplied
/// through `SECRET_KEY`). `out_dir` must be empty or not exist.
pub fn backup(data_dir: &Path, out_dir: &Path) -> anyhow::Result<BackupReport> {
    let db_path = data_dir.join("chat.db");
    if !db_path.exists() {
        bail!("no database at {} — is DATA_DIR right?", db_path.display());
    }
    if out_dir.exists() && std::fs::read_dir(out_dir)?.next().is_some() {
        bail!("{} isn't empty; refusing to mix a backup into existing files", out_dir.display());
    }
    std::fs::create_dir_all(out_dir)?;

    let conn = Connection::open(&db_path).context("opening the database")?;
    conn.execute_batch("PRAGMA busy_timeout = 5000;")?;
    let target = out_dir.join("chat.db");
    conn.execute("VACUUM INTO ?1", [target.to_string_lossy().as_ref()])
        .context("snapshotting the database")?;
    let schema_version: i64 =
        conn.query_row("SELECT COALESCE(MAX(version), 0) FROM schema_version", [], |r| r.get(0))?;

    let files = copy_dir(&data_dir.join("files"), &out_dir.join("files"))?;
    let key = data_dir.join("secret_key");
    if key.exists() {
        std::fs::copy(&key, out_dir.join("secret_key"))?;
    }
    Ok(BackupReport { schema_version, files })
}

/// Puts a snapshot made by [`backup`] into `data_dir`. Refuses to touch an
/// existing database unless `force`, in which case the current one is set
/// aside (never deleted) as `chat.db.before-restore`.
pub fn restore(backup_dir: &Path, data_dir: &Path, force: bool) -> anyhow::Result<()> {
    let snapshot = backup_dir.join("chat.db");
    if !snapshot.exists() {
        bail!("{} doesn't look like a backup (no chat.db)", backup_dir.display());
    }

    std::fs::create_dir_all(data_dir)?;
    let live = data_dir.join("chat.db");
    if live.exists() && !force {
        bail!(
            "{} already has a database; stop the server and pass --force to replace it (the old one is kept)",
            data_dir.display()
        );
    }

    // Copy to a temporary name and check *that* — a full-text index can't be
    // verified through a read-only handle — so a bad backup is rejected
    // before anything of the live data is touched, and the final step is an
    // atomic rename.
    let staged = data_dir.join("chat.db.restoring");
    std::fs::copy(&snapshot, &staged)?;
    let verdict = Connection::open(&staged)
        .and_then(|conn| conn.query_row("PRAGMA integrity_check", [], |r| r.get::<_, String>(0)));
    match verdict {
        Ok(v) if v == "ok" => {}
        Ok(v) => {
            let _ = std::fs::remove_file(&staged);
            bail!("the backup's database failed its integrity check: {v}");
        }
        Err(e) => {
            let _ = std::fs::remove_file(&staged);
            bail!("the backup's database can't be read: {e}");
        }
    }

    if live.exists() {
        std::fs::rename(&live, data_dir.join("chat.db.before-restore"))?;
    }
    // A stale write-ahead log from the replaced database must not be
    // replayed onto the restored one.
    for stale in ["chat.db-wal", "chat.db-shm"] {
        let _ = std::fs::remove_file(data_dir.join(stale));
    }
    std::fs::rename(&staged, &live)?;
    copy_dir(&backup_dir.join("files"), &data_dir.join("files"))?;
    let key = backup_dir.join("secret_key");
    if key.exists() {
        std::fs::copy(&key, data_dir.join("secret_key"))?;
    }
    Ok(())
}

fn copy_dir(from: &Path, to: &Path) -> anyhow::Result<usize> {
    if !from.exists() {
        return Ok(0);
    }
    std::fs::create_dir_all(to)?;
    let mut copied = 0;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copied += copy_dir(&entry.path(), &target)?;
        } else {
            std::fs::copy(entry.path(), &target)?;
            copied += 1;
        }
    }
    Ok(copied)
}

fn read_new_password() -> anyhow::Result<String> {
    let password = match std::env::var("NEW_PASSWORD") {
        Ok(p) if !p.is_empty() => p,
        _ => {
            let mut line = String::new();
            eprintln!("New password (input is visible; prefer NEW_PASSWORD or a pipe):");
            std::io::stdin().read_line(&mut line)?;
            line.trim_end_matches(['\r', '\n']).to_string()
        }
    };
    if password.len() < 8 {
        bail!("password must be at least 8 characters");
    }
    Ok(password)
}

pub async fn reset_password(
    data_dir: &Path,
    username: &str,
    new_password: &str,
) -> anyhow::Result<()> {
    let storage = SqliteStorage::open(data_dir)?;
    let user = storage
        .get_user_by_username(&username.trim().to_lowercase())
        .await?
        .with_context(|| format!("no account named {username}"))?;
    let hash = password::hash(new_password)?;
    storage.set_user_password_hash(user.id, hash).await?;
    storage.delete_all_sessions_for_user(user.id).await?;
    Ok(())
}

pub async fn reset_mfa(data_dir: &Path, username: &str) -> anyhow::Result<()> {
    let storage = SqliteStorage::open(data_dir)?;
    let user = storage
        .get_user_by_username(&username.trim().to_lowercase())
        .await?
        .with_context(|| format!("no account named {username}"))?;
    storage.disable_totp(user.id).await?;
    storage.delete_all_sessions_for_user(user.id).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::NewUser;
    use protocol::Id;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn parses_every_command() {
        assert_eq!(parse(&args(&[])), Ok(Command::Serve));
        assert_eq!(parse(&args(&["--version"])), Ok(Command::Version));
        assert_eq!(parse(&args(&["backup", "/b"])), Ok(Command::Backup { dir: "/b".into() }));
        assert_eq!(
            parse(&args(&["restore", "/b", "--force"])),
            Ok(Command::Restore { dir: "/b".into(), force: true })
        );
        assert_eq!(
            parse(&args(&["admin", "reset-password", "ann"])),
            Ok(Command::ResetPassword { username: "ann".into() })
        );
        assert!(parse(&args(&["frobnicate"])).is_err());
        assert!(parse(&args(&["backup"])).is_err(), "backup needs a directory");
    }

    async fn seeded(dir: &Path) -> Id {
        let storage = SqliteStorage::open(dir).unwrap();
        let id = Id::from_raw(42);
        storage
            .register_owner(
                NewUser {
                    id,
                    username: "ann".into(),
                    display_name: "Ann".into(),
                    password_hash: password::hash("old-password").unwrap(),
                    is_owner: true,
                    is_bot: false,
                },
                Id::from_raw(100),
                "Test".into(),
                Id::from_raw(101),
                Id::from_raw(102),
            )
            .await
            .unwrap();
        std::fs::write(dir.join("files").join("upload.bin"), b"attachment").unwrap();
        std::fs::write(dir.join("secret_key"), b"k").unwrap();
        id
    }

    #[tokio::test]
    async fn backup_then_restore_round_trips_database_files_and_key() {
        let live = tempfile::tempdir().unwrap();
        seeded(live.path()).await;

        let out = tempfile::tempdir().unwrap();
        let backup_dir = out.path().join("snap");
        let report = backup(live.path(), &backup_dir).unwrap();
        assert!(report.schema_version >= 23);
        assert_eq!(report.files, 1);

        // Restoring into a fresh directory recreates everything.
        let fresh = tempfile::tempdir().unwrap();
        restore(&backup_dir, fresh.path(), false).unwrap();
        let storage = SqliteStorage::open(fresh.path()).unwrap();
        assert!(storage.get_user_by_username("ann").await.unwrap().is_some());
        assert_eq!(std::fs::read(fresh.path().join("files/upload.bin")).unwrap(), b"attachment");
        assert_eq!(std::fs::read(fresh.path().join("secret_key")).unwrap(), b"k");
    }

    #[tokio::test]
    async fn restore_never_overwrites_an_existing_database_without_force() {
        let live = tempfile::tempdir().unwrap();
        seeded(live.path()).await;
        let out = tempfile::tempdir().unwrap();
        let snap = out.path().join("snap");
        backup(live.path(), &snap).unwrap();

        assert!(restore(&snap, live.path(), false).is_err());
        restore(&snap, live.path(), true).unwrap();
        assert!(
            live.path().join("chat.db.before-restore").exists(),
            "the replaced database is kept"
        );
    }

    #[tokio::test]
    async fn backup_refuses_a_non_empty_target() {
        let live = tempfile::tempdir().unwrap();
        seeded(live.path()).await;
        let target = tempfile::tempdir().unwrap();
        std::fs::write(target.path().join("keep.txt"), "x").unwrap();
        assert!(backup(live.path(), target.path()).is_err());
    }

    #[tokio::test]
    async fn reset_password_changes_it_and_ends_sessions() {
        let dir = tempfile::tempdir().unwrap();
        let id = seeded(dir.path()).await;
        reset_password(dir.path(), "Ann", "brand-new-password").await.unwrap();

        let storage = SqliteStorage::open(dir.path()).unwrap();
        let hash = storage.get_password_hash(id).await.unwrap().unwrap();
        assert!(password::verify(&hash, "brand-new-password"));
        assert!(!password::verify(&hash, "old-password"));
        assert!(reset_password(dir.path(), "nobody", "whatever-long").await.is_err());
    }

    #[tokio::test]
    async fn a_corrupt_backup_is_rejected_before_the_live_data_is_touched() {
        let live = tempfile::tempdir().unwrap();
        seeded(live.path()).await;
        let out = tempfile::tempdir().unwrap();
        let snap = out.path().join("snap");
        backup(live.path(), &snap).unwrap();
        std::fs::write(snap.join("chat.db"), b"this is not a database at all").unwrap();

        let before = std::fs::read(live.path().join("chat.db")).unwrap();
        assert!(restore(&snap, live.path(), true).is_err());
        assert_eq!(
            std::fs::read(live.path().join("chat.db")).unwrap(),
            before,
            "live database untouched"
        );
        assert!(!live.path().join("chat.db.restoring").exists(), "no half-restored leftovers");
        assert!(!live.path().join("chat.db.before-restore").exists());
    }
}
