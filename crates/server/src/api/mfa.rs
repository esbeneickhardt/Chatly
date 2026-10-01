use std::net::SocketAddr;

use axum::extract::{ConnectInfo, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::Response;
use axum::Json;
use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use serde::{Deserialize, Serialize};

use super::auth::session_response;
use super::current_user::CurrentUser;
use super::error::{AppError, AppResult};
use crate::auth::{password, token};
use crate::client_ip;
use crate::qr::render_qr_svg;
use crate::state::SharedState;
use crate::time::now_ms;

const RECOVERY_CODE_COUNT: usize = 10;

#[derive(Serialize)]
pub struct EnrollResponse {
    pub secret_base32: String,
    pub otpauth_uri: String,
    pub qr_svg: String,
}

pub async fn enroll(
    State(state): State<SharedState>,
    current: CurrentUser,
) -> AppResult<Json<EnrollResponse>> {
    current.require_human()?;
    if let Some(existing) = state.storage.get_totp(current.user.id).await? {
        if existing.enabled {
            return Err(AppError::conflict("mfa_already_enabled", "MFA is already enabled"));
        }
    }

    let secret = totp::generate_secret();
    let secret_base32 = totp::base32::encode(&secret);
    let encrypted = state.secret_key.encrypt(&secret);
    state.storage.set_totp_pending(current.user.id, encrypted).await?;

    let otpauth_uri =
        provisioning_uri(&state.config.instance_name, &current.user.username, &secret_base32);
    let qr_svg = render_qr_svg(&otpauth_uri)?;

    Ok(Json(EnrollResponse { secret_base32, otpauth_uri, qr_svg }))
}

fn provisioning_uri(issuer: &str, username: &str, secret_base32: &str) -> String {
    let issuer_enc = utf8_percent_encode(issuer, NON_ALPHANUMERIC).to_string();
    let username_enc = utf8_percent_encode(username, NON_ALPHANUMERIC).to_string();
    format!(
        "otpauth://totp/{issuer_enc}:{username_enc}?secret={secret_base32}&issuer={issuer_enc}&algorithm=SHA1&digits=6&period=30"
    )
}

#[derive(Deserialize)]
pub struct ConfirmRequest {
    pub code: String,
}

#[derive(Serialize)]
pub struct ConfirmResponse {
    pub recovery_codes: Vec<String>,
}

pub async fn confirm(
    State(state): State<SharedState>,
    current: CurrentUser,
    Json(body): Json<ConfirmRequest>,
) -> AppResult<Json<ConfirmResponse>> {
    current.require_human()?;
    let record = state
        .storage
        .get_totp(current.user.id)
        .await?
        .ok_or_else(|| AppError::bad_request("mfa_not_enrolled", "call enroll first"))?;
    if record.enabled {
        return Err(AppError::conflict("mfa_already_enabled", "MFA is already enabled"));
    }

    let secret = state.secret_key.decrypt(&record.secret_enc).map_err(AppError::internal)?;
    let now = (now_ms() / 1000) as u64;
    let step = totp::verify(&secret, body.code.trim(), now, None)
        .ok_or_else(|| AppError::unauthorized("invalid_code", "invalid verification code"))?;
    state.storage.enable_totp(current.user.id, step).await?;

    let mut codes = Vec::with_capacity(RECOVERY_CODE_COUNT);
    let mut hashes = Vec::with_capacity(RECOVERY_CODE_COUNT);
    for _ in 0..RECOVERY_CODE_COUNT {
        let code = token::generate_recovery_code();
        hashes.push(token::hash(&code));
        codes.push(code);
    }
    state.storage.replace_recovery_codes(current.user.id, hashes).await?;

    Ok(Json(ConfirmResponse { recovery_codes: codes }))
}

#[derive(Deserialize)]
pub struct DisableRequest {
    pub code: Option<String>,
    pub password: Option<String>,
}

pub async fn disable(
    State(state): State<SharedState>,
    current: CurrentUser,
    Json(body): Json<DisableRequest>,
) -> AppResult<StatusCode> {
    current.require_human()?;
    let record = state
        .storage
        .get_totp(current.user.id)
        .await?
        .filter(|r| r.enabled)
        .ok_or_else(|| AppError::bad_request("mfa_not_enabled", "MFA is not enabled"))?;

    let mut verified = false;
    if let Some(code) = body.code.as_deref() {
        let secret = state.secret_key.decrypt(&record.secret_enc).map_err(AppError::internal)?;
        let now = (now_ms() / 1000) as u64;
        verified =
            totp::verify(&secret, code.trim(), now, record.last_step.map(|s| s as u64)).is_some();
    }
    if !verified {
        if let Some(pw) = body.password.as_deref() {
            let record =
                state.storage.get_user_by_username_for_login(&current.user.username).await?;
            verified = record.is_some_and(|r| password::verify(&r.password_hash, pw));
        }
    }
    if !verified {
        return Err(AppError::unauthorized(
            "verification_failed",
            "current TOTP code or password required to disable MFA",
        ));
    }

    state.storage.disable_totp(current.user.id).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
pub struct VerifyRequest {
    pub preauth_token: String,
    pub code: String,
}

pub async fn verify(
    State(state): State<SharedState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(body): Json<VerifyRequest>,
) -> AppResult<Response> {
    let ip = client_ip::resolve(&headers, peer, state.config.trusted_proxy);
    if !state.rate_limits.mfa_ip.check(&ip.to_string()) {
        return Err(AppError::too_many_requests("rate_limited", "too many MFA attempts"));
    }

    let user_id = state.preauth.try_attempt(&body.preauth_token).ok_or_else(|| {
        AppError::unauthorized("invalid_preauth", "pre-auth token is invalid or expired")
    })?;

    let record = state
        .storage
        .get_totp(user_id)
        .await?
        .filter(|r| r.enabled)
        .ok_or_else(|| AppError::internal("mfa record missing for a pre-authenticated user"))?;

    let code = body.code.trim();
    let accepted = if code.len() == 6 && code.chars().all(|c| c.is_ascii_digit()) {
        let secret = state.secret_key.decrypt(&record.secret_enc).map_err(AppError::internal)?;
        let now = (now_ms() / 1000) as u64;
        match totp::verify(&secret, code, now, record.last_step.map(|s| s as u64)) {
            Some(step) => {
                state.storage.update_totp_last_step(user_id, step).await?;
                true
            }
            None => false,
        }
    } else {
        state.storage.consume_recovery_code(user_id, &token::hash(&code.to_uppercase())).await?
    };

    if !accepted {
        return Err(AppError::unauthorized("invalid_code", "invalid code"));
    }
    state.preauth.consume(&body.preauth_token);

    let user =
        state.storage.get_user_by_id(user_id).await?.ok_or_else(|| {
            AppError::internal("user vanished immediately after MFA verification")
        })?;
    let user_agent =
        headers.get(axum::http::header::USER_AGENT).and_then(|v| v.to_str().ok()).map(String::from);
    session_response(&state, user, user_agent, None, None).await
}
