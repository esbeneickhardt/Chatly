use std::collections::HashMap;

use protocol::Id;
use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::models::{FileMeta, NewFile};

fn row_to_file_meta(row: &Row) -> rusqlite::Result<FileMeta> {
    let id: i64 = row.get(0)?;
    Ok(FileMeta {
        id: Id::from_raw(id as u64),
        filename: row.get(1)?,
        mime: row.get(2)?,
        size: row.get(3)?,
    })
}

pub fn create(conn: &Connection, f: &NewFile) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO files (id, uploader_id, filename, mime, size, sha256, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            f.id.raw() as i64,
            f.uploader_id.raw() as i64,
            f.filename,
            f.mime,
            f.size,
            f.sha256,
            f.id.timestamp_ms() as i64,
        ],
    )?;
    Ok(())
}

pub fn by_id(conn: &Connection, id: Id) -> rusqlite::Result<Option<FileMeta>> {
    conn.query_row(
        "SELECT id, filename, mime, size FROM files WHERE id = ?1",
        params![id.raw() as i64],
        row_to_file_meta,
    )
    .optional()
}

/// Who uploaded a file — used to check ownership before letting
/// someone attach an arbitrary existing file id as e.g. a guild icon.
pub fn uploader_of(conn: &Connection, file_id: Id) -> rusqlite::Result<Option<Id>> {
    conn.query_row(
        "SELECT uploader_id FROM files WHERE id = ?1",
        params![file_id.raw() as i64],
        |row| {
            let uploader_id: i64 = row.get(0)?;
            Ok(Id::from_raw(uploader_id as u64))
        },
    )
    .optional()
}

pub fn attach(conn: &Connection, message_id: Id, file_id: Id) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT OR IGNORE INTO message_attachments (message_id, file_id) VALUES (?1, ?2)",
        params![message_id.raw() as i64, file_id.raw() as i64],
    )?;
    Ok(())
}

/// The attachments of every message in `message_ids`, in one query.
pub fn for_messages(
    conn: &Connection,
    message_ids: &[Id],
) -> rusqlite::Result<HashMap<Id, Vec<FileMeta>>> {
    let mut stmt = conn.prepare_cached(
        "SELECT ma.message_id, f.id, f.filename, f.mime, f.size FROM files f
         JOIN message_attachments ma ON ma.file_id = f.id
         WHERE ma.message_id IN (SELECT value FROM json_each(?1)) ORDER BY f.id",
    )?;
    let rows = stmt.query_map(params![super::ids_json(message_ids.iter().copied())], |row| {
        let message_id: i64 = row.get(0)?;
        let id: i64 = row.get(1)?;
        Ok((
            Id::from_raw(message_id as u64),
            FileMeta {
                id: Id::from_raw(id as u64),
                filename: row.get(2)?,
                mime: row.get(3)?,
                size: row.get(4)?,
            },
        ))
    })?;
    let mut by_message: HashMap<Id, Vec<FileMeta>> = HashMap::new();
    for row in rows {
        let (message_id, file) = row?;
        by_message.entry(message_id).or_default().push(file);
    }
    Ok(by_message)
}

/// The channel a file is servable through: the channel of any message
/// it's attached to. An uploaded-but-never-attached file has none, so
/// nobody but its own uploader (see `download`'s separate ownership
/// check) can fetch it until it's actually posted somewhere.
pub fn channel_for_file(conn: &Connection, file_id: Id) -> rusqlite::Result<Option<Id>> {
    conn.query_row(
        "SELECT m.channel_id FROM message_attachments ma
         JOIN messages m ON m.id = ma.message_id
         WHERE ma.file_id = ?1 LIMIT 1",
        params![file_id.raw() as i64],
        |row| {
            let channel_id: i64 = row.get(0)?;
            Ok(Id::from_raw(channel_id as u64))
        },
    )
    .optional()
}
