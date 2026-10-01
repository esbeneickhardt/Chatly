//! Custom roles and channel-level permission overwrites — the "finish
//! the plumbing" half of RBAC. `protocol::permissions::resolve` (and
//! its full test suite) already existed and needed no changes; every
//! guild already had an implicit `@everyone` role (`roles.id ==
//! guild_id`, migration 0003) with no way to add another one. This is
//! that: role CRUD, assigning a role to a member, and per-channel
//! allow/deny overwrites for a role or a specific member.
//!
//! Two guards apply throughout, matching Discord's own rules for
//! exactly the same reason: you can only manage a role *below* your
//! own highest one (`ensure_can_manage_role` — otherwise a
//! `MANAGE_ROLES` holder could edit/delete a role that outranks them),
//! and you can only ever grant a permission you already hold yourself
//! (`ensure_can_grant` — otherwise a `MANAGE_ROLES` holder with no
//! other permissions could hand themselves `ADMINISTRATOR`).

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

use protocol::{Id, Permissions};

use super::audit;
use super::current_user::CurrentUser;
use super::error::{AppError, AppResult};
use super::permissions::{
    ensure_can_grant, ensure_can_manage_role, guild_permissions_for, require_guild_permission,
};
use crate::models::Role;
use crate::state::SharedState;

fn parse_id(raw: &str, what: &str) -> AppResult<Id> {
    raw.parse().map_err(|_| AppError::bad_request("invalid_id", format!("invalid {what} id")))
}

pub async fn list(
    State(state): State<SharedState>,
    current: CurrentUser,
    Path(guild_id): Path<String>,
) -> AppResult<Json<Vec<Role>>> {
    let guild_id = parse_id(&guild_id, "guild")?;
    if !state.storage.is_guild_member(guild_id, current.user.id).await? {
        return Err(AppError::forbidden("forbidden", "not a member of this guild"));
    }
    Ok(Json(state.storage.list_roles(guild_id).await?))
}

/// `user_id`'s explicitly-assigned roles — not including the implicit
/// `@everyone` one, same as `Storage::member_roles`. Open to any guild
/// member the same way `list` (all roles) is: seeing who has what
/// isn't sensitive the way *granting* it is.
pub async fn member_roles(
    State(state): State<SharedState>,
    current: CurrentUser,
    Path((guild_id, user_id)): Path<(String, String)>,
) -> AppResult<Json<Vec<Role>>> {
    let guild_id = parse_id(&guild_id, "guild")?;
    let user_id = parse_id(&user_id, "user")?;
    if !state.storage.is_guild_member(guild_id, current.user.id).await? {
        return Err(AppError::forbidden("forbidden", "not a member of this guild"));
    }
    Ok(Json(state.storage.member_roles(guild_id, user_id).await?))
}

#[derive(Deserialize)]
pub struct CreateRoleRequest {
    pub name: String,
    #[serde(default)]
    pub permissions: Permissions,
}

pub async fn create(
    State(state): State<SharedState>,
    current: CurrentUser,
    Path(guild_id): Path<String>,
    Json(body): Json<CreateRoleRequest>,
) -> AppResult<Json<Role>> {
    current.require_human()?;
    let guild_id = parse_id(&guild_id, "guild")?;
    let guild =
        require_guild_permission(&state, current.user.id, guild_id, Permissions::MANAGE_ROLES)
            .await?;

    let name = body.name.trim();
    if name.is_empty() || name.chars().count() > 100 {
        return Err(AppError::bad_request("invalid_name", "role name must be 1-100 characters"));
    }

    let actor_perms = guild_permissions_for(&state, current.user.id, guild_id).await?;
    ensure_can_grant(guild.owner_id == current.user.id, actor_perms, body.permissions)?;

    let role = state
        .storage
        .create_role(state.snowflake.next_id(), guild_id, name.to_string(), body.permissions)
        .await?;
    audit::record(
        &state,
        Some(guild_id),
        &current.user,
        "role.create",
        Some(role.id),
        Some(role.name.clone()),
        None,
    )
    .await;
    Ok(Json(role))
}

#[derive(Deserialize, Default)]
pub struct UpdateRoleRequest {
    pub name: Option<String>,
    pub permissions: Option<Permissions>,
    pub position: Option<i64>,
    pub color: Option<i64>,
    pub hoist: Option<bool>,
    pub mentionable: Option<bool>,
}

pub async fn update(
    State(state): State<SharedState>,
    current: CurrentUser,
    Path((guild_id, role_id)): Path<(String, String)>,
    Json(body): Json<UpdateRoleRequest>,
) -> AppResult<Json<Role>> {
    current.require_human()?;
    let guild_id = parse_id(&guild_id, "guild")?;
    let role_id = parse_id(&role_id, "role")?;
    let guild =
        require_guild_permission(&state, current.user.id, guild_id, Permissions::MANAGE_ROLES)
            .await?;

    let role = state
        .storage
        .get_role(role_id)
        .await?
        .filter(|r| r.guild_id == guild_id)
        .ok_or_else(|| AppError::not_found("not_found", "no such role in this server"))?;
    let is_owner = guild.owner_id == current.user.id;
    ensure_can_manage_role(&state, is_owner, guild_id, current.user.id, role.position).await?;

    if let Some(name) = &body.name {
        let trimmed = name.trim();
        if trimmed.is_empty() || trimmed.chars().count() > 100 {
            return Err(AppError::bad_request(
                "invalid_name",
                "role name must be 1-100 characters",
            ));
        }
    }
    if let Some(permissions) = body.permissions {
        let actor_perms = guild_permissions_for(&state, current.user.id, guild_id).await?;
        ensure_can_grant(is_owner, actor_perms, permissions)?;
    }
    if let Some(new_position) = body.position {
        ensure_can_manage_role(&state, is_owner, guild_id, current.user.id, new_position).await?;
    }

    let updated = state
        .storage
        .update_role(
            role_id,
            body.name.as_ref().map(|n| n.trim().to_string()),
            body.permissions,
            body.position,
            body.color,
            body.hoist,
            body.mentionable,
        )
        .await?;
    audit::record(
        &state,
        Some(guild_id),
        &current.user,
        "role.update",
        Some(role_id),
        Some(updated.name.clone()),
        None,
    )
    .await;
    Ok(Json(updated))
}

pub async fn delete(
    State(state): State<SharedState>,
    current: CurrentUser,
    Path((guild_id, role_id)): Path<(String, String)>,
) -> AppResult<StatusCode> {
    current.require_human()?;
    let guild_id = parse_id(&guild_id, "guild")?;
    let role_id = parse_id(&role_id, "role")?;
    let guild =
        require_guild_permission(&state, current.user.id, guild_id, Permissions::MANAGE_ROLES)
            .await?;

    if role_id == guild_id {
        return Err(AppError::bad_request("everyone_role", "the @everyone role can't be deleted"));
    }
    let role = state
        .storage
        .get_role(role_id)
        .await?
        .filter(|r| r.guild_id == guild_id)
        .ok_or_else(|| AppError::not_found("not_found", "no such role in this server"))?;
    ensure_can_manage_role(
        &state,
        guild.owner_id == current.user.id,
        guild_id,
        current.user.id,
        role.position,
    )
    .await?;

    state.storage.delete_role(role_id, guild_id).await?;
    audit::record(
        &state,
        Some(guild_id),
        &current.user,
        "role.delete",
        Some(role_id),
        Some(role.name.clone()),
        None,
    )
    .await;
    Ok(StatusCode::NO_CONTENT)
}

async fn require_assignable_role(
    state: &SharedState,
    guild_id: Id,
    actor_id: Id,
    actor_is_owner: bool,
    role_id: Id,
) -> AppResult<Role> {
    let role = state
        .storage
        .get_role(role_id)
        .await?
        .filter(|r| r.guild_id == guild_id)
        .ok_or_else(|| AppError::not_found("not_found", "no such role in this server"))?;
    if role.id == guild_id {
        return Err(AppError::bad_request(
            "everyone_role",
            "everyone already has the @everyone role implicitly",
        ));
    }
    ensure_can_manage_role(state, actor_is_owner, guild_id, actor_id, role.position).await?;
    Ok(role)
}

pub async fn assign(
    State(state): State<SharedState>,
    current: CurrentUser,
    Path((guild_id, user_id, role_id)): Path<(String, String, String)>,
) -> AppResult<StatusCode> {
    current.require_human()?;
    let guild_id = parse_id(&guild_id, "guild")?;
    let user_id = parse_id(&user_id, "user")?;
    let role_id = parse_id(&role_id, "role")?;
    let guild =
        require_guild_permission(&state, current.user.id, guild_id, Permissions::MANAGE_ROLES)
            .await?;
    require_assignable_role(
        &state,
        guild_id,
        current.user.id,
        guild.owner_id == current.user.id,
        role_id,
    )
    .await?;
    if !state.storage.is_guild_member(guild_id, user_id).await? {
        return Err(AppError::not_found("not_found", "no such member in this server"));
    }

    state.storage.assign_role(guild_id, user_id, role_id).await?;
    record_role_change(&state, &current, guild_id, user_id, role_id, "role.assign").await;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn unassign(
    State(state): State<SharedState>,
    current: CurrentUser,
    Path((guild_id, user_id, role_id)): Path<(String, String, String)>,
) -> AppResult<StatusCode> {
    current.require_human()?;
    let guild_id = parse_id(&guild_id, "guild")?;
    let user_id = parse_id(&user_id, "user")?;
    let role_id = parse_id(&role_id, "role")?;
    let guild =
        require_guild_permission(&state, current.user.id, guild_id, Permissions::MANAGE_ROLES)
            .await?;
    require_assignable_role(
        &state,
        guild_id,
        current.user.id,
        guild.owner_id == current.user.id,
        role_id,
    )
    .await?;

    state.storage.unassign_role(guild_id, user_id, role_id).await?;
    record_role_change(&state, &current, guild_id, user_id, role_id, "role.unassign").await;
    Ok(StatusCode::NO_CONTENT)
}

/// Audit entry for giving/taking a role: names the member, with the
/// role's name as the detail.
async fn record_role_change(
    state: &SharedState,
    current: &CurrentUser,
    guild_id: Id,
    user_id: Id,
    role_id: Id,
    action: &str,
) {
    let member = state.storage.get_user_by_id(user_id).await.ok().flatten().map(|u| u.display_name);
    let role = state.storage.get_role(role_id).await.ok().flatten().map(|r| r.name);
    audit::record(state, Some(guild_id), &current.user, action, Some(user_id), member, role).await;
}

#[derive(Deserialize)]
pub struct SetOverwriteRequest {
    #[serde(default)]
    pub allow: Permissions,
    #[serde(default)]
    pub deny: Permissions,
}

/// Shared setup for every overwrite endpoint: resolves the channel's
/// guild, requires `MANAGE_ROLES` there (Discord gates channel
/// permission edits the same way), and hands back the guild id plus
/// whether the actor is its owner.
async fn require_overwrite_access(
    state: &SharedState,
    actor_id: Id,
    channel_id: Id,
) -> AppResult<(Id, bool)> {
    let channel = state
        .storage
        .get_channel(channel_id)
        .await?
        .ok_or_else(|| AppError::not_found("not_found", "channel not found"))?;
    let guild_id = channel.guild_id.ok_or_else(|| {
        AppError::bad_request("invalid_channel", "DM channels have no overwrites")
    })?;
    let guild =
        require_guild_permission(state, actor_id, guild_id, Permissions::MANAGE_ROLES).await?;
    Ok((guild_id, guild.owner_id == actor_id))
}

pub async fn set_role_overwrite(
    State(state): State<SharedState>,
    current: CurrentUser,
    Path((channel_id, role_id)): Path<(String, String)>,
    Json(body): Json<SetOverwriteRequest>,
) -> AppResult<StatusCode> {
    current.require_human()?;
    let channel_id = parse_id(&channel_id, "channel")?;
    let role_id = parse_id(&role_id, "role")?;
    let (guild_id, is_owner) =
        require_overwrite_access(&state, current.user.id, channel_id).await?;
    // Existence/guild-scoping check only — a role overwrite has no
    // hierarchy bearing on it the way editing the role itself does.
    let role_guild_id = state.storage.get_role(role_id).await?.map(|r| r.guild_id);
    if role_guild_id != Some(guild_id) {
        return Err(AppError::not_found("not_found", "no such role in this server"));
    }

    let actor_perms = guild_permissions_for(&state, current.user.id, guild_id).await?;
    ensure_can_grant(is_owner, actor_perms, body.allow)?;

    state.storage.set_role_overwrite(channel_id, role_id, body.allow, body.deny).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn clear_role_overwrite(
    State(state): State<SharedState>,
    current: CurrentUser,
    Path((channel_id, role_id)): Path<(String, String)>,
) -> AppResult<StatusCode> {
    current.require_human()?;
    let channel_id = parse_id(&channel_id, "channel")?;
    let role_id = parse_id(&role_id, "role")?;
    require_overwrite_access(&state, current.user.id, channel_id).await?;
    state.storage.clear_role_overwrite(channel_id, role_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn set_member_overwrite(
    State(state): State<SharedState>,
    current: CurrentUser,
    Path((channel_id, user_id)): Path<(String, String)>,
    Json(body): Json<SetOverwriteRequest>,
) -> AppResult<StatusCode> {
    current.require_human()?;
    let channel_id = parse_id(&channel_id, "channel")?;
    let user_id = parse_id(&user_id, "user")?;
    let (guild_id, is_owner) =
        require_overwrite_access(&state, current.user.id, channel_id).await?;
    if !state.storage.is_guild_member(guild_id, user_id).await? {
        return Err(AppError::not_found("not_found", "no such member in this server"));
    }

    let actor_perms = guild_permissions_for(&state, current.user.id, guild_id).await?;
    ensure_can_grant(is_owner, actor_perms, body.allow)?;

    state.storage.set_member_overwrite(channel_id, user_id, body.allow, body.deny).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn clear_member_overwrite(
    State(state): State<SharedState>,
    current: CurrentUser,
    Path((channel_id, user_id)): Path<(String, String)>,
) -> AppResult<StatusCode> {
    current.require_human()?;
    let channel_id = parse_id(&channel_id, "channel")?;
    let user_id = parse_id(&user_id, "user")?;
    require_overwrite_access(&state, current.user.id, channel_id).await?;
    state.storage.clear_member_overwrite(channel_id, user_id).await?;
    Ok(StatusCode::NO_CONTENT)
}
