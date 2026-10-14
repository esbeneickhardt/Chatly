//! Global-admin-only management of the whole deployment: every account
//! ("All accounts") and every server ("All servers"). "Global" means
//! across the entire instance — as opposed to a *server* (a guild, made
//! with "Add Server"), which has its own admins (its owner and anyone
//! holding the `ADMINISTRATOR` role permission; see `api::server_admins`)
//! whose authority stops at that server's edge.
//!
//! `users.is_owner` is the one instance-wide flag (set on the very first
//! account registered — see `auth::register` — and movable with
//! `auth::transfer_ownership`), so that's the gate every handler here
//! uses; there's no separate "platform admin" role. Note the two
//! notions never merge: being the global admin grants no standing
//! *inside* a server you haven't joined, and being a server's admin
//! grants nothing here.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;

use protocol::Id;

use super::audit;
use super::current_user::CurrentUser;
use super::error::{AppError, AppResult};
use crate::auth::password;
use crate::models::{AdminGuildSummary, DeleteAccountOutcome, Guild, User};
use crate::state::SharedState;

fn require_instance_owner(current: &CurrentUser) -> AppResult<()> {
    current.require_human()?;
    if current.user.is_owner {
        Ok(())
    } else {
        Err(AppError::forbidden("forbidden", "only the instance owner can do this"))
    }
}

pub async fn list_users(
    State(state): State<SharedState>,
    current: CurrentUser,
) -> AppResult<Json<Vec<User>>> {
    require_instance_owner(&current)?;
    Ok(Json(state.storage.list_all_users_for_admin().await?))
}

/// Can't be used on the instance owner's own account (there's only
/// ever one, and no instance-ownership-transfer flow existed — see
/// `auth::delete_account`'s doc comment for the self-service side,
/// which now has one).
///
/// No request body at all — an admin forcibly removing someone else's
/// account always wipes everything that account touches: the account
/// itself is hard-deleted (no "Deleted User" tombstone left behind —
/// see `Storage::delete_account`), messages actually deleted, any
/// guild they own taken down outright even with other members still
/// in it (`force_guilds`).
pub async fn delete_user(
    State(state): State<SharedState>,
    current: CurrentUser,
    Path(id): Path<String>,
) -> AppResult<StatusCode> {
    require_instance_owner(&current)?;
    let target_id: Id =
        id.parse().map_err(|_| AppError::bad_request("invalid_id", "invalid user id"))?;

    let target = state
        .storage
        .get_user_by_id(target_id)
        .await?
        .ok_or_else(|| AppError::not_found("not_found", "no such user"))?;
    if target.is_owner {
        return Err(AppError::bad_request(
            "is_instance_owner",
            "the instance owner's account can't be deleted",
        ));
    }

    match state.storage.delete_account(target_id, true).await? {
        DeleteAccountOutcome::Ok => {
            audit::record(
                &state,
                None,
                &current.user,
                "global.user_delete",
                Some(target_id),
                Some(target.display_name.clone()),
                None,
            )
            .await;
            Ok(StatusCode::NO_CONTENT)
        }
        // Unreachable in practice (`force_guilds: true` never blocks
        // on owned guilds), kept only so this match stays exhaustive if
        // `DeleteAccountOutcome` ever grows another variant.
        DeleteAccountOutcome::OwnsGuildsWithMembers(guilds) => {
            let names: Vec<&str> = guilds.iter().map(|g| g.name.as_str()).collect();
            Err(AppError::bad_request(
                "owns_guilds",
                format!("couldn't delete these servers: {}", names.join(", ")),
            ))
        }
    }
}

#[derive(serde::Serialize)]
pub struct ResetPasswordResponse {
    pub password: String,
}

/// Unambiguous characters only (no 0/O, 1/l/I), since the admin reads
/// the result out or retypes it.
const PASSWORD_CHARS: &[u8] = b"abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/// `xxxx-xxxx-xxxx-xxxx`: 16 characters from 55, ≈92 bits.
fn generate_password() -> String {
    use rand::Rng;
    let mut rng = rand::rngs::OsRng;
    (0..4)
        .map(|_| {
            (0..4)
                .map(|_| PASSWORD_CHARS[rng.gen_range(0..PASSWORD_CHARS.len())] as char)
                .collect::<String>()
        })
        .collect::<Vec<_>>()
        .join("-")
}

/// Gives someone who forgot their password a new one, generated here and
/// returned once for the admin to pass on, and signs the account out
/// everywhere — the web equivalent of `chatly admin reset-password`.
/// Two-factor authentication stays as it is. Not for the instance owner's
/// own account: that's Settings → Account (or the CLI when locked out).
pub async fn reset_user_password(
    State(state): State<SharedState>,
    current: CurrentUser,
    Path(id): Path<String>,
) -> AppResult<Json<ResetPasswordResponse>> {
    require_instance_owner(&current)?;
    let target_id: Id =
        id.parse().map_err(|_| AppError::bad_request("invalid_id", "invalid user id"))?;
    let target = state
        .storage
        .get_user_by_id(target_id)
        .await?
        .ok_or_else(|| AppError::not_found("not_found", "no such user"))?;
    if target.is_owner {
        return Err(AppError::bad_request(
            "is_instance_owner",
            "change your own password in Settings → Account",
        ));
    }
    if target.is_bot {
        return Err(AppError::bad_request("is_bot", "bots have no password"));
    }

    let new_password = generate_password();
    let hash = password::hash(&new_password).map_err(AppError::internal)?;
    state.storage.set_user_password_hash(target_id, hash).await?;
    state.storage.delete_all_sessions_for_user(target_id).await?;
    audit::record(
        &state,
        None,
        &current.user,
        "global.user_password",
        Some(target_id),
        Some(target.display_name.clone()),
        None,
    )
    .await;
    Ok(Json(ResetPasswordResponse { password: new_password }))
}

/// Every server on the instance — whether or not the global admin has
/// joined it.
pub async fn list_guilds(
    State(state): State<SharedState>,
    current: CurrentUser,
) -> AppResult<Json<Vec<AdminGuildSummary>>> {
    require_instance_owner(&current)?;
    Ok(Json(state.storage.list_all_guilds_for_admin().await?))
}

/// One server's members, for the "All servers" detail view (the
/// per-server member list endpoint requires being a member).
pub async fn list_guild_members(
    State(state): State<SharedState>,
    current: CurrentUser,
    Path(id): Path<String>,
) -> AppResult<Json<Vec<User>>> {
    require_instance_owner(&current)?;
    let guild_id: Id =
        id.parse().map_err(|_| AppError::bad_request("invalid_id", "invalid server id"))?;
    state
        .storage
        .get_guild(guild_id)
        .await?
        .ok_or_else(|| AppError::not_found("not_found", "no such server"))?;
    Ok(Json(state.storage.list_guild_members(guild_id).await?))
}

/// Takes a server down outright, members and all — the global admin's
/// remedy for an abandoned or abusive server whose owner won't act.
pub async fn delete_guild(
    State(state): State<SharedState>,
    current: CurrentUser,
    Path(id): Path<String>,
) -> AppResult<StatusCode> {
    require_instance_owner(&current)?;
    let guild_id: Id =
        id.parse().map_err(|_| AppError::bad_request("invalid_id", "invalid server id"))?;
    let guild = state
        .storage
        .get_guild(guild_id)
        .await?
        .ok_or_else(|| AppError::not_found("not_found", "no such server"))?;
    state.storage.delete_guild(guild_id).await?;
    // Recorded at deployment level (no server): the server's own log went
    // with it, and this is the trace that it was ever taken down.
    audit::record(
        &state,
        None,
        &current.user,
        "global.guild_delete",
        Some(guild_id),
        Some(guild.name),
        None,
    )
    .await;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(serde::Deserialize)]
pub struct SetGuildOwnerRequest {
    pub user_id: String,
}

/// Reassigns a server to another of its *members* — for when the owner
/// left the instance or went missing. Doesn't require being the current
/// owner (that's the point), but the new owner must already be a member
/// so this can never hand a server to someone who hasn't joined it.
pub async fn set_guild_owner(
    State(state): State<SharedState>,
    current: CurrentUser,
    Path(id): Path<String>,
    Json(body): Json<SetGuildOwnerRequest>,
) -> AppResult<Json<Guild>> {
    require_instance_owner(&current)?;
    let guild_id: Id =
        id.parse().map_err(|_| AppError::bad_request("invalid_id", "invalid server id"))?;
    let new_owner: Id =
        body.user_id.parse().map_err(|_| AppError::bad_request("invalid_id", "invalid user id"))?;
    let guild = state
        .storage
        .get_guild(guild_id)
        .await?
        .ok_or_else(|| AppError::not_found("not_found", "no such server"))?;
    if guild.owner_id == new_owner {
        return Err(AppError::bad_request("already_owner", "they already own this server"));
    }
    if !state.storage.is_guild_member(guild_id, new_owner).await? {
        return Err(AppError::bad_request(
            "not_a_member",
            "the new owner must already be a member of the server",
        ));
    }
    state.storage.transfer_guild_ownership(guild_id, new_owner).await?;
    let new_owner_name = state.storage.get_user_by_id(new_owner).await?.map(|u| u.display_name);
    audit::record(
        &state,
        None,
        &current.user,
        "global.guild_owner",
        Some(new_owner),
        new_owner_name,
        Some(guild.name.clone()),
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
