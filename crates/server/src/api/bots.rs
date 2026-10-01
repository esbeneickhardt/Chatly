//! The minimal real "extension point" for future plugins/integrations
//! (polls, a chess bot, a chatbot, a music-DJ bot, and anything else
//! down the line) — see UX_FEEDBACK.md. A bot is deliberately *not* a
//! new concept bolted on top of the data model: it's an ordinary
//! `users` row (`is_bot = true`) added to a guild exactly like any
//! other member, so every existing permission check and every
//! existing message/reaction endpoint already works for it, completely
//! unchanged. The only new thing is *how* it authenticates — a
//! long-lived bearer token (`Authorization: Bot <token>`) instead of a
//! session cookie, since it never logs in with a password — see
//! `api::current_user::CurrentUser`.
//!
//! Voice/video participation for a bot (the "DJ" use case) is
//! explicitly out of scope here — that needs a real WebRTC client
//! implementation on the bot's side, not just an API surface, and is
//! a much bigger lift than this first extension point. What's here is
//! the foundation every text-based bot (polls, games, a chatbot) needs
//! before any of those can exist at all.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};

use protocol::{Id, Permissions};

use super::audit;
use super::current_user::CurrentUser;
use super::error::{AppError, AppResult};
use super::permissions::require_guild_permission;
use crate::auth::{password, token};
use crate::models::{NewBot, User};
use crate::state::SharedState;

#[derive(Deserialize)]
pub struct CreateBotRequest {
    pub display_name: String,
}

#[derive(Serialize)]
pub struct CreateBotResponse {
    pub user: User,
    /// Shown exactly once — the server only ever stores its hash (see
    /// `bot_tokens`), the same way a session token or password never
    /// round-trips back out once set.
    pub token: String,
}

/// Creating a bot needs the same access as anything else that changes
/// who's in the guild — `MANAGE_GUILD`, not the lower `CREATE_INVITE`
/// bar an ordinary invite needs, since a bot is a standing, always-on
/// member rather than a one-time invite link.
pub async fn create(
    State(state): State<SharedState>,
    current: CurrentUser,
    Path(guild_id): Path<String>,
    Json(body): Json<CreateBotRequest>,
) -> AppResult<Json<CreateBotResponse>> {
    current.require_human()?;
    let guild_id: Id =
        guild_id.parse().map_err(|_| AppError::bad_request("invalid_id", "invalid guild id"))?;
    require_guild_permission(&state, current.user.id, guild_id, Permissions::MANAGE_GUILD).await?;

    let display_name = body.display_name.trim();
    if display_name.is_empty() || display_name.chars().count() > 64 {
        return Err(AppError::bad_request(
            "invalid_display_name",
            "display name must be 1-64 characters",
        ));
    }

    let bot_id = state.snowflake.next_id();
    // A bot never picks or types its own username, so it doesn't need
    // to satisfy the human-facing "memorable handle" goal
    // `validate_username` exists for — just a guaranteed-unique one
    // derived from its own id.
    let username = format!("bot-{}", bot_id.raw());
    // No login path will ever accept this (see
    // `queries::users::by_username_for_login` excluding `is_bot`
    // rows), so the actual value just needs to be unguessable, same
    // as any other secret this codebase generates.
    let unusable_password_hash =
        password::hash(&token::generate_session_token()).map_err(AppError::internal)?;
    let raw_token = token::generate_session_token();
    let token_hash = token::hash(&raw_token);

    let user = state
        .storage
        .create_bot(NewBot {
            bot_id,
            username,
            display_name: display_name.to_string(),
            password_hash: unusable_password_hash,
            guild_id,
            token_hash,
            created_by: current.user.id,
        })
        .await?;

    audit::record(
        &state,
        Some(guild_id),
        &current.user,
        "bot.create",
        Some(user.id),
        Some(user.display_name.clone()),
        None,
    )
    .await;
    Ok(Json(CreateBotResponse { user, token: raw_token }))
}

pub async fn list(
    State(state): State<SharedState>,
    current: CurrentUser,
    Path(guild_id): Path<String>,
) -> AppResult<Json<Vec<User>>> {
    current.require_human()?;
    let guild_id: Id =
        guild_id.parse().map_err(|_| AppError::bad_request("invalid_id", "invalid guild id"))?;
    require_guild_permission(&state, current.user.id, guild_id, Permissions::MANAGE_GUILD).await?;
    Ok(Json(state.storage.list_bots_for_guild(guild_id).await?))
}

/// Revokes the bot's token (it can no longer authenticate at all) —
/// doesn't touch the account or its guild membership, so its past
/// messages stay attributed to it and it can still be removed as a
/// member separately (the guild's existing "remove member" action)
/// if it should disappear from the roster entirely too.
pub async fn revoke(
    State(state): State<SharedState>,
    current: CurrentUser,
    Path((guild_id, bot_id)): Path<(String, String)>,
) -> AppResult<StatusCode> {
    current.require_human()?;
    let guild_id: Id =
        guild_id.parse().map_err(|_| AppError::bad_request("invalid_id", "invalid guild id"))?;
    require_guild_permission(&state, current.user.id, guild_id, Permissions::MANAGE_GUILD).await?;
    let bot_id: Id =
        bot_id.parse().map_err(|_| AppError::bad_request("invalid_id", "invalid bot id"))?;

    // Scoped to *this* guild's bots specifically — otherwise any guild
    // admin could revoke a bot's token just by guessing its id, even
    // one that belongs to a completely different server.
    let is_this_guilds_bot =
        state.storage.list_bots_for_guild(guild_id).await?.iter().any(|b| b.id == bot_id);
    if !is_this_guilds_bot {
        return Err(AppError::not_found("not_found", "no such bot in this server"));
    }

    if state.storage.revoke_bot_token(bot_id).await? {
        let bot_name = state.storage.get_user_by_id(bot_id).await?.map(|u| u.display_name);
        audit::record(
            &state,
            Some(guild_id),
            &current.user,
            "bot.revoke",
            Some(bot_id),
            bot_name,
            None,
        )
        .await;
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(AppError::not_found("not_found", "that bot has no active token"))
    }
}
