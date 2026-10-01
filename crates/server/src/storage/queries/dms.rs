use protocol::Id;
use rusqlite::{params, Connection, OptionalExtension};

use super::channels::SELECT_CHANNEL;
use crate::models::Channel;

/// Finds an existing 1:1 DM channel between exactly these two users, if
/// one exists. Deliberately scoped to exact pairs (`COUNT(*) = 2`) so
/// it can't misfire and return a group DM that happens to include both
/// of them — those are created via `create_group`/`create_group_dm`
/// instead, with no find-or-create dedup.
pub fn find_existing(
    conn: &Connection,
    user_a: Id,
    user_b: Id,
) -> rusqlite::Result<Option<Channel>> {
    conn.query_row(
        &format!(
            "{SELECT_CHANNEL} WHERE guild_id IS NULL AND id IN (
                SELECT channel_id FROM dm_participants WHERE user_id = ?1
                INTERSECT
                SELECT channel_id FROM dm_participants WHERE user_id = ?2
             ) AND id IN (
                SELECT channel_id FROM dm_participants GROUP BY channel_id HAVING COUNT(*) = 2
             )"
        ),
        params![user_a.raw() as i64, user_b.raw() as i64],
        super::channels::row_to_channel,
    )
    .optional()
}

/// The self-DM case: a "channel" with exactly one participant. Used to
/// be identified purely by that count (`dm_participants`' primary key
/// is `(channel_id, user_id)` — you can't insert the same user twice,
/// so a self-DM is structurally a 1-participant channel, not a
/// 2-participant one with both slots pointing at the same user) — but
/// a real 1:1 can *also* end up with exactly one participant once the
/// other side's account is hard-deleted (see UX_FEEDBACK.md), which
/// would otherwise make it misfire and resolve to somebody's old
/// conversation with whoever just got deleted. `is_self_dm`
/// (set only by `create_self`) is the real distinguishing signal now.
pub fn find_existing_self(conn: &Connection, user_id: Id) -> rusqlite::Result<Option<Channel>> {
    conn.query_row(
        &format!(
            "{SELECT_CHANNEL} WHERE guild_id IS NULL AND is_self_dm = 1 AND id IN (
                SELECT channel_id FROM dm_participants WHERE user_id = ?1
             )"
        ),
        params![user_id.raw() as i64],
        super::channels::row_to_channel,
    )
    .optional()
}

pub fn create_self(conn: &Connection, channel_id: Id, user_id: Id) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO channels (id, guild_id, name, kind, position, is_self_dm)
         VALUES (?1, NULL, '', 'text', 0, 1)",
        params![channel_id.raw() as i64],
    )?;
    conn.execute(
        "INSERT INTO dm_participants (channel_id, user_id) VALUES (?1, ?2)",
        params![channel_id.raw() as i64, user_id.raw() as i64],
    )?;
    Ok(())
}

pub fn create(conn: &Connection, channel_id: Id, user_a: Id, user_b: Id) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO channels (id, guild_id, name, kind, position) VALUES (?1, NULL, '', 'text', 0)",
        params![channel_id.raw() as i64],
    )?;
    conn.execute(
        "INSERT INTO dm_participants (channel_id, user_id) VALUES (?1, ?2)",
        params![channel_id.raw() as i64, user_a.raw() as i64],
    )?;
    conn.execute(
        "INSERT INTO dm_participants (channel_id, user_id) VALUES (?1, ?2)",
        params![channel_id.raw() as i64, user_b.raw() as i64],
    )?;
    Ok(())
}

/// Creates a fresh DM channel with `creator` plus every id in
/// `other_ids` as participants — no find-or-create dedup, unlike
/// `create`/`find_existing` (see `create_group_dm` in `storage/mod.rs`).
pub fn create_group(
    conn: &Connection,
    channel_id: Id,
    creator: Id,
    other_ids: &[Id],
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO channels (id, guild_id, name, kind, position) VALUES (?1, NULL, '', 'text', 0)",
        params![channel_id.raw() as i64],
    )?;
    conn.execute(
        "INSERT INTO dm_participants (channel_id, user_id) VALUES (?1, ?2)",
        params![channel_id.raw() as i64, creator.raw() as i64],
    )?;
    for other in other_ids {
        conn.execute(
            "INSERT INTO dm_participants (channel_id, user_id) VALUES (?1, ?2)",
            params![channel_id.raw() as i64, other.raw() as i64],
        )?;
    }
    Ok(())
}

pub fn is_participant(conn: &Connection, channel_id: Id, user_id: Id) -> rusqlite::Result<bool> {
    conn.query_row(
        "SELECT 1 FROM dm_participants WHERE channel_id = ?1 AND user_id = ?2",
        params![channel_id.raw() as i64, user_id.raw() as i64],
        |_| Ok(()),
    )
    .optional()
    .map(|o| o.is_some())
}

/// Every DM channel `user_id` participates in, with the ids of every
/// *other* participant (empty for a self-DM, which the caller fills in),
/// whether `user_id` pinned it, and whether it is a self-DM (`is_self_dm`
/// column; a participant count alone stopped being reliable).
///
/// A channel `user_id` hid (`hidden_dms`) is left out *unless* a message
/// arrived after `hidden_at`; that is a read-time comparison, so creating a
/// message needs no hook. Order: self-DM first, then pinned (latest pin
/// first), then most recent message, falling back to the channel id for a
/// conversation with no messages yet.
/// `(channel, other participant ids, pinned, is_self_dm)`.
pub type DmListRow = (Channel, Vec<Id>, bool, bool);

pub fn list_for_user(conn: &Connection, user_id: Id) -> rusqlite::Result<Vec<DmListRow>> {
    let mut stmt = conn.prepare_cached(&format!(
        "{SELECT_CHANNEL} WHERE guild_id IS NULL
         AND id IN (SELECT channel_id FROM dm_participants WHERE user_id = ?1)
         AND id NOT IN (
           SELECT channel_id FROM hidden_dms
           WHERE user_id = ?1
             AND hidden_at >= COALESCE(
               (SELECT MAX(created_at) FROM messages WHERE messages.channel_id = hidden_dms.channel_id), 0)
         )
         ORDER BY
           channels.is_self_dm DESC,
           (SELECT pinned_at FROM pinned_dms WHERE user_id = ?1 AND channel_id = channels.id) DESC,
           COALESCE((SELECT MAX(id) FROM messages WHERE channel_id = channels.id), channels.id) DESC"
    ))?;
    let channels: Vec<Channel> = stmt
        .query_map(params![user_id.raw() as i64], super::channels::row_to_channel)?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let mut result = Vec::with_capacity(channels.len());
    for channel in channels {
        let mut other_stmt = conn.prepare_cached(
            "SELECT user_id FROM dm_participants WHERE channel_id = ?1 AND user_id != ?2",
        )?;
        let others: Vec<Id> = other_stmt
            .query_map(params![channel.id.raw() as i64, user_id.raw() as i64], |r| {
                let id: i64 = r.get(0)?;
                Ok(Id::from_raw(id as u64))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let pinned = conn
            .query_row(
                "SELECT 1 FROM pinned_dms WHERE user_id = ?1 AND channel_id = ?2",
                params![user_id.raw() as i64, channel.id.raw() as i64],
                |_| Ok(()),
            )
            .optional()?
            .is_some();
        let is_self_dm: bool = conn.query_row(
            "SELECT is_self_dm FROM channels WHERE id = ?1",
            params![channel.id.raw() as i64],
            |r| r.get::<_, i64>(0),
        )? != 0;
        result.push((channel, others, pinned, is_self_dm));
    }
    Ok(result)
}

/// Adds `new_user` as another participant of an existing DM channel —
/// how a 1:1 conversation grows into a group. No cap enforcement here
/// (the caller checks `MAX_GROUP_DM_PARTICIPANTS` first). Never valid
/// on a self-DM — `api::dms::add_participant` and `api::invites::
/// create` refuse it (see `is_self_dm`) — since it left a channel
/// still flagged `is_self_dm` but now shared with someone else, which
/// `find_existing_self` kept resolving to instead of ever creating a
/// fresh private chat: the account's own "You" chat effectively
/// vanished into a conversation with whoever was added.
pub fn add_participant(conn: &Connection, channel_id: Id, new_user: Id) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT OR IGNORE INTO dm_participants (channel_id, user_id) VALUES (?1, ?2)",
        params![channel_id.raw() as i64, new_user.raw() as i64],
    )?;
    Ok(())
}

/// Removes `user_id` from a group DM — how "leave conversation"
/// works. The caller (`api::dms::leave`) already checked this is a
/// real group (3+ participants before removal), so there's no risk of
/// leaving it looking like a self-DM the way removing a 1:1's second
/// participant would (see `hidden_dms` — that's what a 1:1 gets
/// instead).
pub fn remove_participant(conn: &Connection, channel_id: Id, user_id: Id) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM dm_participants WHERE channel_id = ?1 AND user_id = ?2",
        params![channel_id.raw() as i64, user_id.raw() as i64],
    )?;
    Ok(())
}

pub fn is_self_dm(conn: &Connection, channel_id: Id) -> rusqlite::Result<bool> {
    conn.query_row(
        "SELECT is_self_dm FROM channels WHERE id = ?1",
        params![channel_id.raw() as i64],
        |r| r.get::<_, i64>(0),
    )
    .optional()
    .map(|v| v.is_some_and(|flag| flag != 0))
}

pub fn participant_count(conn: &Connection, channel_id: Id) -> rusqlite::Result<i64> {
    conn.query_row(
        "SELECT COUNT(*) FROM dm_participants WHERE channel_id = ?1",
        params![channel_id.raw() as i64],
        |r| r.get(0),
    )
}
