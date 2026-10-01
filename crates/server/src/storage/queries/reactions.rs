use std::collections::HashMap;

use protocol::Id;
use rusqlite::{params, Connection, OptionalExtension};

use crate::models::ReactionSummary;

pub fn add(
    conn: &Connection,
    message_id: Id,
    user_id: Id,
    emoji: &str,
    now: i64,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT OR IGNORE INTO reactions (message_id, user_id, emoji, created_at) VALUES (?1, ?2, ?3, ?4)",
        params![message_id.raw() as i64, user_id.raw() as i64, emoji, now],
    )?;
    Ok(())
}

pub fn remove(conn: &Connection, message_id: Id, user_id: Id, emoji: &str) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM reactions WHERE message_id = ?1 AND user_id = ?2 AND emoji = ?3",
        params![message_id.raw() as i64, user_id.raw() as i64, emoji],
    )?;
    Ok(())
}

/// The reaction summary of every message in `message_ids`, as seen by
/// `viewer_id`, in one query.
pub fn summaries_for_messages(
    conn: &Connection,
    message_ids: &[Id],
    viewer_id: Id,
) -> rusqlite::Result<HashMap<Id, Vec<ReactionSummary>>> {
    let mut stmt = conn.prepare_cached(
        "SELECT message_id, emoji, COUNT(*), MAX(CASE WHEN user_id = ?2 THEN 1 ELSE 0 END)
         FROM reactions WHERE message_id IN (SELECT value FROM json_each(?1))
         GROUP BY message_id, emoji
         ORDER BY message_id, MIN(created_at)",
    )?;
    let rows = stmt.query_map(
        params![super::ids_json(message_ids.iter().copied()), viewer_id.raw() as i64],
        |row| {
            let message_id: i64 = row.get(0)?;
            Ok((
                Id::from_raw(message_id as u64),
                ReactionSummary {
                    emoji: row.get(1)?,
                    count: row.get(2)?,
                    reacted_by_me: row.get::<_, i64>(3)? != 0,
                },
            ))
        },
    )?;
    let mut by_message: HashMap<Id, Vec<ReactionSummary>> = HashMap::new();
    for row in rows {
        let (message_id, summary) = row?;
        by_message.entry(message_id).or_default().push(summary);
    }
    Ok(by_message)
}

pub fn channel_for_message(conn: &Connection, message_id: Id) -> rusqlite::Result<Option<Id>> {
    conn.query_row(
        "SELECT channel_id FROM messages WHERE id = ?1",
        params![message_id.raw() as i64],
        |row| {
            let channel_id: i64 = row.get(0)?;
            Ok(Id::from_raw(channel_id as u64))
        },
    )
    .optional()
}
