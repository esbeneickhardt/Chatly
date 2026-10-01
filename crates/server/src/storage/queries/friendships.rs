use protocol::Id;
use rusqlite::{params, Connection, OptionalExtension};

use super::users::{self, SELECT_USER};
use crate::models::User;

/// Friendships are stored once per pair under a canonical
/// `(min, max)` ordering — see migration 0011 — so every query and
/// write goes through this to stay consistent about which id is
/// `user_a_id` and which is `user_b_id`.
fn canonical(a: Id, b: Id) -> (Id, Id) {
    if a.raw() < b.raw() {
        (a, b)
    } else {
        (b, a)
    }
}

pub fn add(conn: &Connection, a: Id, b: Id, created_at: i64) -> rusqlite::Result<()> {
    let (a, b) = canonical(a, b);
    conn.execute(
        "INSERT OR IGNORE INTO friendships (user_a_id, user_b_id, created_at) VALUES (?1, ?2, ?3)",
        params![a.raw() as i64, b.raw() as i64, created_at],
    )?;
    Ok(())
}

pub fn are_friends(conn: &Connection, a: Id, b: Id) -> rusqlite::Result<bool> {
    let (a, b) = canonical(a, b);
    conn.query_row(
        "SELECT 1 FROM friendships WHERE user_a_id = ?1 AND user_b_id = ?2",
        params![a.raw() as i64, b.raw() as i64],
        |_| Ok(()),
    )
    .optional()
    .map(|o| o.is_some())
}

pub fn remove(conn: &Connection, a: Id, b: Id) -> rusqlite::Result<bool> {
    let (a, b) = canonical(a, b);
    let affected = conn.execute(
        "DELETE FROM friendships WHERE user_a_id = ?1 AND user_b_id = ?2",
        params![a.raw() as i64, b.raw() as i64],
    )?;
    Ok(affected > 0)
}

/// Every friend of `user_id`, as full `User` rows — `user_id` can land
/// on either side of a friendship row depending on canonical ordering,
/// so this checks both and returns whichever id *isn't* `user_id`.
pub fn list_for_user(conn: &Connection, user_id: Id) -> rusqlite::Result<Vec<User>> {
    let mut stmt = conn.prepare_cached(&format!(
        "{SELECT_USER} WHERE u.id IN (
            SELECT user_b_id FROM friendships WHERE user_a_id = ?1
            UNION
            SELECT user_a_id FROM friendships WHERE user_b_id = ?1
         )
         ORDER BY u.display_name COLLATE NOCASE"
    ))?;
    let rows = stmt.query_map(params![user_id.raw() as i64], users::row_to_user)?;
    rows.collect()
}
