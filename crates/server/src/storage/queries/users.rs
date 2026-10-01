use protocol::Id;
use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::models::{NewUser, User, UserWithPasswordHash};

pub(crate) const SELECT_USER: &str = "
    SELECT u.id, u.username, u.display_name, u.is_owner, u.can_invite, u.created_at,
           COALESCE(t.enabled, 0) AS mfa_enabled, u.avatar_file_id, u.accepts_friend_requests,
           u.is_bot, u.is_guest
    FROM users u
    LEFT JOIN mfa_totp t ON t.user_id = u.id";

pub(crate) fn row_to_user(row: &Row) -> rusqlite::Result<User> {
    let id: i64 = row.get(0)?;
    let avatar_file_id: Option<i64> = row.get(7)?;
    Ok(User {
        id: Id::from_raw(id as u64),
        username: row.get(1)?,
        display_name: row.get(2)?,
        is_owner: row.get::<_, i64>(3)? != 0,
        can_invite: row.get::<_, i64>(4)? != 0,
        created_at: row.get(5)?,
        mfa_enabled: row.get::<_, i64>(6)? != 0,
        avatar_file_id: avatar_file_id.map(|i| Id::from_raw(i as u64)),
        accepts_friend_requests: row.get::<_, i64>(8)? != 0,
        is_bot: row.get::<_, i64>(9)? != 0,
        is_guest: row.get::<_, i64>(10)? != 0,
    })
}

/// `Some` only for a guest account — see `SessionWithUser`'s doc
/// comment on why this is checked separately from the rest of `User`.
pub fn guest_expires_at(conn: &Connection, user_id: Id) -> rusqlite::Result<Option<i64>> {
    conn.query_row(
        "SELECT guest_expires_at FROM users WHERE id = ?1",
        params![user_id.raw() as i64],
        |row| row.get(0),
    )
}

/// Flips a just-inserted account into a guest — separate from
/// `insert`/`NewUser` since only this one path ever needs it and it
/// keeps every other account-creation call site from having to think
/// about guest fields at all.
pub fn mark_as_guest(conn: &Connection, user_id: Id, expires_at: i64) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE users SET is_guest = 1, guest_expires_at = ?1 WHERE id = ?2",
        params![expires_at, user_id.raw() as i64],
    )?;
    Ok(())
}

pub fn set_accepts_friend_requests(
    conn: &Connection,
    user_id: Id,
    accepts: bool,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE users SET accepts_friend_requests = ?1 WHERE id = ?2",
        params![accepts as i64, user_id.raw() as i64],
    )?;
    Ok(())
}

/// Every account on the instance — a deleted one is hard-removed (see
/// `Storage::delete_account`), so there's no "show it as deleted"
/// state to include here anymore. The instance owner's own "Admin"
/// settings tab, see UX_FEEDBACK.md.
pub fn list_all_for_admin(conn: &Connection) -> rusqlite::Result<Vec<User>> {
    let mut stmt = conn.prepare_cached(&format!("{SELECT_USER} ORDER BY u.created_at ASC"))?;
    let rows = stmt.query_map([], row_to_user)?;
    rows.collect()
}

pub fn count(conn: &Connection) -> rusqlite::Result<i64> {
    conn.query_row("SELECT COUNT(*) FROM users", [], |r| r.get(0))
}

pub fn insert(conn: &Connection, u: &NewUser) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO users (id, username, display_name, password_hash, is_owner, is_bot, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            u.id.raw() as i64,
            u.username,
            u.display_name,
            u.password_hash,
            u.is_owner as i64,
            u.is_bot as i64,
            u.id.timestamp_ms() as i64,
        ],
    )?;
    Ok(())
}

/// Case-insensitive substring match on username or display name.
/// `%`/`_` in the query are escaped so a search for a literal percent
/// sign doesn't turn into an unintended wildcard.
pub fn search(conn: &Connection, query: &str, limit: i64) -> rusqlite::Result<Vec<User>> {
    let escaped =
        query.to_lowercase().replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_");
    let pattern = format!("%{escaped}%");
    let mut stmt = conn.prepare_cached(&format!(
        "{SELECT_USER} WHERE u.deleted_at IS NULL
         AND (lower(u.username) LIKE ?1 ESCAPE '\\' OR lower(u.display_name) LIKE ?1 ESCAPE '\\')
         ORDER BY u.username LIMIT ?2"
    ))?;
    let rows = stmt.query_map(params![pattern, limit], row_to_user)?;
    rows.collect()
}

/// Whether this file is currently in use as *anyone's* avatar — lets
/// the download endpoint serve avatar files to any signed-in user
/// (avatars are meant to be visible instance-wide, unlike message
/// attachments or guild icons which are scoped to viewers who share
/// the channel/guild).
pub fn is_avatar(conn: &Connection, file_id: Id) -> rusqlite::Result<bool> {
    conn.query_row(
        "SELECT 1 FROM users WHERE avatar_file_id = ?1",
        params![file_id.raw() as i64],
        |_| Ok(()),
    )
    .optional()
    .map(|o| o.is_some())
}

pub fn set_avatar(
    conn: &Connection,
    user_id: Id,
    avatar_file_id: Option<Id>,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE users SET avatar_file_id = ?1 WHERE id = ?2",
        params![avatar_file_id.map(|i| i.raw() as i64), user_id.raw() as i64],
    )?;
    Ok(())
}

pub fn set_display_name(
    conn: &Connection,
    user_id: Id,
    display_name: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE users SET display_name = ?1 WHERE id = ?2",
        params![display_name, user_id.raw() as i64],
    )?;
    Ok(())
}

pub fn set_owner(conn: &Connection, user_id: Id, is_owner: bool) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE users SET is_owner = ?1 WHERE id = ?2",
        params![is_owner as i64, user_id.raw() as i64],
    )?;
    Ok(())
}

/// Caller must have already checked the new username isn't taken
/// (see `by_username`) — same pattern as registration, rather than
/// relying on catching the column's `UNIQUE` constraint failing.
pub fn set_username(conn: &Connection, user_id: Id, username: &str) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE users SET username = ?1 WHERE id = ?2",
        params![username, user_id.raw() as i64],
    )?;
    Ok(())
}

pub fn set_password_hash(
    conn: &Connection,
    user_id: Id,
    password_hash: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE users SET password_hash = ?1 WHERE id = ?2",
        params![password_hash, user_id.raw() as i64],
    )?;
    Ok(())
}

/// For verifying the *current* password before accepting a change —
/// `by_username_for_login` fetches the same thing but keyed by
/// username, which a change-password request has no reason to carry
/// when it already has an authenticated `CurrentUser`.
pub fn password_hash_by_id(conn: &Connection, user_id: Id) -> rusqlite::Result<Option<String>> {
    conn.query_row(
        "SELECT password_hash FROM users WHERE id = ?1",
        params![user_id.raw() as i64],
        |row| row.get(0),
    )
    .optional()
}

/// Every member of a guild — used for @mention resolution and (later)
/// a member-list UI.
pub fn list_for_guild(conn: &Connection, guild_id: Id) -> rusqlite::Result<Vec<User>> {
    let mut stmt = conn.prepare_cached(&format!(
        "{SELECT_USER} JOIN members mem ON mem.user_id = u.id WHERE mem.guild_id = ?1
         ORDER BY u.display_name"
    ))?;
    let rows = stmt.query_map(params![guild_id.raw() as i64], row_to_user)?;
    rows.collect()
}

/// The bot accounts that are members of a guild — the guild's own
/// "Bots" management tab (see `api::bots`).
pub fn list_bots_for_guild(conn: &Connection, guild_id: Id) -> rusqlite::Result<Vec<User>> {
    let mut stmt = conn.prepare_cached(&format!(
        "{SELECT_USER} JOIN members mem ON mem.user_id = u.id
         WHERE mem.guild_id = ?1 AND u.is_bot = 1
         ORDER BY u.display_name"
    ))?;
    let rows = stmt.query_map(params![guild_id.raw() as i64], row_to_user)?;
    rows.collect()
}

/// The participant(s) of a DM channel — used for @mention resolution
/// there. A self-DM has exactly one row (see `queries::dms`).
pub fn list_for_dm_channel(conn: &Connection, channel_id: Id) -> rusqlite::Result<Vec<User>> {
    let mut stmt = conn.prepare_cached(&format!(
        "{SELECT_USER} JOIN dm_participants dp ON dp.user_id = u.id WHERE dp.channel_id = ?1"
    ))?;
    let rows = stmt.query_map(params![channel_id.raw() as i64], row_to_user)?;
    rows.collect()
}

pub fn list_channel_members(conn: &Connection, channel_id: Id) -> rusqlite::Result<Vec<User>> {
    let mut stmt = conn.prepare_cached(&format!(
        "{SELECT_USER} JOIN channel_members cm ON cm.user_id = u.id WHERE cm.channel_id = ?1
         ORDER BY u.display_name"
    ))?;
    let rows = stmt.query_map(params![channel_id.raw() as i64], row_to_user)?;
    rows.collect()
}

pub fn by_username(conn: &Connection, username: &str) -> rusqlite::Result<Option<User>> {
    conn.query_row(&format!("{SELECT_USER} WHERE u.username = ?1"), params![username], row_to_user)
        .optional()
}

pub fn by_id(conn: &Connection, id: Id) -> rusqlite::Result<Option<User>> {
    conn.query_row(&format!("{SELECT_USER} WHERE u.id = ?1"), params![id.raw() as i64], row_to_user)
        .optional()
}

pub fn by_username_for_login(
    conn: &Connection,
    username: &str,
) -> rusqlite::Result<Option<UserWithPasswordHash>> {
    conn.query_row(
        "SELECT u.password_hash, u.id, u.username, u.display_name, u.is_owner, u.can_invite,
                u.created_at, COALESCE(t.enabled, 0), u.avatar_file_id, u.accepts_friend_requests
         FROM users u
         LEFT JOIN mfa_totp t ON t.user_id = u.id
         -- A bot has no password of its own to log in with (see
         -- api::bots) — excluded here defensively even though nothing
         -- generates a login form for one.
         WHERE u.username = ?1 AND u.deleted_at IS NULL AND u.is_bot = 0 AND u.is_guest = 0",
        params![username],
        |row| {
            let password_hash: String = row.get(0)?;
            let id: i64 = row.get(1)?;
            let avatar_file_id: Option<i64> = row.get(8)?;
            Ok(UserWithPasswordHash {
                password_hash,
                user: User {
                    id: Id::from_raw(id as u64),
                    username: row.get(2)?,
                    display_name: row.get(3)?,
                    is_owner: row.get::<_, i64>(4)? != 0,
                    can_invite: row.get::<_, i64>(5)? != 0,
                    created_at: row.get(6)?,
                    mfa_enabled: row.get::<_, i64>(7)? != 0,
                    avatar_file_id: avatar_file_id.map(|i| Id::from_raw(i as u64)),
                    is_bot: false,
                    is_guest: false,
                    accepts_friend_requests: row.get::<_, i64>(9)? != 0,
                },
            })
        },
    )
    .optional()
}
