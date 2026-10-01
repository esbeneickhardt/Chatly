//! The audit log: who did what, at both administration levels. Entries are
//! written by the handlers that do administrative things (through
//! [`record`]) and read here. See `migrations/0025_audit_log.sql` for the
//! two kinds of entry (per-server, and global with a NULL server).

use axum::extract::{Path, Query, State};
use axum::Json;
use serde::Deserialize;

use protocol::{Id, Permissions};

use super::current_user::CurrentUser;
use super::error::{AppError, AppResult};
use super::permissions::require_guild_permission;
use crate::models::{AuditEntry, NewAuditEntry, User};
use crate::state::SharedState;

const DEFAULT_LIMIT: i64 = 50;
const MAX_LIMIT: i64 = 100;

/// Appends an entry. A failure to record is logged and swallowed rather
/// than failing the action that was already carried out — refusing to
/// (say) remove an abusive member because the log write hiccuped would be
/// the worse outcome.
pub async fn record(
    state: &SharedState,
    guild_id: Option<Id>,
    actor: &User,
    action: &str,
    target_id: Option<Id>,
    target_name: Option<String>,
    detail: Option<String>,
) {
    let entry = NewAuditEntry {
        id: state.snowflake.next_id(),
        guild_id,
        actor_id: Some(actor.id),
        actor_name: actor.display_name.clone(),
        action: action.to_string(),
        target_id,
        target_name,
        detail,
    };
    if let Err(error) = state.storage.record_audit(entry).await {
        tracing::warn!(?error, action, "couldn't write an audit log entry");
    }
}

#[derive(Deserialize)]
pub struct AuditQuery {
    /// Pagination cursor: only entries older than this id.
    pub before: Option<String>,
    pub limit: Option<i64>,
}

fn page(query: &AuditQuery) -> AppResult<(Option<Id>, i64)> {
    let before = query
        .before
        .as_deref()
        .map(str::parse::<Id>)
        .transpose()
        .map_err(|_| AppError::bad_request("invalid_id", "invalid before id"))?;
    Ok((before, query.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT)))
}

/// A server's audit log, newest first. Needs `MANAGE_GUILD`, which every
/// server admin holds.
pub async fn guild_log(
    State(state): State<SharedState>,
    current: CurrentUser,
    Path(guild_id): Path<String>,
    Query(query): Query<AuditQuery>,
) -> AppResult<Json<Vec<AuditEntry>>> {
    current.require_human()?;
    let guild_id: Id =
        guild_id.parse().map_err(|_| AppError::bad_request("invalid_id", "invalid guild id"))?;
    require_guild_permission(&state, current.user.id, guild_id, Permissions::MANAGE_GUILD).await?;
    let (before, limit) = page(&query)?;
    Ok(Json(state.storage.list_audit(Some(guild_id), before, limit).await?))
}

/// The global admin's log: what they (and only they) did to the whole
/// deployment.
pub async fn global_log(
    State(state): State<SharedState>,
    current: CurrentUser,
    Query(query): Query<AuditQuery>,
) -> AppResult<Json<Vec<AuditEntry>>> {
    current.require_human()?;
    if !current.user.is_owner {
        return Err(AppError::forbidden("forbidden", "only the global admin can do this"));
    }
    let (before, limit) = page(&query)?;
    Ok(Json(state.storage.list_audit(None, before, limit).await?))
}
