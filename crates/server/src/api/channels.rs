//! Member-list management for restricted channels. Who may edit a
//! channel's members is the server-level `MANAGE_CHANNELS` permission
//! (see `permissions::require_channel_manager`) — there are no
//! per-channel admins; administration lives at the server level (roles)
//! and the instance level (the global admin).

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

use protocol::{Id, Permissions};

use serde::Serialize;

use super::current_user::CurrentUser;
use super::error::{AppError, AppResult};
use super::permissions::{require_channel_manager, require_channel_permission};
use crate::models::User;
use crate::state::SharedState;

#[derive(Deserialize)]
pub struct UserIdBody {
    pub user_id: String,
}

#[derive(Serialize)]
pub struct ChannelRoster {
    pub members: Vec<User>,
}

fn parse_id(raw: &str) -> AppResult<Id> {
    raw.parse().map_err(|_| AppError::bad_request("invalid_id", "invalid user id"))
}

/// Anyone who can already see the channel can see its roster — the
/// *management* actions below are what's permission-gated, not looking.
pub async fn roster(
    State(state): State<SharedState>,
    current: CurrentUser,
    Path(channel_id): Path<String>,
) -> AppResult<Json<ChannelRoster>> {
    let channel_id: Id = channel_id
        .parse()
        .map_err(|_| AppError::bad_request("invalid_id", "invalid channel id"))?;
    require_channel_permission(&state, current.user.id, channel_id, Permissions::VIEW_CHANNEL)
        .await?;
    let members = state.storage.list_channel_members(channel_id).await?;
    Ok(Json(ChannelRoster { members }))
}

pub async fn add_member(
    State(state): State<SharedState>,
    current: CurrentUser,
    Path(channel_id): Path<String>,
    Json(body): Json<UserIdBody>,
) -> AppResult<StatusCode> {
    let channel_id: Id = channel_id
        .parse()
        .map_err(|_| AppError::bad_request("invalid_id", "invalid channel id"))?;
    let channel = require_channel_manager(&state, current.user.id, channel_id).await?;
    let user_id = parse_id(&body.user_id)?;

    let guild_id = channel.guild_id.ok_or_else(|| {
        AppError::bad_request("invalid_channel", "DM channels have no member list")
    })?;
    if !state.storage.is_guild_member(guild_id, user_id).await? {
        return Err(AppError::bad_request("not_a_member", "user must be a member of this guild"));
    }

    state.storage.add_channel_member(channel_id, user_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn remove_member(
    State(state): State<SharedState>,
    current: CurrentUser,
    Path((channel_id, user_id)): Path<(String, String)>,
) -> AppResult<StatusCode> {
    let channel_id: Id = channel_id
        .parse()
        .map_err(|_| AppError::bad_request("invalid_id", "invalid channel id"))?;
    require_channel_manager(&state, current.user.id, channel_id).await?;
    let user_id = parse_id(&user_id)?;
    state.storage.remove_channel_member(channel_id, user_id).await?;
    Ok(StatusCode::NO_CONTENT)
}
