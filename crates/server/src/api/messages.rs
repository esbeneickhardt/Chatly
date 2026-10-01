use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

use protocol::{Id, Permissions};

use super::current_user::CurrentUser;
use super::error::{AppError, AppResult};
use super::permissions::{
    broadcast_room, broadcast_updated_message, can_moderate_channel, require_channel_permission,
};
use crate::gateway::DispatchEvent;
use crate::models::{Message, MessageWindow, NewMessage, User};
use crate::state::SharedState;
use crate::time::now_ms;

const MAX_MESSAGE_LEN: usize = 4000;
const MAX_ATTACHMENTS_PER_MESSAGE: usize = 10;
const DEFAULT_PAGE_SIZE: i64 = 50;
const MAX_PAGE_SIZE: i64 = 100;
const EDIT_WINDOW_MS: i64 = 5 * 60 * 1000;

#[derive(Deserialize)]
pub struct ListQuery {
    /// Older than this message (scrolling up)…
    pub before: Option<String>,
    /// …newer than it (scrolling down after a jump)…
    pub after: Option<String>,
    /// …or that message with context on both sides. At most one.
    pub around: Option<String>,
    pub limit: Option<i64>,
}

pub async fn list(
    State(state): State<SharedState>,
    current: CurrentUser,
    Path(channel_id): Path<String>,
    Query(query): Query<ListQuery>,
) -> AppResult<Json<Vec<Message>>> {
    let channel_id: Id = channel_id
        .parse()
        .map_err(|_| AppError::bad_request("invalid_id", "invalid channel id"))?;
    require_channel_permission(&state, current.user.id, channel_id, Permissions::VIEW_CHANNEL)
        .await?;

    let parse = |raw: &Option<String>, what: &str| -> AppResult<Option<Id>> {
        raw.as_deref()
            .map(str::parse::<Id>)
            .transpose()
            .map_err(|_| AppError::bad_request("invalid_id", format!("invalid {what} id")))
    };
    let window = match (
        parse(&query.before, "before")?,
        parse(&query.after, "after")?,
        parse(&query.around, "around")?,
    ) {
        (None, None, None) => MessageWindow::Latest,
        (Some(id), None, None) => MessageWindow::Before(id),
        (None, Some(id), None) => MessageWindow::After(id),
        (None, None, Some(id)) => MessageWindow::Around(id),
        _ => {
            return Err(AppError::bad_request(
                "invalid_window",
                "use at most one of before, after, around",
            ))
        }
    };
    let limit = query.limit.unwrap_or(DEFAULT_PAGE_SIZE).clamp(1, MAX_PAGE_SIZE);

    Ok(Json(state.storage.list_messages(channel_id, window, limit, current.user.id).await?))
}

#[derive(Deserialize)]
pub struct CreateMessageRequest {
    #[serde(default)]
    pub content: String,
    #[serde(default)]
    pub attachment_ids: Vec<String>,
    #[serde(default)]
    pub reply_to: Option<String>,
}

pub async fn create(
    State(state): State<SharedState>,
    current: CurrentUser,
    Path(channel_id): Path<String>,
    Json(body): Json<CreateMessageRequest>,
) -> AppResult<Json<Message>> {
    let channel_id: Id = channel_id
        .parse()
        .map_err(|_| AppError::bad_request("invalid_id", "invalid channel id"))?;
    let channel =
        require_channel_permission(&state, current.user.id, channel_id, Permissions::SEND_MESSAGES)
            .await?;

    let content = body.content.trim();
    if content.chars().count() > MAX_MESSAGE_LEN {
        return Err(AppError::bad_request(
            "message_too_long",
            format!("message content must be at most {MAX_MESSAGE_LEN} characters"),
        ));
    }
    if body.attachment_ids.len() > MAX_ATTACHMENTS_PER_MESSAGE {
        return Err(AppError::bad_request(
            "too_many_attachments",
            format!("at most {MAX_ATTACHMENTS_PER_MESSAGE} attachments per message"),
        ));
    }
    let attachment_ids = body
        .attachment_ids
        .iter()
        .map(|s| s.parse::<Id>())
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| AppError::bad_request("invalid_id", "invalid attachment id"))?;
    if content.is_empty() && attachment_ids.is_empty() {
        return Err(AppError::bad_request(
            "empty_message",
            "message content cannot be empty without an attachment",
        ));
    }

    // Only a message with an `@` can mention anyone, so only then is the
    // member list worth loading.
    let mentions = if content.contains('@') {
        let candidates: Vec<User> = match channel.guild_id {
            Some(guild_id) => state.storage.list_guild_members(guild_id).await?,
            None => state.storage.list_dm_participant_users(channel_id).await?,
        };
        extract_mentions(content, &candidates)
    } else {
        Vec::new()
    };

    let reply_to = match body.reply_to.as_deref().filter(|s| !s.is_empty()) {
        Some(raw) => {
            let reply_id: Id = raw
                .parse()
                .map_err(|_| AppError::bad_request("invalid_id", "invalid reply_to id"))?;
            // The replied-to message must be in the *same* channel —
            // otherwise a client could probe whether a message id
            // exists in a channel it can't see by watching whether
            // reply_to is accepted.
            let reply_channel =
                state.storage.channel_for_message(reply_id).await?.ok_or_else(|| {
                    AppError::bad_request("invalid_reply", "replied-to message not found")
                })?;
            if reply_channel != channel_id {
                return Err(AppError::bad_request(
                    "invalid_reply",
                    "can only reply to a message in the same channel",
                ));
            }
            Some(reply_id)
        }
        None => None,
    };

    let message = state
        .storage
        .create_message(NewMessage {
            id: state.snowflake.next_id(),
            channel_id,
            author_id: current.user.id,
            content: content.to_string(),
            attachment_ids,
            mentions,
            reply_to,
        })
        .await?;

    // Published only after the DB transaction backing create_message has
    // committed, per PLAN.md 2.3: "every mutating REST call publishes
    // its event after the DB transaction commits."
    state.gateway.publish(broadcast_room(&channel), DispatchEvent::MessageCreate(message.clone()));

    Ok(Json(message))
}

#[derive(Deserialize)]
pub struct EditMessageRequest {
    pub content: String,
}

pub async fn edit(
    State(state): State<SharedState>,
    current: CurrentUser,
    Path(message_id): Path<String>,
    Json(body): Json<EditMessageRequest>,
) -> AppResult<Json<Message>> {
    let message_id: Id = message_id
        .parse()
        .map_err(|_| AppError::bad_request("invalid_id", "invalid message id"))?;

    let channel_id = state
        .storage
        .channel_for_message(message_id)
        .await?
        .ok_or_else(|| AppError::not_found("not_found", "message not found"))?;
    let channel =
        require_channel_permission(&state, current.user.id, channel_id, Permissions::VIEW_CHANNEL)
            .await?;

    let existing = state
        .storage
        .get_message(message_id, current.user.id)
        .await?
        .ok_or_else(|| AppError::not_found("not_found", "message not found"))?;
    if existing.author_id != current.user.id {
        return Err(AppError::forbidden("forbidden", "you can only edit your own messages"));
    }
    if now_ms() - existing.created_at > EDIT_WINDOW_MS {
        return Err(AppError::bad_request(
            "edit_window_expired",
            "messages can only be edited within 5 minutes of being sent",
        ));
    }

    let content = body.content.trim();
    if content.is_empty() {
        return Err(AppError::bad_request("empty_message", "message content cannot be empty"));
    }
    if content.chars().count() > MAX_MESSAGE_LEN {
        return Err(AppError::bad_request(
            "message_too_long",
            format!("message content must be at most {MAX_MESSAGE_LEN} characters"),
        ));
    }

    // Only a message with an `@` can mention anyone, so only then is the
    // member list worth loading.
    let mentions = if content.contains('@') {
        let candidates: Vec<User> = match channel.guild_id {
            Some(guild_id) => state.storage.list_guild_members(guild_id).await?,
            None => state.storage.list_dm_participant_users(channel_id).await?,
        };
        extract_mentions(content, &candidates)
    } else {
        Vec::new()
    };

    state.storage.edit_message(message_id, content.to_string(), mentions, now_ms()).await?;

    Ok(Json(broadcast_updated_message(&state, message_id, current.user.id).await?))
}

pub async fn delete(
    State(state): State<SharedState>,
    current: CurrentUser,
    Path(message_id): Path<String>,
) -> AppResult<StatusCode> {
    let message_id: Id = message_id
        .parse()
        .map_err(|_| AppError::bad_request("invalid_id", "invalid message id"))?;

    let channel_id = state
        .storage
        .channel_for_message(message_id)
        .await?
        .ok_or_else(|| AppError::not_found("not_found", "message not found"))?;
    let channel =
        require_channel_permission(&state, current.user.id, channel_id, Permissions::VIEW_CHANNEL)
            .await?;

    let existing = state
        .storage
        .get_message(message_id, current.user.id)
        .await?
        .ok_or_else(|| AppError::not_found("not_found", "message not found"))?;

    let is_author = existing.author_id == current.user.id;
    if !is_author && !can_moderate_channel(&state, current.user.id, &channel).await? {
        return Err(AppError::forbidden("forbidden", "you can't delete this message"));
    }

    state.storage.delete_message(message_id).await?;
    state
        .gateway
        .publish(broadcast_room(&channel), DispatchEvent::MessageDelete { channel_id, message_id });
    Ok(StatusCode::NO_CONTENT)
}

/// Scans `content` for `@username` occurrences (word-boundary checked
/// on the trailing side only — "@bob" inside "@bobby" doesn't count,
/// but there's no leading-boundary check, so "x@bob" does; good enough
/// for a first version) matching one of `candidates`, and returns the
/// matched users' ids. `candidates` scopes who can be mentioned to
/// people who can actually see the message (guild members, or the DM's
/// participant(s)) rather than trusting arbitrary usernames typed by
/// the client.
fn extract_mentions(content: &str, candidates: &[User]) -> Vec<Id> {
    let mut mentioned = Vec::new();
    for user in candidates {
        let pattern = format!("@{}", user.username);
        if let Some(pos) = content.find(&pattern) {
            let end = pos + pattern.len();
            let boundary_ok = content
                .as_bytes()
                .get(end)
                .is_none_or(|b| !(b.is_ascii_alphanumeric() || *b == b'_' || *b == b'-'));
            if boundary_ok {
                mentioned.push(user.id);
            }
        }
    }
    mentioned
}
