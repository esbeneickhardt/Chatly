use protocol::Id;
use rusqlite::{params, Connection};

/// Hiding is a read-time filter (see `dms::list_for_user`'s
/// `hidden_at >= last message` check), so a new message arriving
/// un-hides a conversation automatically with no write needed. `unhide`
/// below is for the *deliberate* case — reopening a chat right now.
pub fn hide(
    conn: &Connection,
    user_id: Id,
    channel_id: Id,
    hidden_at: i64,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT OR REPLACE INTO hidden_dms (user_id, channel_id, hidden_at) VALUES (?1, ?2, ?3)",
        params![user_id.raw() as i64, channel_id.raw() as i64, hidden_at],
    )?;
    Ok(())
}

pub fn unhide(conn: &Connection, user_id: Id, channel_id: Id) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM hidden_dms WHERE user_id = ?1 AND channel_id = ?2",
        params![user_id.raw() as i64, channel_id.raw() as i64],
    )?;
    Ok(())
}
