//! The one, universal invite system (see UX_FEEDBACK.md): every invite
//! targets a specific channel — a guild channel or a DM — and a single
//! `/invite/<code>` link handles both "I don't have an account yet"
//! (routes to registration, see `auth::register`) and "I already do"
//! (this module's `redeem`). What redeeming one actually grants is
//! entirely a function of that destination channel: a guild channel
//! grants guild membership, a DM channel grants DM participancy and
//! *nothing else* — no guild is ever joined from a DM invite, per the
//! explicit ask that prompted this. This replaced two separate,
//! harder-to-explain systems (an app-registration-only invite that
//! always joined "the" guild, and a guild-only invite that could only
//! be used by someone who already had an account).

use std::net::SocketAddr;

use axum::extract::{ConnectInfo, Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::Response;
use axum::Json;
use serde::{Deserialize, Serialize};

use protocol::{Id, Permissions};

use super::current_user::CurrentUser;
use super::error::{AppError, AppResult};
use super::permissions::require_channel_permission;
use crate::auth::token;
use crate::client_ip;
use crate::models::{GuestRegisterOutcome, Invite, InvitePreview, NewInvite, RedeemOutcome};
use crate::state::SharedState;

#[derive(Deserialize)]
pub struct CreateInviteRequest {
    pub channel_id: String,
    pub max_uses: Option<i64>,
    pub expires_in_secs: Option<i64>,
}

#[derive(Serialize)]
pub struct InviteResponse {
    #[serde(flatten)]
    pub invite: Invite,
    pub url: String,
}

/// Creating an invite for a channel needs the same access that channel
/// itself gates: `CREATE_INVITE` for a guild channel (the guild's
/// `invites_open` setting controls who besides the owner has it — see
/// `guilds::set_invite_policy`), or just being a participant for a DM
/// (`require_channel_permission` ignores `needed` for DMs — anyone
/// already in the conversation can invite someone else into it, same
/// as `dms::add_participant` always could).
pub async fn create(
    State(state): State<SharedState>,
    current: CurrentUser,
    Json(body): Json<CreateInviteRequest>,
) -> AppResult<Json<InviteResponse>> {
    current.require_human()?;
    let channel_id: Id = body
        .channel_id
        .parse()
        .map_err(|_| AppError::bad_request("invalid_id", "invalid channel id"))?;
    require_channel_permission(&state, current.user.id, channel_id, Permissions::CREATE_INVITE)
        .await?;
    // Redeeming a DM invite adds the redeemer to that conversation — the
    // same "someone else ends up in your private chat" hole as adding
    // them by username (see `api::dms::add_participant`).
    if state.storage.is_self_dm(channel_id).await? {
        return Err(AppError::bad_request(
            "self_dm_is_private",
            "your private chat can't have other people in it",
        ));
    }

    let id = state.snowflake.next_id();
    let code = token::generate_invite_code();
    let now = id.timestamp_ms() as i64;
    let expires_at = body.expires_in_secs.map(|secs| now + secs * 1000);

    let invite = state
        .storage
        .create_invite(NewInvite {
            id,
            code,
            created_by: current.user.id,
            created_at: now,
            expires_at,
            max_uses: body.max_uses,
            channel_id: Some(channel_id),
        })
        .await?;

    let url = format!("{}/invite/{}", state.config.public_url, invite.code);
    Ok(Json(InviteResponse { invite, url }))
}

pub async fn list(
    State(state): State<SharedState>,
    current: CurrentUser,
) -> AppResult<Json<Vec<Invite>>> {
    if !current.user.is_owner {
        return Err(AppError::forbidden("forbidden", "only the owner can list invites"));
    }
    Ok(Json(state.storage.list_invites().await?))
}

pub async fn revoke(
    State(state): State<SharedState>,
    current: CurrentUser,
    Path(id): Path<String>,
) -> AppResult<StatusCode> {
    if !current.user.is_owner {
        return Err(AppError::forbidden("forbidden", "only the owner can revoke invites"));
    }
    let id: Id =
        id.parse().map_err(|_| AppError::bad_request("invalid_id", "invalid invite id"))?;
    if state.storage.revoke_invite(id).await? {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(AppError::not_found("not_found", "invite not found"))
    }
}

#[derive(Deserialize)]
pub struct RedeemInviteRequest {
    pub code: String,
}

#[derive(Serialize)]
pub struct RedeemInviteResponse {
    /// Where to navigate now that redeeming succeeded — `None` only
    /// for an invite predating the unified system (see migration
    /// 0013) or whose destination channel has since been deleted; the
    /// frontend just lands on Home in that case, same as before.
    pub channel_id: Option<Id>,
    /// `Some` exactly when `channel_id` is a guild channel (so the
    /// frontend knows to switch guilds first, rather than treating it
    /// as a DM) — see `RedeemOutcome`.
    pub guild_id: Option<Id>,
}

/// The already-has-an-account half of following an invite link —
/// `auth::register`'s `RegisterOutcome` is the equivalent for someone
/// who needed an account created first. Idempotent: redeeming a code
/// for a destination you're already in (guild member / DM participant)
/// is a harmless no-op that still reports the destination, so
/// re-clicking an old link just takes you there again.
pub async fn redeem(
    State(state): State<SharedState>,
    current: CurrentUser,
    Json(body): Json<RedeemInviteRequest>,
) -> AppResult<Json<RedeemInviteResponse>> {
    // Same normalization as registration's invite check, and for the
    // same reason: codes are always generated uppercase, and a human
    // relaying one by voice/text has no reason to preserve case.
    let code = body.code.trim().to_uppercase();
    match state.storage.redeem_invite(&code, current.user.id).await? {
        RedeemOutcome::Ok { channel_id, guild_id } => {
            Ok(Json(RedeemInviteResponse { channel_id, guild_id }))
        }
        RedeemOutcome::InvalidInvite => Err(AppError::bad_request(
            "invalid_invite",
            "invite code is invalid, expired, or exhausted",
        )),
        RedeemOutcome::DmFull => {
            Err(AppError::bad_request("dm_full", "that conversation is already full"))
        }
    }
}

/// Public — a signed-out visitor calls this before deciding which
/// form to show (see UX_FEEDBACK.md's "invite someone to a quick call,
/// no signup" feature): full registration for a guild-destination
/// invite, or just a display-name "join this call" prompt for a
/// DM-destination one. Read-only, doesn't touch the invite's use count
/// or require the code to even be resolved into anything sensitive.
pub async fn preview(
    State(state): State<SharedState>,
    Path(code): Path<String>,
) -> AppResult<Json<InvitePreview>> {
    let code = code.trim().to_uppercase();
    Ok(Json(state.storage.preview_invite(&code).await?))
}

#[derive(Deserialize)]
pub struct RegisterGuestRequest {
    pub invite_code: String,
    pub display_name: String,
}

/// A guest session lasts 12 hours — long enough for one real call
/// (including "oh wait, let's hop back on"), short enough that a
/// forgotten/abandoned guest account doesn't linger indefinitely. Any
/// request after it lapses is rejected exactly like an expired
/// session and cleaned up right then (see `CurrentUser`).
const GUEST_SESSION_MS: i64 = 12 * 60 * 60 * 1000;

/// The no-signup half of following a DM invite link — see
/// `auth::register` for the equivalent when the destination is a
/// guild (always requires a real account) and `GuestRegisterOutcome`'s
/// doc comment for why this only ever works for a DM. Rate-limited the
/// same as real registration: an easy way to create *an* account,
/// even an ephemeral one, is still an easy way to create accounts.
pub async fn register_guest(
    State(state): State<SharedState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(body): Json<RegisterGuestRequest>,
) -> AppResult<Response> {
    let ip = client_ip::resolve(&headers, peer, state.config.trusted_proxy);
    if !state.rate_limits.register_ip.check(&ip.to_string()) {
        return Err(AppError::too_many_requests("rate_limited", "too many attempts"));
    }

    let display_name = body.display_name.trim();
    if display_name.is_empty() || display_name.chars().count() > 64 {
        return Err(AppError::bad_request(
            "invalid_display_name",
            "display name must be 1-64 characters",
        ));
    }
    let code = body.invite_code.trim().to_uppercase();
    let guest_id = state.snowflake.next_id();

    match state
        .storage
        .register_guest(&code, display_name.to_string(), guest_id, GUEST_SESSION_MS)
        .await?
    {
        GuestRegisterOutcome::Ok { user, channel_id } => {
            let user_agent = headers
                .get(axum::http::header::USER_AGENT)
                .and_then(|v| v.to_str().ok())
                .map(String::from);
            // Sets the session cookie and includes `channel_id` in the
            // response body exactly like a real registration through a
            // DM invite does — a guest join is never a guild, so
            // `guild_id` is always `None`.
            super::auth::session_response(&state, user, user_agent, Some(channel_id), None).await
        }
        GuestRegisterOutcome::InvalidInvite => Err(AppError::bad_request(
            "invalid_invite",
            "invite code is invalid, expired, or exhausted",
        )),
        GuestRegisterOutcome::NotADmInvite => Err(AppError::bad_request(
            "not_a_dm_invite",
            "this invite requires creating a real account",
        )),
        GuestRegisterOutcome::DmFull => {
            Err(AppError::bad_request("dm_full", "that conversation is already full"))
        }
    }
}
