use std::net::SocketAddr;

use axum::extract::{ConnectInfo, Path, State};
use axum::http::{HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::{Deserialize, Serialize};

use protocol::Id;

use super::current_user::CurrentUser;
use super::error::{AppError, AppResult};
use crate::auth::{cookie, password, token};
use crate::client_ip;
use crate::models::{DeleteAccountOutcome, NewSession, NewUser, RegisterOutcome, Session, User};
use crate::state::{SharedState, SESSION_TTL_SECS};
use crate::time::now_ms;

fn validate_username(username: &str) -> Result<(), AppError> {
    if username.chars().count() < 2 || username.chars().count() > 32 {
        return Err(AppError::bad_request("invalid_username", "username must be 2-32 characters"));
    }
    let ok = username
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-');
    if !ok {
        return Err(AppError::bad_request(
            "invalid_username",
            "username may only contain lowercase letters, digits, '_' and '-'",
        ));
    }
    Ok(())
}

fn validate_password(pw: &str) -> Result<(), AppError> {
    if pw.len() < 8 {
        return Err(AppError::bad_request(
            "weak_password",
            "password must be at least 8 characters",
        ));
    }
    Ok(())
}

fn user_agent_of(headers: &HeaderMap) -> Option<String> {
    headers.get(axum::http::header::USER_AGENT).and_then(|v| v.to_str().ok()).map(String::from)
}

#[derive(Serialize)]
pub struct SessionEnvelope {
    pub user: User,
    /// Set only when this session was just created by redeeming an
    /// invite that targets a specific channel — the frontend navigates
    /// there instead of dropping the new user on Home. `None` for
    /// login/MFA verification and for a destination-less invite.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub channel_id: Option<Id>,
    /// `Some` alongside `channel_id` exactly when the destination is a
    /// guild channel (so the frontend knows to switch guilds first) —
    /// see `RegisterOutcome`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub guild_id: Option<Id>,
}

/// Creates a real session for `user`, sets the cookie, and returns
/// `{ "user": ... }`. Shared by register, login (no MFA), and the last
/// step of MFA verification.
pub(super) async fn session_response(
    state: &SharedState,
    user: User,
    user_agent: Option<String>,
    channel_id: Option<Id>,
    guild_id: Option<Id>,
) -> AppResult<Response> {
    let raw_token = token::generate_session_token();
    let now = now_ms();
    let session = NewSession {
        id: state.snowflake.next_id(),
        user_id: user.id,
        token_hash: token::hash(&raw_token),
        created_at: now,
        expires_at: now + SESSION_TTL_SECS * 1000,
        user_agent,
    };
    state.storage.create_session(session).await?;

    let mut response = Json(SessionEnvelope { user, channel_id, guild_id }).into_response();
    response.headers_mut().insert(
        axum::http::header::SET_COOKIE,
        cookie::set_cookie_header(&raw_token, SESSION_TTL_SECS),
    );
    Ok(response)
}

#[derive(Deserialize)]
pub struct RegisterRequest {
    pub username: String,
    pub display_name: String,
    pub password: String,
    pub invite_code: Option<String>,
}

pub async fn register(
    State(state): State<SharedState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(body): Json<RegisterRequest>,
) -> AppResult<Response> {
    let ip = client_ip::resolve(&headers, peer, state.config.trusted_proxy);
    if !state.rate_limits.register_ip.check(&ip.to_string()) {
        return Err(AppError::too_many_requests("rate_limited", "too many registration attempts"));
    }

    let username = body.username.trim().to_lowercase();
    validate_username(&username)?;
    validate_password(&body.password)?;
    let display_name = if body.display_name.trim().is_empty() {
        username.clone()
    } else {
        body.display_name.trim().to_string()
    };

    let password_hash = password::hash(&body.password).map_err(AppError::internal)?;
    let new_user = NewUser {
        id: state.snowflake.next_id(),
        username,
        display_name,
        password_hash,
        is_owner: false,
        is_bot: false,
    };
    let user_agent = user_agent_of(&headers);

    // The very first account ever created becomes the owner, no invite
    // needed. Checked and inserted in one transaction inside storage, so
    // this can't race with a second concurrent "first" registration.
    let mut owner_attempt = new_user.clone();
    owner_attempt.is_owner = true;
    let guild_id = state.snowflake.next_id();
    let general_channel_id = state.snowflake.next_id();
    let voice_channel_id = state.snowflake.next_id();
    let guild_name = state.config.instance_name.clone();
    if let Some(user) = state
        .storage
        .register_owner(owner_attempt, guild_id, guild_name, general_channel_id, voice_channel_id)
        .await?
    {
        return session_response(&state, user, user_agent, None, None).await;
    }

    let Some(code) = body.invite_code.as_deref().map(str::trim).filter(|c| !c.is_empty()) else {
        return Err(AppError::bad_request(
            "invite_required",
            "an invite code is required to register",
        ));
    };
    // Codes are always generated uppercase (see `token::INVITE_ALPHABET`)
    // and the lookup is an exact match — a human relaying one by voice
    // or text (the realistic way someone without an account yet gets
    // one) has no reason to preserve case, and a stray leading/trailing
    // space from a copy-paste is easy to pick up unnoticed. Normalizing
    // here costs nothing security-wise (same fixed character set
    // either way) and turns those into non-issues instead of a
    // confusing "invalid" for an objectively correct code.
    let code = code.to_uppercase();

    match state.storage.register_with_invite(&code, new_user).await? {
        RegisterOutcome::Ok { user, channel_id, guild_id } => {
            session_response(&state, user, user_agent, channel_id, guild_id).await
        }
        RegisterOutcome::UsernameTaken => {
            Err(AppError::conflict("username_taken", "username is already taken"))
        }
        RegisterOutcome::InvalidInvite => Err(AppError::bad_request(
            "invalid_invite",
            "invite code is invalid, expired, or exhausted",
        )),
    }
}

#[derive(Deserialize)]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
}

pub async fn login(
    State(state): State<SharedState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(body): Json<LoginRequest>,
) -> AppResult<Response> {
    let ip = client_ip::resolve(&headers, peer, state.config.trusted_proxy);
    let username = body.username.trim().to_lowercase();

    let ip_ok = state.rate_limits.login_ip.check(&ip.to_string());
    let user_ok = state.rate_limits.login_username.check(&username);
    if !ip_ok || !user_ok {
        return Err(AppError::too_many_requests("rate_limited", "too many login attempts"));
    }

    let invalid = || AppError::unauthorized("invalid_credentials", "invalid username or password");

    let record =
        state.storage.get_user_by_username_for_login(&username).await?.ok_or_else(invalid)?;
    if !password::verify(&record.password_hash, &body.password) {
        return Err(invalid());
    }

    if record.user.mfa_enabled {
        let preauth_token = state.preauth.create(record.user.id);
        return Ok(Json(serde_json::json!({
            "mfa_required": true,
            "preauth_token": preauth_token,
        }))
        .into_response());
    }

    session_response(&state, record.user, user_agent_of(&headers), None, None).await
}

pub async fn logout(State(state): State<SharedState>, current: CurrentUser) -> AppResult<Response> {
    let session_id = current.human_session_id()?;
    state.storage.delete_session(session_id, current.user.id).await?;
    let mut response = StatusCode::NO_CONTENT.into_response();
    response.headers_mut().insert(axum::http::header::SET_COOKIE, cookie::clear_cookie_header());
    Ok(response)
}

pub async fn logout_all(
    State(state): State<SharedState>,
    current: CurrentUser,
) -> AppResult<Response> {
    current.require_human()?;
    state.storage.delete_all_sessions_for_user(current.user.id).await?;
    let mut response = StatusCode::NO_CONTENT.into_response();
    response.headers_mut().insert(axum::http::header::SET_COOKIE, cookie::clear_cookie_header());
    Ok(response)
}

pub async fn me(current: CurrentUser) -> Json<User> {
    Json(current.user)
}

#[derive(Serialize)]
pub struct DataExport {
    pub profile: User,
    pub guilds: Vec<crate::models::Guild>,
    pub direct_messages: Vec<crate::api::dms::DmSummary>,
    pub messages: Vec<crate::models::ExportedMessage>,
    pub exported_at: i64,
}

/// GDPR data-portability export — everything this account's own data
/// consists of, as one downloadable JSON file. Deliberately not the
/// same shape as any single internal API response (e.g. `messages`
/// skips the per-viewer reaction/mention enrichment `GET
/// /channels/:id/messages` does — see `ExportedMessage`); this is
/// about *this account's own* data, not a full conversation replay.
pub async fn export_data(
    State(state): State<SharedState>,
    current: CurrentUser,
) -> AppResult<Response> {
    current.require_human()?;
    let guilds = state.storage.list_guilds_for_user(current.user.id).await?;
    let dms = state.storage.list_dms_for_user(current.user.id).await?;
    let messages = state.storage.export_messages_for_user(current.user.id).await?;

    let export = DataExport {
        profile: current.user,
        guilds,
        direct_messages: dms
            .into_iter()
            .map(|d| crate::api::dms::DmSummary {
                channel: d.channel,
                participants: d.participants,
                pinned: d.pinned,
            })
            .collect(),
        messages,
        exported_at: now_ms(),
    };

    let mut response = Json(export).into_response();
    response.headers_mut().insert(
        axum::http::header::CONTENT_DISPOSITION,
        HeaderValue::from_static("attachment; filename=\"chatly-data-export.json\""),
    );
    Ok(response)
}

#[derive(Deserialize)]
pub struct UpdateProfileRequest {
    /// Present and non-empty to change; absent/omitted to leave alone
    /// — lets the client send just the one field it's actually
    /// editing without clobbering the other.
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default)]
    pub username: Option<String>,
}

/// Display name and/or username — the two fields set at registration
/// alongside the password (handled separately, see `change_password`,
/// since it needs the current password re-entered rather than just
/// being editable like these two).
pub async fn update_profile(
    State(state): State<SharedState>,
    current: CurrentUser,
    Json(body): Json<UpdateProfileRequest>,
) -> AppResult<Json<User>> {
    current.require_human()?;
    if let Some(display_name) = body.display_name {
        let display_name = display_name.trim();
        if display_name.is_empty() {
            return Err(AppError::bad_request(
                "invalid_display_name",
                "display name can't be empty",
            ));
        }
        if display_name.chars().count() > 64 {
            return Err(AppError::bad_request(
                "invalid_display_name",
                "display name must be 64 characters or fewer",
            ));
        }
        state.storage.set_user_display_name(current.user.id, display_name.to_string()).await?;
    }

    if let Some(username) = body.username {
        let username = username.trim().to_lowercase();
        validate_username(&username)?;
        let taken = state.storage.set_user_username(current.user.id, username).await?;
        if taken {
            return Err(AppError::conflict("username_taken", "username is already taken"));
        }
    }

    let user = state
        .storage
        .get_user_by_id(current.user.id)
        .await?
        .ok_or_else(|| AppError::internal("user vanished after its own profile update"))?;
    Ok(Json(user))
}

#[derive(Deserialize)]
pub struct ChangePasswordRequest {
    pub current_password: String,
    pub new_password: String,
}

pub async fn change_password(
    State(state): State<SharedState>,
    current: CurrentUser,
    Json(body): Json<ChangePasswordRequest>,
) -> AppResult<StatusCode> {
    current.require_human()?;
    let invalid_current =
        || AppError::unauthorized("invalid_password", "current password is incorrect");
    let existing_hash =
        state.storage.get_password_hash(current.user.id).await?.ok_or_else(invalid_current)?;
    if !password::verify(&existing_hash, &body.current_password) {
        return Err(invalid_current());
    }
    validate_password(&body.new_password)?;

    let new_hash = password::hash(&body.new_password).map_err(AppError::internal)?;
    state.storage.set_user_password_hash(current.user.id, new_hash).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
pub struct UpdateAvatarRequest {
    #[serde(default)]
    pub avatar_file_id: Option<String>,
}

pub async fn update_avatar(
    State(state): State<SharedState>,
    current: CurrentUser,
    Json(body): Json<UpdateAvatarRequest>,
) -> AppResult<Json<User>> {
    current.require_human()?;
    let avatar_file_id = match body.avatar_file_id.as_deref().filter(|s| !s.is_empty()) {
        Some(raw) => {
            let file_id: Id = raw
                .parse()
                .map_err(|_| AppError::bad_request("invalid_id", "invalid avatar file id"))?;
            let uploader = state.storage.file_uploader(file_id).await?;
            if uploader != Some(current.user.id) {
                return Err(AppError::bad_request(
                    "invalid_avatar",
                    "avatar must be a file you uploaded yourself",
                ));
            }
            Some(file_id)
        }
        None => None,
    };

    state.storage.set_user_avatar(current.user.id, avatar_file_id).await?;
    let user = state
        .storage
        .get_user_by_id(current.user.id)
        .await?
        .ok_or_else(|| AppError::internal("user vanished after its own avatar update"))?;
    Ok(Json(user))
}

pub async fn list_sessions(
    State(state): State<SharedState>,
    current: CurrentUser,
) -> AppResult<Json<Vec<Session>>> {
    current.require_human()?;
    let mut sessions = state.storage.list_sessions_for_user(current.user.id).await?;
    for session in &mut sessions {
        session.is_current = Some(session.id) == current.session_id;
    }
    Ok(Json(sessions))
}

/// "Remove all" in Active Sessions — every *other* device, keeping
/// this one signed in. Distinct from `logout_all` (Account tab's "Log
/// out everywhere"), which deliberately also ends the caller's own
/// session.
pub async fn revoke_other_sessions(
    State(state): State<SharedState>,
    current: CurrentUser,
) -> AppResult<StatusCode> {
    current.require_human()?;
    state
        .storage
        .delete_other_sessions_for_user(current.user.id, current.human_session_id()?)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn revoke_session(
    State(state): State<SharedState>,
    current: CurrentUser,
    Path(id): Path<String>,
) -> AppResult<StatusCode> {
    let id: Id =
        id.parse().map_err(|_| AppError::bad_request("invalid_id", "invalid session id"))?;
    if state.storage.delete_session(id, current.user.id).await? {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(AppError::not_found("not_found", "session not found"))
    }
}

#[derive(Deserialize)]
pub struct DeleteAccountRequest {
    pub password: String,
    /// Bypasses the "you own a guild with other members" block,
    /// deleting every guild this account owns outright regardless of
    /// who else is in it. Defaults to `false` (the safe, reversible-by-
    /// hand-first behavior); the instance owner's client always sends
    /// `true` since they have no other way to self-delete (see below).
    #[serde(default)]
    pub force_guilds: bool,
}

/// GDPR self-service deletion — always a real, hard delete (every
/// message actually erased, the account row itself removed, not
/// neutralized into a "Deleted User" placeholder; see
/// `Storage::delete_account`). The instance owner can't self-delete
/// without `force_guilds: true` — deleting the one account with
/// `is_owner` while it might still be blocked on an owned guild with
/// other members, with no automatic "pick a new owner," would brick
/// the whole platform's admin capability with no way to recover it.
/// The client offers the owner two ways to still do this: transfer
/// ownership first (`transfer_ownership` below), then delete normally
/// with `force_guilds: false`; or delete straight away with
/// `force_guilds: true`, tearing down every guild they own in the same
/// action.
pub async fn delete_account(
    State(state): State<SharedState>,
    current: CurrentUser,
    Json(body): Json<DeleteAccountRequest>,
) -> AppResult<Response> {
    current.require_human()?;
    if current.user.is_owner && !body.force_guilds {
        return Err(AppError::bad_request(
            "is_instance_owner",
            "transfer ownership to someone else first, or delete without transferring instead",
        ));
    }

    let invalid_password =
        || AppError::unauthorized("invalid_password", "current password is incorrect");
    let existing_hash =
        state.storage.get_password_hash(current.user.id).await?.ok_or_else(invalid_password)?;
    if !password::verify(&existing_hash, &body.password) {
        return Err(invalid_password());
    }

    match state.storage.delete_account(current.user.id, body.force_guilds).await? {
        DeleteAccountOutcome::Ok => {
            let mut response = StatusCode::NO_CONTENT.into_response();
            response
                .headers_mut()
                .insert(axum::http::header::SET_COOKIE, cookie::clear_cookie_header());
            Ok(response)
        }
        DeleteAccountOutcome::OwnsGuildsWithMembers(guilds) => {
            let names: Vec<&str> = guilds.iter().map(|g| g.name.as_str()).collect();
            Err(AppError::bad_request(
                "owns_guilds",
                format!("transfer ownership or delete these servers first: {}", names.join(", ")),
            ))
        }
    }
}

#[derive(Deserialize)]
pub struct TransferOwnershipRequest {
    pub user_id: String,
    pub password: String,
}

/// The instance owner hands the "superadmin of the whole Chatly
/// platform" flag to a different real account, requiring their own
/// password again first (same bar as deleting an account) since this
/// is at least as consequential. Exists specifically so the owner then
/// has a real path to delete their *own* account afterward (see
/// `delete_account` above) — there's no other way for `is_owner` to
/// ever move, so getting the target validation wrong here would be
/// exactly as bad as `delete_account` bricking the platform.
pub async fn transfer_ownership(
    State(state): State<SharedState>,
    current: CurrentUser,
    Json(body): Json<TransferOwnershipRequest>,
) -> AppResult<StatusCode> {
    current.require_human()?;
    if !current.user.is_owner {
        return Err(AppError::forbidden(
            "forbidden",
            "only the instance owner can transfer ownership",
        ));
    }
    let target_id: Id =
        body.user_id.parse().map_err(|_| AppError::bad_request("invalid_id", "invalid user id"))?;
    if target_id == current.user.id {
        return Err(AppError::bad_request("same_user", "you're already the owner"));
    }

    let invalid_password =
        || AppError::unauthorized("invalid_password", "current password is incorrect");
    let existing_hash =
        state.storage.get_password_hash(current.user.id).await?.ok_or_else(invalid_password)?;
    if !password::verify(&existing_hash, &body.password) {
        return Err(invalid_password());
    }

    let users = state.storage.list_all_users_for_admin().await?;
    let target = users
        .into_iter()
        .find(|u| u.id == target_id)
        .ok_or_else(|| AppError::not_found("not_found", "no such user"))?;
    if target.is_bot || target.is_guest {
        return Err(AppError::bad_request(
            "invalid_target",
            "ownership can only be transferred to a real account",
        ));
    }

    state.storage.transfer_instance_ownership(current.user.id, target_id).await?;
    Ok(StatusCode::NO_CONTENT)
}
