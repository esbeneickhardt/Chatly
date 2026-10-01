//! Friends: search someone by username and send them a request —
//! nothing happens until they accept it, so nobody can be added as a
//! friend (and nobody's DM list gets a new entry) without their own
//! action. Replaces the earlier invite-link/QR system entirely (see
//! migration 0012); a user can also opt out of receiving requests at
//! all (`accepts_friend_requests`), in which case a request against
//! them is rejected outright rather than silently swallowed.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};

use protocol::Id;

use super::current_user::CurrentUser;
use super::error::{AppError, AppResult};
use crate::gateway::DispatchEvent;
use crate::models::{
    AcceptFriendRequestOutcome, DmChannelSummary, FriendRequest, SendFriendRequestOutcome, User,
};
use crate::state::SharedState;

pub async fn list(
    State(state): State<SharedState>,
    current: CurrentUser,
) -> AppResult<Json<Vec<User>>> {
    Ok(Json(state.storage.list_friends(current.user.id).await?))
}

pub async fn remove(
    State(state): State<SharedState>,
    current: CurrentUser,
    Path(friend_id): Path<String>,
) -> AppResult<StatusCode> {
    let friend_id: Id =
        friend_id.parse().map_err(|_| AppError::bad_request("invalid_id", "invalid user id"))?;
    if state.storage.remove_friend(current.user.id, friend_id).await? {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(AppError::not_found("not_found", "not friends with that user"))
    }
}

#[derive(Deserialize)]
pub struct SendFriendRequestRequest {
    pub username: String,
}

pub async fn create_request(
    State(state): State<SharedState>,
    current: CurrentUser,
    Json(body): Json<SendFriendRequestRequest>,
) -> AppResult<Json<FriendRequest>> {
    let username = body.username.trim().to_lowercase();
    let recipient = state
        .storage
        .get_user_by_username(&username)
        .await?
        .ok_or_else(|| AppError::not_found("not_found", "no such user"))?;

    let id = state.snowflake.next_id();
    let now = id.timestamp_ms() as i64;
    match state.storage.send_friend_request(id, current.user.id, recipient.id, now).await? {
        SendFriendRequestOutcome::Requested(request) => {
            state.gateway.publish(
                recipient.id,
                DispatchEvent::FriendRequestCreate(FriendRequest {
                    id: request.id,
                    other: current.user,
                    created_at: request.created_at,
                    incoming: true,
                }),
            );
            Ok(Json(request))
        }
        SendFriendRequestOutcome::BecameFriends(friend) => {
            notify_became_friends(&state, current.user.id, &friend).await?;
            // The caller asked to send a request; getting an instant
            // friendship back (because they'd already been sent one)
            // is a better outcome, not an error — represent it in the
            // same shape as an already-accepted request.
            Ok(Json(FriendRequest { id, other: friend, created_at: now, incoming: false }))
        }
        SendFriendRequestOutcome::AlreadyFriends => {
            Err(AppError::conflict("already_friends", "you're already friends"))
        }
        SendFriendRequestOutcome::AlreadyRequested => {
            Err(AppError::conflict("already_requested", "there's already a pending request"))
        }
        SendFriendRequestOutcome::CannotFriendSelf => {
            Err(AppError::bad_request("cannot_friend_self", "you can't friend yourself"))
        }
        SendFriendRequestOutcome::NotAcceptingRequests => Err(AppError::bad_request(
            "not_accepting_requests",
            "this user isn't accepting friend requests",
        )),
    }
}

pub async fn list_requests(
    State(state): State<SharedState>,
    current: CurrentUser,
) -> AppResult<Json<Vec<FriendRequest>>> {
    Ok(Json(state.storage.list_friend_requests(current.user.id).await?))
}

pub async fn accept_request(
    State(state): State<SharedState>,
    current: CurrentUser,
    Path(request_id): Path<String>,
) -> AppResult<Json<User>> {
    let request_id: Id = request_id
        .parse()
        .map_err(|_| AppError::bad_request("invalid_id", "invalid request id"))?;
    let new_dm_channel_id = state.snowflake.next_id();
    match state
        .storage
        .accept_friend_request(request_id, current.user.id, new_dm_channel_id)
        .await?
    {
        AcceptFriendRequestOutcome::Ok(friend) => {
            notify_became_friends(&state, current.user.id, &friend).await?;
            Ok(Json(friend))
        }
        AcceptFriendRequestOutcome::NotFound => {
            Err(AppError::not_found("not_found", "no such pending request"))
        }
    }
}

pub async fn remove_request(
    State(state): State<SharedState>,
    current: CurrentUser,
    Path(request_id): Path<String>,
) -> AppResult<StatusCode> {
    let request_id: Id = request_id
        .parse()
        .map_err(|_| AppError::bad_request("invalid_id", "invalid request id"))?;
    if state.storage.remove_friend_request(request_id, current.user.id).await? {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(AppError::not_found("not_found", "no such pending request"))
    }
}

#[derive(Deserialize)]
pub struct UpdateFriendSettingsRequest {
    pub accepts_friend_requests: bool,
}

#[derive(Serialize)]
pub struct FriendSettings {
    pub accepts_friend_requests: bool,
}

pub async fn update_settings(
    State(state): State<SharedState>,
    current: CurrentUser,
    Json(body): Json<UpdateFriendSettingsRequest>,
) -> AppResult<Json<FriendSettings>> {
    state
        .storage
        .set_accepts_friend_requests(current.user.id, body.accepts_friend_requests)
        .await?;
    Ok(Json(FriendSettings { accepts_friend_requests: body.accepts_friend_requests }))
}

/// Both users just became friends — a fresh DM channel already exists
/// between them (created by `accept_friend_request`, or here for the
/// mutual-request-collision path) but neither of their already-open
/// gateway connections was ever subscribed to it, so tell each of
/// them directly on their own personal room (keyed by their own user
/// id — see `gateway::mod::handle_socket`) with enough to render the
/// new conversation and start receiving live messages in it without
/// reconnecting.
async fn notify_became_friends(
    state: &SharedState,
    acting_user_id: Id,
    friend: &User,
) -> AppResult<()> {
    let dm = state
        .storage
        .get_or_create_dm(state.snowflake.next_id(), acting_user_id, friend.id)
        .await?;
    let acting_user = state
        .storage
        .get_user_by_id(acting_user_id)
        .await?
        .ok_or_else(|| AppError::not_found("not_found", "user vanished"))?;

    state.gateway.publish(
        friend.id,
        DispatchEvent::DmChannelCreate(DmChannelSummary {
            channel: dm.clone(),
            participants: vec![acting_user],
            pinned: false,
        }),
    );
    state.gateway.publish(
        acting_user_id,
        DispatchEvent::DmChannelCreate(DmChannelSummary {
            channel: dm,
            participants: vec![friend.clone()],
            pinned: false,
        }),
    );
    Ok(())
}
