use protocol::Id;
use rusqlite::{params, Connection, OptionalExtension};

use super::users;
use crate::models::FriendRequest;

/// The bare row shape (no joined `User`) — used internally where the
/// caller only needs to know a request exists and who it's between,
/// not render it.
pub struct FriendRequestRow {
    pub id: Id,
    pub sender_id: Id,
    pub recipient_id: Id,
}

pub fn create(
    conn: &Connection,
    sender: Id,
    recipient: Id,
    id: Id,
    created_at: i64,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO friend_requests (id, sender_id, recipient_id, created_at) VALUES (?1, ?2, ?3, ?4)",
        params![id.raw() as i64, sender.raw() as i64, recipient.raw() as i64, created_at],
    )?;
    Ok(())
}

pub fn by_id(conn: &Connection, id: Id) -> rusqlite::Result<Option<FriendRequestRow>> {
    conn.query_row(
        "SELECT id, sender_id, recipient_id FROM friend_requests WHERE id = ?1",
        params![id.raw() as i64],
        |row| {
            let id: i64 = row.get(0)?;
            let sender_id: i64 = row.get(1)?;
            let recipient_id: i64 = row.get(2)?;
            Ok(FriendRequestRow {
                id: Id::from_raw(id as u64),
                sender_id: Id::from_raw(sender_id as u64),
                recipient_id: Id::from_raw(recipient_id as u64),
            })
        },
    )
    .optional()
}

/// A pending request between these two users in *either* direction —
/// used to detect the "you both invited each other" mutual case.
pub fn between(conn: &Connection, a: Id, b: Id) -> rusqlite::Result<Option<FriendRequestRow>> {
    conn.query_row(
        "SELECT id, sender_id, recipient_id FROM friend_requests
         WHERE (sender_id = ?1 AND recipient_id = ?2) OR (sender_id = ?2 AND recipient_id = ?1)",
        params![a.raw() as i64, b.raw() as i64],
        |row| {
            let id: i64 = row.get(0)?;
            let sender_id: i64 = row.get(1)?;
            let recipient_id: i64 = row.get(2)?;
            Ok(FriendRequestRow {
                id: Id::from_raw(id as u64),
                sender_id: Id::from_raw(sender_id as u64),
                recipient_id: Id::from_raw(recipient_id as u64),
            })
        },
    )
    .optional()
}

pub fn delete(conn: &Connection, id: Id) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM friend_requests WHERE id = ?1", params![id.raw() as i64])?;
    Ok(())
}

/// Every pending request touching `user_id`, in either direction, each
/// paired with the *other* person's full `User` row and whether it's
/// incoming (they sent it to you) or outgoing (you sent it to them).
pub fn list_for_user(conn: &Connection, user_id: Id) -> rusqlite::Result<Vec<FriendRequest>> {
    let mut stmt = conn.prepare_cached(
        "SELECT id, sender_id, recipient_id, created_at FROM friend_requests
         WHERE sender_id = ?1 OR recipient_id = ?1
         ORDER BY created_at DESC",
    )?;
    let rows: Vec<(Id, Id, Id, i64)> = stmt
        .query_map(params![user_id.raw() as i64], |row| {
            let id: i64 = row.get(0)?;
            let sender_id: i64 = row.get(1)?;
            let recipient_id: i64 = row.get(2)?;
            let created_at: i64 = row.get(3)?;
            Ok((
                Id::from_raw(id as u64),
                Id::from_raw(sender_id as u64),
                Id::from_raw(recipient_id as u64),
                created_at,
            ))
        })?
        .collect::<rusqlite::Result<_>>()?;

    let mut result = Vec::with_capacity(rows.len());
    for (id, sender_id, recipient_id, created_at) in rows {
        let incoming = recipient_id == user_id;
        let other_id = if incoming { sender_id } else { recipient_id };
        let other = users::by_id(conn, other_id)?.ok_or(rusqlite::Error::QueryReturnedNoRows)?;
        result.push(FriendRequest { id, other, created_at, incoming });
    }
    Ok(result)
}
