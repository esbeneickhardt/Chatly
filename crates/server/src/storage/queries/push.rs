use protocol::Id;
use rusqlite::{params, Connection};

use super::ids_json;
use crate::models::PushSubscription;

/// How many devices one account keeps notifications on; the oldest goes
/// when another is added.
const MAX_PER_USER: i64 = 10;

/// Saves a subscription for `session_id`. A known endpoint (the same browser
/// subscribing again, maybe under another account) is moved to it.
pub fn upsert(
    conn: &Connection,
    user_id: Id,
    session_id: Id,
    sub: &PushSubscription,
    now: i64,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO push_subscriptions (user_id, session_id, endpoint, p256dh, auth, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(endpoint) DO UPDATE SET
             user_id = excluded.user_id, session_id = excluded.session_id,
             p256dh = excluded.p256dh, auth = excluded.auth, created_at = excluded.created_at",
        params![
            user_id.raw() as i64,
            session_id.raw() as i64,
            sub.endpoint,
            sub.p256dh,
            sub.auth,
            now
        ],
    )?;
    conn.execute(
        "DELETE FROM push_subscriptions WHERE user_id = ?1 AND id NOT IN (
             SELECT id FROM push_subscriptions WHERE user_id = ?1
             ORDER BY created_at DESC, id DESC LIMIT ?2)",
        params![user_id.raw() as i64, MAX_PER_USER],
    )?;
    Ok(())
}

pub fn delete_for_user(conn: &Connection, user_id: Id, endpoint: &str) -> rusqlite::Result<bool> {
    let affected = conn.execute(
        "DELETE FROM push_subscriptions WHERE user_id = ?1 AND endpoint = ?2",
        params![user_id.raw() as i64, endpoint],
    )?;
    Ok(affected > 0)
}

pub fn delete_endpoint(conn: &Connection, endpoint: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM push_subscriptions WHERE endpoint = ?1", params![endpoint])?;
    Ok(())
}

/// Every subscription of `user_ids` whose session is still valid.
pub fn for_users(
    conn: &Connection,
    user_ids: &[Id],
    now: i64,
) -> rusqlite::Result<Vec<PushSubscription>> {
    let mut stmt = conn.prepare_cached(
        "SELECT p.endpoint, p.p256dh, p.auth FROM push_subscriptions p
         JOIN sessions s ON s.id = p.session_id
         WHERE p.user_id IN (SELECT value FROM json_each(?1)) AND s.expires_at > ?2",
    )?;
    let rows = stmt.query_map(params![ids_json(user_ids.iter().copied()), now], |row| {
        Ok(PushSubscription { endpoint: row.get(0)?, p256dh: row.get(1)?, auth: row.get(2)? })
    })?;
    rows.collect()
}
