use protocol::Id;
use rusqlite::{params, Connection};

pub fn pin(conn: &Connection, user_id: Id, channel_id: Id, pinned_at: i64) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT OR REPLACE INTO pinned_dms (user_id, channel_id, pinned_at) VALUES (?1, ?2, ?3)",
        params![user_id.raw() as i64, channel_id.raw() as i64, pinned_at],
    )?;
    Ok(())
}

pub fn unpin(conn: &Connection, user_id: Id, channel_id: Id) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM pinned_dms WHERE user_id = ?1 AND channel_id = ?2",
        params![user_id.raw() as i64, channel_id.raw() as i64],
    )?;
    Ok(())
}
