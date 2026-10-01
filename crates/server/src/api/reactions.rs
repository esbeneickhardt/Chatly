use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;

use protocol::{Id, Permissions};

use super::current_user::CurrentUser;
use super::error::{AppError, AppResult};
use super::permissions::{broadcast_updated_message, require_channel_permission};
use crate::models::{Message, ALLOWED_REACTIONS};
use crate::state::SharedState;

fn validate_emoji(emoji: &str) -> AppResult<()> {
    if ALLOWED_REACTIONS.contains(&emoji) {
        Ok(())
    } else {
        Err(AppError::bad_request("invalid_emoji", "not a supported reaction emoji"))
    }
}

pub async fn add(
    State(state): State<SharedState>,
    current: CurrentUser,
    Path((message_id, emoji)): Path<(String, String)>,
) -> AppResult<Json<Message>> {
    validate_emoji(&emoji)?;
    let message_id: Id = message_id
        .parse()
        .map_err(|_| AppError::bad_request("invalid_id", "invalid message id"))?;

    let channel_id = state
        .storage
        .channel_for_message(message_id)
        .await?
        .ok_or_else(|| AppError::not_found("not_found", "message not found"))?;
    require_channel_permission(&state, current.user.id, channel_id, Permissions::VIEW_CHANNEL)
        .await?;

    state.storage.add_reaction(message_id, current.user.id, &emoji).await?;
    Ok(Json(broadcast_updated_message(&state, message_id, current.user.id).await?))
}

pub async fn remove(
    State(state): State<SharedState>,
    current: CurrentUser,
    Path((message_id, emoji)): Path<(String, String)>,
) -> AppResult<StatusCode> {
    validate_emoji(&emoji)?;
    let message_id: Id = message_id
        .parse()
        .map_err(|_| AppError::bad_request("invalid_id", "invalid message id"))?;

    let channel_id = state
        .storage
        .channel_for_message(message_id)
        .await?
        .ok_or_else(|| AppError::not_found("not_found", "message not found"))?;
    require_channel_permission(&state, current.user.id, channel_id, Permissions::VIEW_CHANNEL)
        .await?;

    state.storage.remove_reaction(message_id, current.user.id, &emoji).await?;
    broadcast_updated_message(&state, message_id, current.user.id).await?;
    Ok(StatusCode::NO_CONTENT)
}
