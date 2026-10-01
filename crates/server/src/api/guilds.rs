use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};

use protocol::{Id, Permissions};

use super::audit;
use super::current_user::CurrentUser;
use super::error::{AppError, AppResult};
use super::permissions::{
    annotate_channels, guild_permissions_for, require_channel_manager, require_guild_permission,
};
use crate::models::{Channel, ChannelKind, Guild, GuildLeaveMode, User};
use crate::state::SharedState;

pub async fn list_mine(
    State(state): State<SharedState>,
    current: CurrentUser,
) -> AppResult<Json<Vec<Guild>>> {
    Ok(Json(state.storage.list_guilds_for_user(current.user.id).await?))
}

#[derive(Deserialize)]
pub struct CreateGuildRequest {
    pub name: String,
    #[serde(default)]
    pub icon_file_id: Option<String>,
}

pub async fn create(
    State(state): State<SharedState>,
    current: CurrentUser,
    Json(body): Json<CreateGuildRequest>,
) -> AppResult<Json<Guild>> {
    let name = body.name.trim();
    if name.is_empty() || name.chars().count() > 100 {
        return Err(AppError::bad_request("invalid_name", "server name must be 1-100 characters"));
    }

    let icon_file_id = match body.icon_file_id.as_deref().filter(|s| !s.is_empty()) {
        Some(raw) => {
            let file_id: Id = raw
                .parse()
                .map_err(|_| AppError::bad_request("invalid_id", "invalid icon file id"))?;
            let uploader = state.storage.file_uploader(file_id).await?;
            if uploader != Some(current.user.id) {
                return Err(AppError::bad_request(
                    "invalid_icon",
                    "icon must be a file you uploaded yourself",
                ));
            }
            Some(file_id)
        }
        None => None,
    };

    let guild = state
        .storage
        .create_guild(
            state.snowflake.next_id(),
            name.to_string(),
            current.user.id,
            state.snowflake.next_id(),
            state.snowflake.next_id(),
            icon_file_id,
        )
        .await?;
    Ok(Json(guild))
}

pub async fn list_channels(
    State(state): State<SharedState>,
    current: CurrentUser,
    Path(guild_id): Path<String>,
) -> AppResult<Json<Vec<Channel>>> {
    let guild_id: Id =
        guild_id.parse().map_err(|_| AppError::bad_request("invalid_id", "invalid guild id"))?;
    let guild = state
        .storage
        .get_guild(guild_id)
        .await?
        .ok_or_else(|| AppError::not_found("not_found", "guild not found"))?;
    if !state.storage.is_guild_member(guild_id, current.user.id).await? {
        return Err(AppError::forbidden("forbidden", "not a member of this guild"));
    }
    // Server admins (the owner, or anyone holding `ADMINISTRATOR`) see
    // every channel, including restricted ones they aren't listed on.
    let sees_all = guild_permissions_for(&state, current.user.id, guild_id)
        .await?
        .contains(Permissions::ADMINISTRATOR);
    let mut channels =
        state.storage.list_channels_visible_to(guild_id, current.user.id, sees_all).await?;
    annotate_channels(&state, current.user.id, &guild, &mut channels).await?;
    Ok(Json(channels))
}

pub async fn list_members(
    State(state): State<SharedState>,
    current: CurrentUser,
    Path(guild_id): Path<String>,
) -> AppResult<Json<Vec<User>>> {
    let guild_id: Id =
        guild_id.parse().map_err(|_| AppError::bad_request("invalid_id", "invalid guild id"))?;
    if !state.storage.is_guild_member(guild_id, current.user.id).await? {
        return Err(AppError::forbidden("forbidden", "not a member of this guild"));
    }
    Ok(Json(state.storage.list_guild_members(guild_id).await?))
}

pub async fn get(
    State(state): State<SharedState>,
    current: CurrentUser,
    Path(guild_id): Path<String>,
) -> AppResult<Json<Guild>> {
    let guild_id: Id =
        guild_id.parse().map_err(|_| AppError::bad_request("invalid_id", "invalid guild id"))?;
    if !state.storage.is_guild_member(guild_id, current.user.id).await? {
        return Err(AppError::not_found("not_found", "guild not found"));
    }
    let mut guild = state
        .storage
        .get_guild(guild_id)
        .await?
        .ok_or_else(|| AppError::not_found("not_found", "guild not found"))?;
    let everyone =
        state.storage.everyone_permissions(guild_id).await?.unwrap_or(Permissions::empty());
    guild.invites_open = everyone.contains(Permissions::CREATE_INVITE);
    guild.viewer_permissions = guild_permissions_for(&state, current.user.id, guild_id).await?;
    Ok(Json(guild))
}

#[derive(Deserialize)]
pub struct UpdateGuildRequest {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub icon_file_id: Option<String>,
}

pub async fn update(
    State(state): State<SharedState>,
    current: CurrentUser,
    Path(guild_id): Path<String>,
    Json(body): Json<UpdateGuildRequest>,
) -> AppResult<Json<Guild>> {
    let guild_id: Id =
        guild_id.parse().map_err(|_| AppError::bad_request("invalid_id", "invalid guild id"))?;
    require_guild_permission(&state, current.user.id, guild_id, Permissions::MANAGE_GUILD).await?;

    let name = match body.name.as_deref().map(str::trim) {
        Some(name) if name.is_empty() || name.chars().count() > 100 => {
            return Err(AppError::bad_request(
                "invalid_name",
                "server name must be 1-100 characters",
            ));
        }
        Some(name) => Some(name.to_string()),
        None => None,
    };

    let icon_file_id = match body.icon_file_id.as_deref().filter(|s| !s.is_empty()) {
        Some(raw) => {
            let file_id: Id = raw
                .parse()
                .map_err(|_| AppError::bad_request("invalid_id", "invalid icon file id"))?;
            let uploader = state.storage.file_uploader(file_id).await?;
            if uploader != Some(current.user.id) {
                return Err(AppError::bad_request(
                    "invalid_icon",
                    "icon must be a file you uploaded yourself",
                ));
            }
            Some(file_id)
        }
        None => None,
    };

    if name.is_none() && icon_file_id.is_none() {
        return Err(AppError::bad_request("empty_update", "nothing to update"));
    }

    let detail = match (name.is_some(), icon_file_id.is_some()) {
        (true, true) => "name and icon",
        (true, false) => "name",
        _ => "icon",
    };
    let updated = state.storage.update_guild(guild_id, name, icon_file_id).await?;
    audit::record(
        &state,
        Some(guild_id),
        &current.user,
        "guild.update",
        None,
        Some(updated.name.clone()),
        Some(detail.to_string()),
    )
    .await;
    Ok(Json(updated))
}

#[derive(Deserialize)]
pub struct SetInvitePolicyRequest {
    pub open: bool,
}

pub async fn set_invite_policy(
    State(state): State<SharedState>,
    current: CurrentUser,
    Path(guild_id): Path<String>,
    Json(body): Json<SetInvitePolicyRequest>,
) -> AppResult<StatusCode> {
    let guild_id: Id =
        guild_id.parse().map_err(|_| AppError::bad_request("invalid_id", "invalid guild id"))?;
    require_guild_permission(&state, current.user.id, guild_id, Permissions::MANAGE_GUILD).await?;
    state.storage.set_guild_invites_open(guild_id, body.open).await?;
    audit::record(
        &state,
        Some(guild_id),
        &current.user,
        "guild.invite_policy",
        None,
        None,
        Some(if body.open { "open" } else { "closed" }.to_string()),
    )
    .await;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn remove_member(
    State(state): State<SharedState>,
    current: CurrentUser,
    Path((guild_id, user_id)): Path<(String, String)>,
) -> AppResult<StatusCode> {
    let guild_id: Id =
        guild_id.parse().map_err(|_| AppError::bad_request("invalid_id", "invalid guild id"))?;
    let user_id: Id =
        user_id.parse().map_err(|_| AppError::bad_request("invalid_id", "invalid user id"))?;
    let guild =
        require_guild_permission(&state, current.user.id, guild_id, Permissions::KICK_MEMBERS)
            .await?;

    if user_id == guild.owner_id {
        return Err(AppError::bad_request("cannot_kick_owner", "the owner can't be removed"));
    }
    if user_id == current.user.id {
        return Err(AppError::bad_request(
            "cannot_kick_self",
            "use \"leave server\" instead of removing yourself",
        ));
    }

    // A server admin can only be removed by the owner — otherwise a
    // member with just `KICK_MEMBERS` could eject the people running the
    // server.
    if current.user.id != guild.owner_id
        && state
            .storage
            .member_roles(guild_id, user_id)
            .await?
            .iter()
            .any(|r| r.permissions.contains(Permissions::ADMINISTRATOR))
    {
        return Err(AppError::forbidden(
            "forbidden",
            "only the server owner can remove a server admin",
        ));
    }

    let target_name = state.storage.get_user_by_id(user_id).await?.map(|u| u.display_name);
    if state.storage.remove_guild_member(guild_id, user_id).await? {
        audit::record(
            &state,
            Some(guild_id),
            &current.user,
            "member.kick",
            Some(user_id),
            target_name,
            None,
        )
        .await;
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(AppError::not_found("not_found", "that user isn't a member of this guild"))
    }
}

#[derive(Deserialize)]
pub struct LeaveGuildRequest {
    /// "erase" or "anonymize" — see `GuildLeaveMode`. The account
    /// holder's own choice for what happens to their message history
    /// in *this* guild; their account itself is untouched either way.
    pub mode: String,
}

fn parse_leave_mode(raw: &str) -> AppResult<GuildLeaveMode> {
    match raw {
        "erase" => Ok(GuildLeaveMode::Erase),
        "anonymize" => Ok(GuildLeaveMode::Anonymize),
        _ => Err(AppError::bad_request("invalid_mode", "mode must be \"erase\" or \"anonymize\"")),
    }
}

/// The account holder leaving on their own terms — distinct from
/// `remove_member` (the owner/an admin removing *someone else*) and
/// from deleting the whole account (`auth::delete_account`, which now
/// always erases everything, everywhere, with no choice to make). The
/// owner can't leave at all — there's no automatic "pick a new owner,"
/// same precondition every other destructive guild action already has
/// (transfer ownership first).
pub async fn leave(
    State(state): State<SharedState>,
    current: CurrentUser,
    Path(guild_id): Path<String>,
    Json(body): Json<LeaveGuildRequest>,
) -> AppResult<StatusCode> {
    let guild_id: Id =
        guild_id.parse().map_err(|_| AppError::bad_request("invalid_id", "invalid guild id"))?;
    let mode = parse_leave_mode(&body.mode)?;
    let guild = state
        .storage
        .get_guild(guild_id)
        .await?
        .ok_or_else(|| AppError::not_found("not_found", "guild not found"))?;
    if guild.owner_id == current.user.id {
        return Err(AppError::bad_request("is_owner", "transfer ownership to someone else first"));
    }
    if !state.storage.is_guild_member(guild_id, current.user.id).await? {
        return Err(AppError::bad_request("not_a_member", "you're not a member of this server"));
    }
    state.storage.leave_guild(guild_id, current.user.id, mode).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
pub struct TransferOwnershipRequest {
    pub user_id: String,
}

pub async fn transfer_ownership(
    State(state): State<SharedState>,
    current: CurrentUser,
    Path(guild_id): Path<String>,
    Json(body): Json<TransferOwnershipRequest>,
) -> AppResult<Json<Guild>> {
    let guild_id: Id =
        guild_id.parse().map_err(|_| AppError::bad_request("invalid_id", "invalid guild id"))?;
    let new_owner: Id =
        body.user_id.parse().map_err(|_| AppError::bad_request("invalid_id", "invalid user id"))?;

    let guild = state
        .storage
        .get_guild(guild_id)
        .await?
        .ok_or_else(|| AppError::not_found("not_found", "guild not found"))?;
    // Ownership transfer is deliberately gated on actually *being* the
    // owner, not a permission bit — it's the one action nothing should
    // ever be able to delegate.
    if guild.owner_id != current.user.id {
        return Err(AppError::forbidden("forbidden", "only the owner can transfer ownership"));
    }
    if new_owner == current.user.id {
        return Err(AppError::bad_request("already_owner", "you already own this server"));
    }
    if !state.storage.is_guild_member(guild_id, new_owner).await? {
        return Err(AppError::bad_request(
            "not_a_member",
            "you can only transfer ownership to a current member",
        ));
    }

    state.storage.transfer_guild_ownership(guild_id, new_owner).await?;
    let new_owner_name = state.storage.get_user_by_id(new_owner).await?.map(|u| u.display_name);
    audit::record(
        &state,
        Some(guild_id),
        &current.user,
        "guild.transfer",
        Some(new_owner),
        new_owner_name,
        None,
    )
    .await;
    Ok(Json(
        state
            .storage
            .get_guild(guild_id)
            .await?
            .ok_or_else(|| AppError::internal("server vanished while updating it"))?,
    ))
}

pub async fn delete(
    State(state): State<SharedState>,
    current: CurrentUser,
    Path(guild_id): Path<String>,
) -> AppResult<StatusCode> {
    let guild_id: Id =
        guild_id.parse().map_err(|_| AppError::bad_request("invalid_id", "invalid guild id"))?;
    let guild = state
        .storage
        .get_guild(guild_id)
        .await?
        .ok_or_else(|| AppError::not_found("not_found", "guild not found"))?;
    if guild.owner_id != current.user.id {
        return Err(AppError::forbidden("forbidden", "only the owner can delete this server"));
    }
    state.storage.delete_guild(guild_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Serialize)]
pub struct VoiceParticipant {
    pub channel_id: Id,
    pub user_id: Id,
}

/// A point-in-time snapshot of who's connected to which voice channel
/// in this guild — for a client that just opened the guild and hasn't
/// seen any live `VOICE_STATE_UPDATE` events yet.
pub async fn voice_state(
    State(state): State<SharedState>,
    current: CurrentUser,
    Path(guild_id): Path<String>,
) -> AppResult<Json<Vec<VoiceParticipant>>> {
    let guild_id: Id =
        guild_id.parse().map_err(|_| AppError::bad_request("invalid_id", "invalid guild id"))?;
    if !state.storage.is_guild_member(guild_id, current.user.id).await? {
        return Err(AppError::forbidden("forbidden", "not a member of this guild"));
    }
    Ok(Json(
        state
            .gateway
            .voice_participants(guild_id)
            .into_iter()
            .map(|(channel_id, user_id)| VoiceParticipant { channel_id, user_id })
            .collect(),
    ))
}

#[derive(Deserialize)]
pub struct CreateChannelRequest {
    pub name: String,
    pub kind: String,
    #[serde(default)]
    pub member_ids: Vec<String>,
}

pub async fn create_channel(
    State(state): State<SharedState>,
    current: CurrentUser,
    Path(guild_id): Path<String>,
    Json(body): Json<CreateChannelRequest>,
) -> AppResult<Json<Channel>> {
    let guild_id: Id =
        guild_id.parse().map_err(|_| AppError::bad_request("invalid_id", "invalid guild id"))?;
    require_guild_permission(&state, current.user.id, guild_id, Permissions::MANAGE_CHANNELS)
        .await?;

    let name = body.name.trim();
    if name.is_empty() || name.chars().count() > 100 {
        return Err(AppError::bad_request("invalid_name", "channel name must be 1-100 characters"));
    }
    let kind = match body.kind.as_str() {
        "text" => ChannelKind::Text,
        "voice" => ChannelKind::Voice,
        _ => return Err(AppError::bad_request("invalid_kind", "kind must be 'text' or 'voice'")),
    };
    let member_ids = body
        .member_ids
        .iter()
        .map(|s| s.parse::<Id>())
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| AppError::bad_request("invalid_id", "invalid member id"))?;

    let existing = state.storage.list_channels_for_guild(guild_id).await?;
    let position = existing.len() as i64;

    // Every channel requires being explicitly added to see it — there's
    // no "open to the whole guild" option, so this is always `true`,
    // not something the client gets to choose (see UX_FEEDBACK.md).
    let mut channel = state
        .storage
        .create_channel(
            guild_id,
            state.snowflake.next_id(),
            name.to_string(),
            kind,
            position,
            current.user.id,
            true,
            member_ids,
        )
        .await?;
    audit::record(
        &state,
        Some(guild_id),
        &current.user,
        "channel.create",
        Some(channel.id),
        Some(channel.name.clone()),
        None,
    )
    .await;
    // Creating a channel takes `MANAGE_CHANNELS`, so the creator can
    // manage it (and moderate it) by definition.
    channel.can_manage = true;
    channel.can_moderate = true;
    Ok(Json(channel))
}

pub async fn delete_channel(
    State(state): State<SharedState>,
    current: CurrentUser,
    Path((guild_id, channel_id)): Path<(String, String)>,
) -> AppResult<StatusCode> {
    let guild_id: Id =
        guild_id.parse().map_err(|_| AppError::bad_request("invalid_id", "invalid guild id"))?;
    let channel_id: Id = channel_id
        .parse()
        .map_err(|_| AppError::bad_request("invalid_id", "invalid channel id"))?;
    let channel = require_channel_manager(&state, current.user.id, channel_id).await?;
    if channel.guild_id != Some(guild_id) {
        return Err(AppError::not_found("not_found", "channel not found in this guild"));
    }
    state.storage.delete_channel(channel_id).await?;
    audit::record(
        &state,
        Some(guild_id),
        &current.user,
        "channel.delete",
        Some(channel_id),
        Some(channel.name.clone()),
        None,
    )
    .await;
    Ok(StatusCode::NO_CONTENT)
}

// Guild-scoped invite creation and joining used to live here as their
// own separate system (`/guilds/:id/invites`, `/guild-invite/<code>`,
// `POST /guilds/join`) — replaced by the unified invite system in
// `api::invites` (any invite can target a channel, guild or DM, and
// the same `/invite/<code>` link both registers a brand-new account
// and lets an existing one join). See UX_FEEDBACK.md.
