use protocol::Id;
use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::models::{Invite, NewInvite};

const SELECT_INVITE: &str =
    "SELECT id, code, created_by, created_at, expires_at, max_uses, uses, revoked, channel_id FROM invites";

fn row_to_invite(row: &Row) -> rusqlite::Result<Invite> {
    let id: i64 = row.get(0)?;
    let created_by: i64 = row.get(2)?;
    let channel_id: Option<i64> = row.get(8)?;
    Ok(Invite {
        id: Id::from_raw(id as u64),
        code: row.get(1)?,
        created_by: Id::from_raw(created_by as u64),
        created_at: row.get(3)?,
        expires_at: row.get(4)?,
        max_uses: row.get(5)?,
        uses: row.get(6)?,
        revoked: row.get::<_, i64>(7)? != 0,
        channel_id: channel_id.map(|c| Id::from_raw(c as u64)),
    })
}

pub fn insert(conn: &Connection, inv: &NewInvite) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO invites (id, code, created_by, created_at, expires_at, max_uses, channel_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            inv.id.raw() as i64,
            inv.code,
            inv.created_by.raw() as i64,
            inv.created_at,
            inv.expires_at,
            inv.max_uses,
            inv.channel_id.map(|c| c.raw() as i64),
        ],
    )?;
    Ok(())
}

pub fn list(conn: &Connection) -> rusqlite::Result<Vec<Invite>> {
    let mut stmt = conn.prepare_cached(&format!("{SELECT_INVITE} ORDER BY id DESC"))?;
    let rows = stmt.query_map([], row_to_invite)?;
    rows.collect()
}

pub fn by_code(conn: &Connection, code: &str) -> rusqlite::Result<Option<Invite>> {
    conn.query_row(&format!("{SELECT_INVITE} WHERE code = ?1"), params![code], row_to_invite)
        .optional()
}

pub fn revoke(conn: &Connection, id: Id) -> rusqlite::Result<bool> {
    let affected =
        conn.execute("UPDATE invites SET revoked = 1 WHERE id = ?1", params![id.raw() as i64])?;
    Ok(affected > 0)
}

pub fn increment_use(conn: &Connection, id: Id) -> rusqlite::Result<()> {
    conn.execute("UPDATE invites SET uses = uses + 1 WHERE id = ?1", params![id.raw() as i64])?;
    Ok(())
}
