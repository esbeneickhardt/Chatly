use protocol::Id;
use rusqlite::{params, Connection, OptionalExtension};

pub fn insert(
    conn: &Connection,
    token_hash: &str,
    user_id: Id,
    created_by: Id,
    created_at: i64,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO bot_tokens (token_hash, user_id, created_at, created_by) VALUES (?1, ?2, ?3, ?4)",
        params![token_hash, user_id.raw() as i64, created_at, created_by.raw() as i64],
    )?;
    Ok(())
}

/// Resolves a bearer token straight to the bot's user id — the bot
/// equivalent of `sessions::by_token_hash`, but with no expiry to
/// check (see `bot_tokens`' own doc comment on why these don't expire
/// the way a session does).
pub fn user_id_for_token(conn: &Connection, token_hash: &str) -> rusqlite::Result<Option<Id>> {
    conn.query_row(
        "SELECT user_id FROM bot_tokens WHERE token_hash = ?1",
        params![token_hash],
        |row| {
            let id: i64 = row.get(0)?;
            Ok(Id::from_raw(id as u64))
        },
    )
    .optional()
}

pub fn revoke(conn: &Connection, user_id: Id) -> rusqlite::Result<bool> {
    let affected =
        conn.execute("DELETE FROM bot_tokens WHERE user_id = ?1", params![user_id.raw() as i64])?;
    Ok(affected > 0)
}
