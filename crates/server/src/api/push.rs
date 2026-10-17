//! Web Push subscriptions: a browser that turned notifications on registers
//! where it can be reached while Chatly is closed (see `crate::push`).

use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};

use super::current_user::CurrentUser;
use super::error::{AppError, AppResult};
use crate::models::PushSubscription;
use crate::state::SharedState;

#[derive(Serialize)]
pub struct PublicKey {
    public_key: String,
}

/// The server's VAPID public key, which a browser subscribes with.
pub async fn public_key(
    State(state): State<SharedState>,
    current: CurrentUser,
) -> AppResult<Json<PublicKey>> {
    current.require_human()?;
    Ok(Json(PublicKey { public_key: state.push.public_key().to_string() }))
}

#[derive(Deserialize)]
pub struct SubscriptionKeys {
    pub p256dh: String,
    pub auth: String,
}

/// The browser's own `PushSubscription.toJSON()` shape.
#[derive(Deserialize)]
pub struct SubscribeRequest {
    pub endpoint: String,
    pub keys: SubscriptionKeys,
}

pub async fn subscribe(
    State(state): State<SharedState>,
    current: CurrentUser,
    Json(body): Json<SubscribeRequest>,
) -> AppResult<StatusCode> {
    let session_id = current.human_session_id()?;
    let sub = PushSubscription {
        endpoint: body.endpoint,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
    };
    crate::push::validate(&sub)
        .map_err(|message| AppError::bad_request("invalid_subscription", message))?;
    state.storage.save_push_subscription(current.user.id, session_id, sub).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
pub struct UnsubscribeRequest {
    pub endpoint: String,
}

pub async fn unsubscribe(
    State(state): State<SharedState>,
    current: CurrentUser,
    Json(body): Json<UnsubscribeRequest>,
) -> AppResult<StatusCode> {
    current.require_human()?;
    state.storage.delete_push_subscription(current.user.id, &body.endpoint).await?;
    Ok(StatusCode::NO_CONTENT)
}
