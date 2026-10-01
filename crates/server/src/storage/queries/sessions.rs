use protocol::Id;
use rusqlite::{params, Connection, OptionalExtension};

use super::users;
use crate::models::{NewSession, Session, SessionWithUser};

pub fn insert(conn: &Connection, s: &NewSession) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at, last_seen, user_agent)
         VALUES (?1, ?2, ?3, ?4, ?5, ?4, ?6)",
        params![
            s.id.raw() as i64,
            s.user_id.raw() as i64,
            s.token_hash,
            s.created_at,
            s.expires_at,
            s.user_agent,
        ],
    )?;
    Ok(())
}

pub fn by_token_hash(
    conn: &Connection,
    token_hash: &str,
    now: i64,
) -> rusqlite::Result<Option<SessionWithUser>> {
    let row: Option<(i64, i64, i64)> = conn
        .query_row(
            "SELECT id, user_id, last_seen FROM sessions WHERE token_hash = ?1 AND expires_at > ?2",
            params![token_hash, now],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()?;

    let Some((session_id, user_id, last_seen)) = row else {
        return Ok(None);
    };
    let uid = Id::from_raw(user_id as u64);
    let user = users::by_id(conn, uid)?;
    let guest_expires_at = users::guest_expires_at(conn, uid)?;
    Ok(user.map(|user| SessionWithUser {
        session_id: Id::from_raw(session_id as u64),
        last_seen,
        user,
        guest_expires_at,
    }))
}

pub fn touch_last_seen(conn: &Connection, id: Id, now: i64) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE sessions SET last_seen = ?1 WHERE id = ?2",
        params![now, id.raw() as i64],
    )?;
    Ok(())
}

pub fn delete(conn: &Connection, id: Id, user_id: Id) -> rusqlite::Result<bool> {
    let affected = conn.execute(
        "DELETE FROM sessions WHERE id = ?1 AND user_id = ?2",
        params![id.raw() as i64, user_id.raw() as i64],
    )?;
    Ok(affected > 0)
}

pub fn delete_all_for_user(conn: &Connection, user_id: Id) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM sessions WHERE user_id = ?1", params![user_id.raw() as i64])?;
    Ok(())
}

/// Like `delete_all_for_user`, but keeps `except_id` alive — for
/// "log out every *other* device" (Active Sessions' "Remove all"),
/// which unlike `delete_all_for_user`/`logout-all` shouldn't also log
/// the very session that asked for it out.
pub fn delete_all_for_user_except(
    conn: &Connection,
    user_id: Id,
    except_id: Id,
) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM sessions WHERE user_id = ?1 AND id != ?2",
        params![user_id.raw() as i64, except_id.raw() as i64],
    )?;
    Ok(())
}

pub fn list_for_user(conn: &Connection, user_id: Id) -> rusqlite::Result<Vec<Session>> {
    let mut stmt = conn.prepare_cached(
        "SELECT id, created_at, expires_at, last_seen, user_agent
         FROM sessions WHERE user_id = ?1 ORDER BY id DESC",
    )?;
    let rows = stmt.query_map(params![user_id.raw() as i64], |row| {
        let id: i64 = row.get(0)?;
        Ok(Session {
            id: Id::from_raw(id as u64),
            created_at: row.get(1)?,
            expires_at: row.get(2)?,
            last_seen: row.get(3)?,
            user_agent: row.get(4)?,
            is_current: false,
        })
    })?;
    rows.collect()
}
