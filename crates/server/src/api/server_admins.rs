//! Server admins: the people who run one server (a guild, made with
//! "Add Server"). Kept apart from the *global* admin (`api::admin`),
//! whose authority spans the whole deployment.
//!
//! A server admin is the owner, plus anyone holding a role with the
//! `ADMINISTRATOR` permission. This module is the friendly front door
//! to that: "make admin" / "remove admin" on a member, backed by a
//! built-in "Admin" role created on first use, so nobody has to know the
//! roles machinery exists to promote a co-admin. Everything still
//! resolves through the ordinary permission engine — there is no second
//! source of truth.
//!
//! Rules: you have to be a server admin to promote (`ensure_can_grant`
//! already forbids handing out a permission you lack); only the owner
//! can demote someone else (an admin can always step *themselves* down),
//! which keeps two admins from purging each other; the owner is never
//! demotable — they hold the server outright.

use axum::extract::{Path, State};
use axum::http::StatusCode;

use protocol::{Id, Permissions};

use super::audit;
use super::current_user::CurrentUser;
use super::error::{AppError, AppResult};
use super::permissions::guild_permissions_for;
use crate::models::Role;
use crate::state::SharedState;

const ADMIN_ROLE_NAME: &str = "Admin";

fn parse_id(raw: &str, what: &str) -> AppResult<Id> {
    raw.parse().map_err(|_| AppError::bad_request("invalid_id", format!("invalid {what} id")))
}

/// The role that makes someone a server admin: an existing role that
/// holds `ADMINISTRATOR` (other than the implicit `@everyone`, which
/// must never be it), or a fresh "Admin" role if there is none.
async fn admin_role(state: &SharedState, guild_id: Id) -> AppResult<Role> {
    let roles = state.storage.list_roles(guild_id).await?;
    if let Some(role) = roles
        .into_iter()
        .filter(|r| r.id != guild_id && r.permissions.contains(Permissions::ADMINISTRATOR))
        .min_by_key(|r| (r.name != ADMIN_ROLE_NAME, r.id))
    {
        return Ok(role);
    }
    Ok(state
        .storage
        .create_role(
            state.snowflake.next_id(),
            guild_id,
            ADMIN_ROLE_NAME.to_string(),
            Permissions::ADMINISTRATOR,
        )
        .await?)
}

pub async fn add(
    State(state): State<SharedState>,
    current: CurrentUser,
    Path((guild_id, user_id)): Path<(String, String)>,
) -> AppResult<StatusCode> {
    current.require_human()?;
    let guild_id = parse_id(&guild_id, "guild")?;
    let user_id = parse_id(&user_id, "user")?;

    let actor = guild_permissions_for(&state, current.user.id, guild_id).await?;
    if !actor.contains(Permissions::ADMINISTRATOR) {
        return Err(AppError::forbidden("forbidden", "only a server admin can make another admin"));
    }
    if !state.storage.is_guild_member(guild_id, user_id).await? {
        return Err(AppError::not_found("not_found", "no such member in this server"));
    }
    let guild = state
        .storage
        .get_guild(guild_id)
        .await?
        .ok_or_else(|| AppError::not_found("not_found", "guild not found"))?;
    if guild.owner_id == user_id {
        return Err(AppError::bad_request("already_owner", "the owner already has full control"));
    }

    let role = admin_role(&state, guild_id).await?;
    state.storage.assign_role(guild_id, user_id, role.id).await?;
    let target_name = state.storage.get_user_by_id(user_id).await?.map(|u| u.display_name);
    audit::record(
        &state,
        Some(guild_id),
        &current.user,
        "admin.grant",
        Some(user_id),
        target_name,
        None,
    )
    .await;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn remove(
    State(state): State<SharedState>,
    current: CurrentUser,
    Path((guild_id, user_id)): Path<(String, String)>,
) -> AppResult<StatusCode> {
    current.require_human()?;
    let guild_id = parse_id(&guild_id, "guild")?;
    let user_id = parse_id(&user_id, "user")?;

    let guild = state
        .storage
        .get_guild(guild_id)
        .await?
        .ok_or_else(|| AppError::not_found("not_found", "guild not found"))?;
    if !state.storage.is_guild_member(guild_id, current.user.id).await? {
        return Err(AppError::forbidden("forbidden", "not a member of this guild"));
    }
    if guild.owner_id == user_id {
        return Err(AppError::bad_request("is_owner", "the owner can't be demoted"));
    }
    if current.user.id != guild.owner_id && current.user.id != user_id {
        return Err(AppError::forbidden(
            "forbidden",
            "only the server owner can remove another admin (you can always step down yourself)",
        ));
    }

    // Demote fully: every role that confers `ADMINISTRATOR`, not just the
    // built-in one — otherwise a custom role holding the bit would leave
    // them an admin after "Remove admin".
    for role in state.storage.member_roles(guild_id, user_id).await? {
        if role.permissions.contains(Permissions::ADMINISTRATOR) {
            state.storage.unassign_role(guild_id, user_id, role.id).await?;
        }
    }
    let target_name = state.storage.get_user_by_id(user_id).await?.map(|u| u.display_name);
    audit::record(
        &state,
        Some(guild_id),
        &current.user,
        "admin.revoke",
        Some(user_id),
        target_name,
        None,
    )
    .await;
    Ok(StatusCode::NO_CONTENT)
}
