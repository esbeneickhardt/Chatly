use axum::extract::FromRequestParts;
use axum::http::request::Parts;

use protocol::Id;

use super::error::AppError;
use crate::auth::{cookie, token};
use crate::models::User;
use crate::state::SharedState;
use crate::time::now_ms;

/// The authenticated user for the current request — either a human
/// (resolved from the session cookie, the usual case) or a bot (see
/// `api::bots`, resolved from an `Authorization: Bot <token>` header
/// instead). `session_id` is `None` exactly when `via_bot_token` is
/// true: a bot has no session to reference, since it never logged in
/// with a password in the first place. Touches a human's `last_seen`
/// at most once an hour to avoid write churn on every request.
pub struct CurrentUser {
    pub user: User,
    pub session_id: Option<Id>,
    pub via_bot_token: bool,
}

impl CurrentUser {
    /// Rejects a bot token *or* a guest account for the handful of
    /// endpoints that manage the account/session itself (password,
    /// MFA, sessions, profile, avatar, invites, bot creation) rather
    /// than the narrow surface either of those exists to use —
    /// least-privilege: a leaked bot token shouldn't be able to touch
    /// any of that, and a guest (who never signed up for anything,
    /// has no password, and is about to auto-expire anyway) has no
    /// business in account settings at all.
    pub fn require_human(&self) -> Result<(), AppError> {
        if self.via_bot_token {
            Err(AppError::forbidden("bot_not_allowed", "bots can't do this"))
        } else if self.user.is_guest {
            Err(AppError::forbidden("guest_not_allowed", "guests can't do this"))
        } else {
            Ok(())
        }
    }
}

impl CurrentUser {
    /// The id of the session this request came in on — which only a
    /// human (non-bot, non-guest) request has. Rejects everyone else the
    /// same way `require_human` does, so callers never need to unwrap
    /// `session_id`.
    pub fn human_session_id(&self) -> Result<Id, AppError> {
        self.require_human()?;
        self.session_id.ok_or_else(|| AppError::forbidden("bot_not_allowed", "bots can't do this"))
    }
}

const BOT_AUTH_PREFIX: &str = "Bot ";

impl FromRequestParts<SharedState> for CurrentUser {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &SharedState,
    ) -> Result<Self, Self::Rejection> {
        let bot_token = parts
            .headers
            .get(axum::http::header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix(BOT_AUTH_PREFIX));

        if let Some(bot_token) = bot_token {
            let token_hash = token::hash(bot_token);
            let user = state
                .storage
                .get_user_by_bot_token(&token_hash)
                .await
                .map_err(AppError::internal)?
                .ok_or_else(|| AppError::unauthorized("not_authenticated", "invalid bot token"))?;
            return Ok(CurrentUser { user, session_id: None, via_bot_token: true });
        }

        let token = cookie::read_session_token(&parts.headers)
            .ok_or_else(|| AppError::unauthorized("not_authenticated", "no session cookie"))?;
        let token_hash = token::hash(&token);
        let now = now_ms();

        let session = state
            .storage
            .get_session_by_token_hash(&token_hash, now)
            .await
            .map_err(AppError::internal)?
            .ok_or_else(|| {
                AppError::unauthorized("not_authenticated", "invalid or expired session")
            })?;

        // An expired guest is treated exactly like an expired session
        // (same error, so there's no way to distinguish "your guest
        // pass ran out" from "your cookie's just old" from the
        // outside) — and opportunistically cleaned up right here
        // rather than needing a separate sweep/cron: whichever request
        // happens to be the first to notice does it, reusing the same
        // `delete_account` erase path self-service GDPR deletion uses
        // (a guest's own message in that call, if any, goes with it).
        if session.guest_expires_at.is_some_and(|exp| exp <= now) {
            let storage = state.storage.clone();
            let user_id = session.user.id;
            tokio::spawn(async move {
                let _ = storage.delete_account(user_id, false).await;
            });
            return Err(AppError::unauthorized("not_authenticated", "invalid or expired session"));
        }

        if now - session.last_seen > 60 * 60 * 1000 {
            let storage = state.storage.clone();
            let session_id = session.session_id;
            tokio::spawn(async move {
                let _ = storage.touch_session_last_seen(session_id, now_ms()).await;
            });
        }

        Ok(CurrentUser {
            user: session.user,
            session_id: Some(session.session_id),
            via_bot_token: false,
        })
    }
}
