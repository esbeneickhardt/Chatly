use protocol::Id;
use rusqlite::{params, Connection};

use crate::models::{AuditEntry, NewAuditEntry};

pub fn record(conn: &Connection, entry: &NewAuditEntry, created_at: i64) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO audit_log
           (id, guild_id, actor_id, actor_name, action, target_id, target_name, detail, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            entry.id.raw() as i64,
            entry.guild_id.map(|g| g.raw() as i64),
            entry.actor_id.map(|a| a.raw() as i64),
            entry.actor_name,
            entry.action,
            entry.target_id.map(|t| t.raw() as i64),
            entry.target_name,
            entry.detail,
            created_at,
        ],
    )?;
    Ok(())
}

/// Entries for one server (`Some`) or for the deployment as a whole
/// (`None`), newest first, older than `before` if given.
pub fn list(
    conn: &Connection,
    guild_id: Option<Id>,
    before: Option<Id>,
    limit: i64,
) -> rusqlite::Result<Vec<AuditEntry>> {
    let mut stmt = conn.prepare_cached(
        "SELECT id, guild_id, actor_id, actor_name, action, target_id, target_name, detail, created_at
         FROM audit_log
         WHERE guild_id IS ?1 AND id < ?2
         ORDER BY id DESC LIMIT ?3",
    )?;
    let rows = stmt.query_map(
        params![
            guild_id.map(|g| g.raw() as i64),
            before.map(|b| b.raw() as i64).unwrap_or(i64::MAX),
            limit
        ],
        |row| {
            let id = |i: usize| -> rusqlite::Result<Option<Id>> {
                Ok(row.get::<_, Option<i64>>(i)?.map(|v| Id::from_raw(v as u64)))
            };
            Ok(AuditEntry {
                id: Id::from_raw(row.get::<_, i64>(0)? as u64),
                guild_id: id(1)?,
                actor_id: id(2)?,
                actor_name: row.get(3)?,
                action: row.get(4)?,
                target_id: id(5)?,
                target_name: row.get(6)?,
                detail: row.get(7)?,
                created_at: row.get(8)?,
            })
        },
    )?;
    rows.collect()
}
