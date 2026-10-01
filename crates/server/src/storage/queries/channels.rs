use protocol::Id;
use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::models::{Channel, ChannelKind};

pub(super) const SELECT_CHANNEL: &str =
    "SELECT id, guild_id, name, kind, position, topic, created_by, restricted FROM channels";

pub(super) fn row_to_channel(row: &Row) -> rusqlite::Result<Channel> {
    let id: i64 = row.get(0)?;
    let guild_id: Option<i64> = row.get(1)?;
    let kind_str: String = row.get(3)?;
    let created_by: Option<i64> = row.get(6)?;
    Ok(Channel {
        id: Id::from_raw(id as u64),
        guild_id: guild_id.map(|g| Id::from_raw(g as u64)),
        name: row.get(2)?,
        kind: ChannelKind::parse(&kind_str).unwrap_or(ChannelKind::Text),
        position: row.get(4)?,
        topic: row.get(5)?,
        created_by: created_by.map(|i| Id::from_raw(i as u64)),
        restricted: row.get::<_, i64>(7)? != 0,
        can_manage: false,
        can_moderate: false,
    })
}

/// Used only by guild bootstrap (the default `general`/`General`
/// channels) — no specific creator, never restricted.
pub fn create_text_channel(
    conn: &Connection,
    id: Id,
    guild_id: Id,
    name: &str,
    position: i64,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO channels (id, guild_id, name, kind, position) VALUES (?1, ?2, ?3, 'text', ?4)",
        params![id.raw() as i64, guild_id.raw() as i64, name, position],
    )?;
    Ok(())
}

/// Used only by guild bootstrap — see `create_text_channel`.
pub fn create_voice_channel(
    conn: &Connection,
    id: Id,
    guild_id: Id,
    name: &str,
    position: i64,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO channels (id, guild_id, name, kind, position) VALUES (?1, ?2, ?3, 'voice', ?4)",
        params![id.raw() as i64, guild_id.raw() as i64, name, position],
    )?;
    Ok(())
}

/// Used by the user-facing "create a channel" endpoint — always has a
/// creator, and may be restricted.
#[allow(clippy::too_many_arguments)]
pub fn create(
    conn: &Connection,
    id: Id,
    guild_id: Id,
    name: &str,
    kind: &str,
    position: i64,
    created_by: Id,
    restricted: bool,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO channels (id, guild_id, name, kind, position, created_by, restricted)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            id.raw() as i64,
            guild_id.raw() as i64,
            name,
            kind,
            position,
            created_by.raw() as i64,
            restricted as i64,
        ],
    )?;
    Ok(())
}

pub fn delete(conn: &Connection, id: Id) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM channels WHERE id = ?1", params![id.raw() as i64])?;
    Ok(())
}

pub fn by_id(conn: &Connection, id: Id) -> rusqlite::Result<Option<Channel>> {
    conn.query_row(
        &format!("{SELECT_CHANNEL} WHERE id = ?1"),
        params![id.raw() as i64],
        row_to_channel,
    )
    .optional()
}

pub fn list_for_guild(conn: &Connection, guild_id: Id) -> rusqlite::Result<Vec<Channel>> {
    let mut stmt = conn
        .prepare_cached(&format!("{SELECT_CHANNEL} WHERE guild_id = ?1 ORDER BY position, id"))?;
    let rows = stmt.query_map(params![guild_id.raw() as i64], row_to_channel)?;
    rows.collect()
}

/// Like `list_for_guild`, but omits restricted channels `viewer_id`
/// can't access — they shouldn't even know such a channel exists. A
/// server admin (`viewer_sees_all`: the owner, or an `ADMINISTRATOR`
/// holder) always sees everything.
pub fn list_for_guild_visible_to(
    conn: &Connection,
    guild_id: Id,
    viewer_id: Id,
    viewer_sees_all: bool,
) -> rusqlite::Result<Vec<Channel>> {
    let all = list_for_guild(conn, guild_id)?;
    if viewer_sees_all {
        return Ok(all);
    }
    all.into_iter()
        .filter(|c| !c.restricted || can_access_restricted(conn, c.id, viewer_id).unwrap_or(false))
        .map(Ok)
        .collect()
}

/// Whether `user_id` is on restricted channel `channel_id`'s member
/// list — does *not* check `restricted` itself or whether they're a
/// server admin; callers combine this with those as needed.
pub fn can_access_restricted(
    conn: &Connection,
    channel_id: Id,
    user_id: Id,
) -> rusqlite::Result<bool> {
    is_member(conn, channel_id, user_id)
}

pub fn is_member(conn: &Connection, channel_id: Id, user_id: Id) -> rusqlite::Result<bool> {
    conn.query_row(
        "SELECT 1 FROM channel_members WHERE channel_id = ?1 AND user_id = ?2",
        params![channel_id.raw() as i64, user_id.raw() as i64],
        |_| Ok(()),
    )
    .optional()
    .map(|o| o.is_some())
}

pub fn add_member(conn: &Connection, channel_id: Id, user_id: Id) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT OR IGNORE INTO channel_members (channel_id, user_id) VALUES (?1, ?2)",
        params![channel_id.raw() as i64, user_id.raw() as i64],
    )?;
    Ok(())
}

pub fn remove_member(conn: &Connection, channel_id: Id, user_id: Id) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM channel_members WHERE channel_id = ?1 AND user_id = ?2",
        params![channel_id.raw() as i64, user_id.raw() as i64],
    )?;
    Ok(())
}
