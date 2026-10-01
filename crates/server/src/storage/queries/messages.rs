use std::collections::HashMap;

use protocol::Id;
use rusqlite::{params, Connection, OptionalExtension, Row};

use super::{files, reactions};
use crate::models::{
    ExportedMessage, Message, MessageReplyPreview, MessageWindow, NewMessage, SearchScope,
};

const REPLY_PREVIEW_MAX_CHARS: usize = 120;

// `gdm`/`rgdm` (guild_departed_members) override a message's author
// identity — and, for a reply preview, the *replied-to* message's
// author identity — with a generic "Former member" placeholder when
// that author chose to leave this specific guild anonymized (see
// migration 0019 and UX_FEEDBACK.md) rather than erase their messages
// outright. The join is on `c.guild_id`, so it's a no-op for DM
// channels (`guild_id IS NULL` never matches a `guild_departed_members`
// row) — that anonymize choice only ever exists per-guild. The
// `users` row itself is never touched, so the same account's messages
// everywhere else keep showing their real name/avatar untouched.
const SELECT_MESSAGE: &str = "
    SELECT m.id, m.channel_id, m.author_id,
           CASE WHEN gdm.user_id IS NOT NULL THEN 'Former member' ELSE u.display_name END,
           m.content, m.created_at, m.edited_at,
           CASE WHEN gdm.user_id IS NOT NULL THEN NULL ELSE u.avatar_file_id END,
           m.reply_to,
           CASE WHEN rgdm.user_id IS NOT NULL THEN 'Former member' ELSE ru.display_name END,
           rm.content
    FROM messages m
    JOIN users u ON u.id = m.author_id
    JOIN channels c ON c.id = m.channel_id
    LEFT JOIN guild_departed_members gdm ON gdm.guild_id = c.guild_id AND gdm.user_id = m.author_id
    LEFT JOIN messages rm ON rm.id = m.reply_to
    LEFT JOIN users ru ON ru.id = rm.author_id
    LEFT JOIN guild_departed_members rgdm ON rgdm.guild_id = c.guild_id AND rgdm.user_id = rm.author_id";

fn row_to_message(row: &Row) -> rusqlite::Result<Message> {
    let id: i64 = row.get(0)?;
    let channel_id: i64 = row.get(1)?;
    let author_id: i64 = row.get(2)?;
    let author_avatar_file_id: Option<i64> = row.get(7)?;
    let reply_to: Option<i64> = row.get(8)?;
    let reply_author: Option<String> = row.get(9)?;
    let reply_content: Option<String> = row.get(10)?;
    let reply_preview = reply_author.map(|author_display_name| {
        let content: String = reply_content.unwrap_or_default();
        let truncated = if content.chars().count() > REPLY_PREVIEW_MAX_CHARS {
            let mut s: String = content.chars().take(REPLY_PREVIEW_MAX_CHARS).collect();
            s.push('…');
            s
        } else {
            content
        };
        // Attachment info isn't in this row at all — same reason
        // `attachments` below starts empty and `enrich` fills it in
        // with a separate `files::for_message` lookup, applied here to
        // the *replied-to* message's id instead of this one's.
        MessageReplyPreview {
            author_display_name,
            content: truncated,
            first_attachment: None,
            attachment_count: 0,
        }
    });
    Ok(Message {
        id: Id::from_raw(id as u64),
        channel_id: Id::from_raw(channel_id as u64),
        author_id: Id::from_raw(author_id as u64),
        author_display_name: row.get(3)?,
        author_avatar_file_id: author_avatar_file_id.map(|i| Id::from_raw(i as u64)),
        content: row.get(4)?,
        created_at: row.get(5)?,
        edited_at: row.get(6)?,
        attachments: Vec::new(),
        reactions: Vec::new(),
        mentions: Vec::new(),
        reply_to: reply_to.map(|i| Id::from_raw(i as u64)),
        reply_preview,
    })
}

/// Fills in `attachments`/`reactions`/`mentions`, which `row_to_message`
/// leaves empty (they come from separate tables, not the messages row)
/// — and, for a reply, the replied-to message's own attachments. One
/// query per table for the whole page, not one per message.
fn enrich_all(
    conn: &Connection,
    mut messages: Vec<Message>,
    viewer_id: Id,
) -> rusqlite::Result<Vec<Message>> {
    if messages.is_empty() {
        return Ok(messages);
    }
    let ids: Vec<Id> = messages.iter().map(|m| m.id).collect();
    let mut attachment_ids = ids.clone();
    attachment_ids.extend(messages.iter().filter_map(|m| m.reply_to));
    let mut attachments = files::for_messages(conn, &attachment_ids)?;
    let mut reactions = reactions::summaries_for_messages(conn, &ids, viewer_id)?;
    let mut mentions = mentions_for_messages(conn, &ids)?;
    for msg in &mut messages {
        msg.reactions = reactions.remove(&msg.id).unwrap_or_default();
        msg.mentions = mentions.remove(&msg.id).unwrap_or_default();
        if let (Some(reply_to), Some(preview)) = (msg.reply_to, msg.reply_preview.as_mut()) {
            let reply_attachments = attachments.get(&reply_to).cloned().unwrap_or_default();
            preview.attachment_count = reply_attachments.len() as i64;
            preview.first_attachment = reply_attachments.into_iter().next();
        }
    }
    for msg in &mut messages {
        msg.attachments = attachments.remove(&msg.id).unwrap_or_default();
    }
    Ok(messages)
}

/// Every message `author_id` has ever sent, anywhere — for the GDPR
/// data export (`GET /api/me/export`), not general browsing, so it
/// skips the attachments/reactions/mentions enrichment `list_before`
/// does per message (an export cares about the content itself, not a
/// live reaction summary computed *for this specific viewer*, which
/// wouldn't mean anything outside the app anyway).
pub fn list_by_author(conn: &Connection, author_id: Id) -> rusqlite::Result<Vec<ExportedMessage>> {
    let mut stmt = conn.prepare_cached(
        "SELECT id, channel_id, content, created_at, edited_at FROM messages
         WHERE author_id = ?1 ORDER BY id ASC",
    )?;
    let rows = stmt.query_map(params![author_id.raw() as i64], |row| {
        let id: i64 = row.get(0)?;
        let channel_id: i64 = row.get(1)?;
        Ok(ExportedMessage {
            id: Id::from_raw(id as u64),
            channel_id: Id::from_raw(channel_id as u64),
            content: row.get(2)?,
            created_at: row.get(3)?,
            edited_at: row.get(4)?,
        })
    })?;
    rows.collect()
}

fn mentions_for_messages(
    conn: &Connection,
    message_ids: &[Id],
) -> rusqlite::Result<HashMap<Id, Vec<Id>>> {
    let mut stmt = conn.prepare_cached(
        "SELECT message_id, user_id FROM message_mentions
         WHERE message_id IN (SELECT value FROM json_each(?1))
         ORDER BY message_id, user_id",
    )?;
    let rows = stmt.query_map(params![super::ids_json(message_ids.iter().copied())], |row| {
        let message_id: i64 = row.get(0)?;
        let user_id: i64 = row.get(1)?;
        Ok((Id::from_raw(message_id as u64), Id::from_raw(user_id as u64)))
    })?;
    let mut by_message: HashMap<Id, Vec<Id>> = HashMap::new();
    for row in rows {
        let (message_id, user_id) = row?;
        by_message.entry(message_id).or_default().push(user_id);
    }
    Ok(by_message)
}

pub fn create(conn: &Connection, msg: &NewMessage) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO messages (id, channel_id, author_id, content, created_at, reply_to)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            msg.id.raw() as i64,
            msg.channel_id.raw() as i64,
            msg.author_id.raw() as i64,
            msg.content,
            msg.id.timestamp_ms() as i64,
            msg.reply_to.map(|i| i.raw() as i64),
        ],
    )?;
    for file_id in &msg.attachment_ids {
        files::attach(conn, msg.id, *file_id)?;
    }
    for user_id in &msg.mentions {
        conn.execute(
            "INSERT OR IGNORE INTO message_mentions (message_id, user_id) VALUES (?1, ?2)",
            params![msg.id.raw() as i64, user_id.raw() as i64],
        )?;
    }
    Ok(())
}

pub fn delete(conn: &Connection, id: Id) -> rusqlite::Result<()> {
    // `reply_to` has no ON DELETE action (see migration 0003) — under
    // PRAGMA foreign_keys=ON, deleting a message other messages reply
    // to would otherwise fail with a foreign key violation. Null out
    // those references first; their reply_preview just becomes None
    // (rendered client-side as "original message deleted"), which is
    // the correct behavior anyway.
    conn.execute(
        "UPDATE messages SET reply_to = NULL WHERE reply_to = ?1",
        params![id.raw() as i64],
    )?;
    conn.execute("DELETE FROM messages WHERE id = ?1", params![id.raw() as i64])?;
    Ok(())
}

/// Updates content and `edited_at`, and replaces the mention set to
/// match the freshly re-parsed content. The window/authorship checks
/// happen in `api::messages::edit`, not here.
pub fn edit(
    conn: &Connection,
    id: Id,
    content: &str,
    mentions: &[Id],
    edited_at: i64,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE messages SET content = ?1, edited_at = ?2 WHERE id = ?3",
        params![content, edited_at, id.raw() as i64],
    )?;
    conn.execute("DELETE FROM message_mentions WHERE message_id = ?1", params![id.raw() as i64])?;
    for user_id in mentions {
        conn.execute(
            "INSERT OR IGNORE INTO message_mentions (message_id, user_id) VALUES (?1, ?2)",
            params![id.raw() as i64, user_id.raw() as i64],
        )?;
    }
    Ok(())
}

pub fn by_id(conn: &Connection, id: Id, viewer_id: Id) -> rusqlite::Result<Option<Message>> {
    let base = conn
        .query_row(
            &format!("{SELECT_MESSAGE} WHERE m.id = ?1"),
            params![id.raw() as i64],
            row_to_message,
        )
        .optional()?;
    match base {
        Some(m) => Ok(enrich_all(conn, vec![m], viewer_id)?.pop()),
        None => Ok(None),
    }
}

/// Returns up to `limit` messages older than `before` (or the newest
/// `limit` if `before` is `None`), oldest-first — ready for the client
/// to append directly to the bottom of a message list.
pub fn list_before(
    conn: &Connection,
    channel_id: Id,
    before: Option<Id>,
    limit: i64,
    viewer_id: Id,
) -> rusqlite::Result<Vec<Message>> {
    let mut messages = match before {
        Some(before) => {
            let mut stmt = conn.prepare_cached(&format!(
                "{SELECT_MESSAGE} WHERE m.channel_id = ?1 AND m.id < ?2 ORDER BY m.id DESC LIMIT ?3"
            ))?;
            let rows = stmt
                .query_map(
                    params![channel_id.raw() as i64, before.raw() as i64, limit],
                    row_to_message,
                )?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            rows
        }
        None => {
            let mut stmt = conn.prepare_cached(&format!(
                "{SELECT_MESSAGE} WHERE m.channel_id = ?1 ORDER BY m.id DESC LIMIT ?2"
            ))?;
            let rows = stmt
                .query_map(params![channel_id.raw() as i64, limit], row_to_message)?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            rows
        }
    };
    messages.reverse();
    enrich_all(conn, messages, viewer_id)
}

/// Ids of messages matching the FTS5 `match_query`, newest first, older
/// than `before` if given. `match_query` must already be a safe FTS5
/// expression (built by `api::search::build_match_query`).
pub fn search_ids(
    conn: &Connection,
    match_query: &str,
    scope: SearchScope,
    before: Option<Id>,
    limit: i64,
) -> rusqlite::Result<Vec<Id>> {
    let (scope_sql, scope_id) = match scope {
        SearchScope::Channel(id) => ("m.channel_id = ?2", id),
        SearchScope::Guild(id) => ("c.guild_id = ?2", id),
        SearchScope::Dms(user) => (
            "c.guild_id IS NULL AND m.channel_id IN \
             (SELECT channel_id FROM dm_participants WHERE user_id = ?2)",
            user,
        ),
    };
    let sql = format!(
        "SELECT m.id FROM messages_fts f
         JOIN messages m ON m.id = f.rowid
         JOIN channels c ON c.id = m.channel_id
         WHERE messages_fts MATCH ?1 AND {scope_sql} AND m.id < ?3
         ORDER BY m.id DESC LIMIT ?4"
    );
    let mut stmt = conn.prepare_cached(&sql)?;
    let before = before.map(|b| b.raw() as i64).unwrap_or(i64::MAX);
    let rows = stmt
        .query_map(params![match_query, scope_id.raw() as i64, before, limit], |row| {
            row.get::<_, i64>(0).map(|id| Id::from_raw(id as u64))
        })?;
    rows.collect()
}

/// Up to `limit` messages of `channel_id` for `window`, oldest first.
pub fn list_window(
    conn: &Connection,
    channel_id: Id,
    window: MessageWindow,
    limit: i64,
    viewer_id: Id,
) -> rusqlite::Result<Vec<Message>> {
    match window {
        MessageWindow::Latest => list_before(conn, channel_id, None, limit, viewer_id),
        MessageWindow::Before(id) => list_before(conn, channel_id, Some(id), limit, viewer_id),
        MessageWindow::After(id) => list_after(conn, channel_id, id, limit, viewer_id),
        MessageWindow::Around(id) => {
            // The target and the messages before it (`before` is exclusive,
            // so ask for everything below the next id), then what follows.
            let half = (limit / 2).max(1);
            let next = Id::from_raw(id.raw().saturating_add(1));
            let mut window = list_before(conn, channel_id, Some(next), half + 1, viewer_id)?;
            window.extend(list_after(conn, channel_id, id, half, viewer_id)?);
            Ok(window)
        }
    }
}

/// Up to `limit` messages newer than `after`, oldest first.
pub fn list_after(
    conn: &Connection,
    channel_id: Id,
    after: Id,
    limit: i64,
    viewer_id: Id,
) -> rusqlite::Result<Vec<Message>> {
    let mut stmt = conn.prepare_cached(&format!(
        "{SELECT_MESSAGE} WHERE m.channel_id = ?1 AND m.id > ?2 ORDER BY m.id ASC LIMIT ?3"
    ))?;
    let rows = stmt
        .query_map(params![channel_id.raw() as i64, after.raw() as i64, limit], row_to_message)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    enrich_all(conn, rows, viewer_id)
}
