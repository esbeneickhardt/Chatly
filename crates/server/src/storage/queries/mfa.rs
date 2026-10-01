use protocol::Id;
use rusqlite::{params, Connection, OptionalExtension};

use crate::models::TotpRecord;

pub fn set_pending(
    conn: &Connection,
    user_id: Id,
    secret_enc: &[u8],
    now: i64,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO mfa_totp (user_id, secret_enc, enabled, created_at) VALUES (?1, ?2, 0, ?3)
         ON CONFLICT(user_id) DO UPDATE SET secret_enc = excluded.secret_enc, enabled = 0, last_step = NULL",
        params![user_id.raw() as i64, secret_enc, now],
    )?;
    Ok(())
}

pub fn get(conn: &Connection, user_id: Id) -> rusqlite::Result<Option<TotpRecord>> {
    conn.query_row(
        "SELECT secret_enc, enabled, last_step FROM mfa_totp WHERE user_id = ?1",
        params![user_id.raw() as i64],
        |row| {
            Ok(TotpRecord {
                secret_enc: row.get(0)?,
                enabled: row.get::<_, i64>(1)? != 0,
                last_step: row.get(2)?,
            })
        },
    )
    .optional()
}

pub fn enable(conn: &Connection, user_id: Id, step: u64) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE mfa_totp SET enabled = 1, last_step = ?2 WHERE user_id = ?1",
        params![user_id.raw() as i64, step as i64],
    )?;
    Ok(())
}

pub fn disable(conn: &Connection, user_id: Id) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM mfa_totp WHERE user_id = ?1", params![user_id.raw() as i64])?;
    conn.execute("DELETE FROM mfa_recovery WHERE user_id = ?1", params![user_id.raw() as i64])?;
    Ok(())
}

pub fn update_last_step(conn: &Connection, user_id: Id, step: u64) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE mfa_totp SET last_step = ?2 WHERE user_id = ?1",
        params![user_id.raw() as i64, step as i64],
    )?;
    Ok(())
}

pub fn replace_recovery_codes(
    conn: &Connection,
    user_id: Id,
    hashes: &[String],
) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM mfa_recovery WHERE user_id = ?1", params![user_id.raw() as i64])?;
    for hash in hashes {
        conn.execute(
            "INSERT INTO mfa_recovery (user_id, code_hash) VALUES (?1, ?2)",
            params![user_id.raw() as i64, hash],
        )?;
    }
    Ok(())
}

pub fn consume_recovery_code(
    conn: &Connection,
    user_id: Id,
    code_hash: &str,
) -> rusqlite::Result<bool> {
    let id: Option<i64> = conn
        .query_row(
            "SELECT id FROM mfa_recovery WHERE user_id = ?1 AND code_hash = ?2 AND used_at IS NULL",
            params![user_id.raw() as i64, code_hash],
            |row| row.get(0),
        )
        .optional()?;

    match id {
        Some(id) => {
            conn.execute(
                "UPDATE mfa_recovery SET used_at = CAST(strftime('%s','now') AS INTEGER) * 1000 WHERE id = ?1",
                params![id],
            )?;
            Ok(true)
        }
        None => Ok(false),
    }
}
