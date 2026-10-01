//! Direct messages: conversations modelled as channels with no guild
//! (see `PLAN.md` Phase 3.2). Message list/create for these channels
//! reuse `api::messages` unchanged — `require_channel_permission`
//! branches on `channel.guild_id` being `None` and checks DM
//! participation instead of guild membership.
//!
//! `open` (below) opens the self-DM ("note to self"), a 1:1 with someone
//! (also how a friend whose chat was closed is brought back — friends
//! are always reachable), or a new group by username. Starting a *new*
//! 1:1 with a stranger is `api::friends`' job (search, send a request,
//! nothing happens until they accept). Adding someone to a conversation
//! doesn't need that gate: `add_participant` grows a group in place,
//! and — like Discord — turns a 1:1 into a *new* group while leaving
//! the original 1:1 untouched.

use std::collections::HashSet;

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};

use protocol::Id;

use super::current_user::CurrentUser;
use super::error::{AppError, AppResult};
use crate::gateway::DispatchEvent;
use crate::models::{Channel, User, MAX_GROUP_DM_PARTICIPANTS};
use crate::state::SharedState;

const SEARCH_LIMIT: i64 = 10;

#[derive(Deserialize)]
pub struct SearchUsersQuery {
    #[serde(default)]
    pub q: String,
}

pub async fn search_users(
    State(state): State<SharedState>,
    _current: CurrentUser,
    Query(params): Query<SearchUsersQuery>,
) -> AppResult<Json<Vec<User>>> {
    let query = params.q.trim();
    if query.is_empty() {
        return Ok(Json(vec![]));
    }
    Ok(Json(state.storage.search_users(query, SEARCH_LIMIT).await?))
}

#[derive(Serialize)]
pub struct DmSummary {
    pub channel: Channel,
    pub participants: Vec<User>,
    pub pinned: bool,
}

pub async fn list(
    State(state): State<SharedState>,
    current: CurrentUser,
) -> AppResult<Json<Vec<DmSummary>>> {
    // The self-DM ("note to self") used to only exist once explicitly
    // created via a dedicated "Message yourself" button — removed in
    // favor of it just always being there (see UX_FEEDBACK.md).
    // `get_or_create_dm` is idempotent (a cheap lookup once it
    // exists), so unconditionally ensuring it here — on every list
    // fetch, for every account including ones that predate this
    // change — is simpler and needs no migration/backfill.
    state
        .storage
        .get_or_create_dm(state.snowflake.next_id(), current.user.id, current.user.id)
        .await?;
    let dms = state.storage.list_dms_for_user(current.user.id).await?;
    Ok(Json(
        dms.into_iter()
            .map(|d| DmSummary {
                channel: d.channel,
                participants: d.participants,
                pinned: d.pinned,
            })
            .collect(),
    ))
}

pub async fn pin(
    State(state): State<SharedState>,
    current: CurrentUser,
    Path(channel_id): Path<String>,
) -> AppResult<StatusCode> {
    let channel_id = parse_dm_channel_id(&channel_id, &state, current.user.id).await?;
    state.storage.set_dm_pinned(current.user.id, channel_id, true).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn unpin(
    State(state): State<SharedState>,
    current: CurrentUser,
    Path(channel_id): Path<String>,
) -> AppResult<StatusCode> {
    let channel_id = parse_dm_channel_id(&channel_id, &state, current.user.id).await?;
    state.storage.set_dm_pinned(current.user.id, channel_id, false).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Removes a conversation from your own DM list without touching
/// anyone else's — the counterpart to a group's `leave` for a 1:1 (or
/// the self-DM's own participant, though the frontend never actually
/// offers this for the self-DM — see UX_FEEDBACK.md, it always stays
/// visible). A new message arriving un-hides it automatically; see
/// `queries::dms::list_for_user`.
pub async fn hide(
    State(state): State<SharedState>,
    current: CurrentUser,
    Path(channel_id): Path<String>,
) -> AppResult<StatusCode> {
    let channel_id = parse_dm_channel_id(&channel_id, &state, current.user.id).await?;
    state.storage.hide_dm(current.user.id, channel_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Removes you from a group DM entirely — the counterpart to `hide`
/// for a real group (3+ participants). Only allowed there: leaving a
/// 1:1 (or the self-DM) by deleting your own `dm_participants` row
/// would leave a channel with exactly one participant, which is
/// structurally indistinguishable from a self-DM (see
/// `queries::dms::find_existing_self`) and would corrupt the model
/// for whoever's left — those get `hide` instead, which never touches
/// the shared conversation itself.
pub async fn leave(
    State(state): State<SharedState>,
    current: CurrentUser,
    Path(channel_id): Path<String>,
) -> AppResult<StatusCode> {
    let channel_id = parse_dm_channel_id(&channel_id, &state, current.user.id).await?;

    let count = state.storage.dm_participant_count(channel_id).await?;
    if count < 3 {
        return Err(AppError::bad_request(
            "not_a_group",
            "can't leave a 1:1 conversation — hide it instead",
        ));
    }

    state.storage.remove_dm_participant(channel_id, current.user.id).await?;
    // Everyone still in the conversation needs to see the departure
    // live (same reasoning as `add_participant`'s broadcast, just the
    // opposite direction) — the leaver themselves already knows via
    // this response, and their own gateway connection unsubscribes
    // from the room the next time they reconnect/refresh.
    state.gateway.publish(
        channel_id,
        DispatchEvent::DmParticipantLeave { channel_id, user_id: current.user.id },
    );
    Ok(StatusCode::NO_CONTENT)
}

/// Who is on a call right now in each of your conversations. A client only
/// hears about calls through live join/leave events, so one that has just
/// loaded (or reconnected, or been away on another server) asks for this to
/// learn about calls that started before it was listening. Without it, it
/// believes nobody is on a call that someone is on, and pressing Call rings
/// a person who is already there.
pub async fn voice_state(
    State(state): State<SharedState>,
    current: CurrentUser,
) -> AppResult<Json<Vec<super::guilds::VoiceParticipant>>> {
    let dms = state.storage.list_dms_for_user(current.user.id).await?;
    let mut on_calls = Vec::new();
    for dm in dms {
        // A conversation's call lives in the conversation's own channel, and
        // its presence room is the channel id (see `permissions::broadcast_room`).
        for (channel_id, user_id) in state.gateway.voice_participants(dm.channel.id) {
            if channel_id == dm.channel.id {
                on_calls.push(super::guilds::VoiceParticipant { channel_id, user_id });
            }
        }
    }
    Ok(Json(on_calls))
}

/// Turns down an incoming call in a conversation you're in. There is no
/// server-side "ringing" state to end — a call is just people in a voice
/// channel — so this only tells the others, letting the caller see
/// "Declined" instead of ringing on until it times out.
pub async fn decline_call(
    State(state): State<SharedState>,
    current: CurrentUser,
    Path(channel_id): Path<String>,
) -> AppResult<StatusCode> {
    let channel_id = parse_dm_channel_id(&channel_id, &state, current.user.id).await?;
    state.gateway.publish(
        channel_id,
        DispatchEvent::DmCallDeclined { channel_id, user_id: current.user.id },
    );
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
pub struct AddParticipantRequest {
    pub username: String,
}

/// Adds someone to an existing DM — the "add people" step that grows
/// a 1:1 into a group (or a group into a bigger one). No friend gate:
/// same as `open`'s group case, this has always just needed the acting
/// user to already be in the conversation.
pub async fn add_participant(
    State(state): State<SharedState>,
    current: CurrentUser,
    Path(channel_id): Path<String>,
    Json(body): Json<AddParticipantRequest>,
) -> AppResult<Json<DmSummary>> {
    let channel_id = parse_dm_channel_id(&channel_id, &state, current.user.id).await?;

    // Your private "note to self" chat is exactly that — private. Adding
    // someone used to turn it into a chat with them (still flagged as a
    // self-DM, so `find_existing_self` kept finding *it* and never made a
    // fresh private one), which is how an account's own "You" chat
    // vanished. Start a new conversation to talk to someone instead.
    if state.storage.is_self_dm(channel_id).await? {
        return Err(AppError::bad_request(
            "self_dm_is_private",
            "your private chat can't have other people in it",
        ));
    }

    let count = state.storage.dm_participant_count(channel_id).await?;
    if count as usize >= MAX_GROUP_DM_PARTICIPANTS {
        return Err(AppError::bad_request(
            "too_many_participants",
            format!("group DMs are limited to {MAX_GROUP_DM_PARTICIPANTS} people"),
        ));
    }

    let username = body.username.trim().to_lowercase();
    let new_user = state
        .storage
        .get_user_by_username(&username)
        .await?
        .ok_or_else(|| AppError::not_found("not_found", "no such user"))?;
    if state.storage.is_dm_participant(channel_id, new_user.id).await? {
        return Err(AppError::conflict(
            "already_in_conversation",
            "they're already in this conversation",
        ));
    }

    // Adding to a 1:1 must not consume it: the original chat (and its
    // history) stays exactly where it is, and the two people plus the
    // newcomer get a *new* group. Only a chat that's already a group
    // grows in place. (Growing the 1:1 itself used to make it vanish —
    // it stopped being a chat with that friend.)
    if count == 2 {
        return start_group_from_pair(&state, &current, channel_id, new_user).await;
    }

    state.storage.add_dm_participant(channel_id, new_user.id).await?;
    let channel = state
        .storage
        .get_channel(channel_id)
        .await?
        .ok_or_else(|| AppError::internal("conversation vanished while adding to it"))?;
    let all = state.storage.list_dm_participant_users(channel_id).await?;
    let participants: Vec<User> = all.into_iter().filter(|u| u.id != current.user.id).collect();

    // Everyone already in the conversation needs to see the new
    // member show up live; the new member themselves wasn't
    // subscribed to this room at all until now, so they get the
    // dedicated "a new DM channel now includes you" event on their
    // own personal room instead (see `gateway::mod::handle_socket`).
    state.gateway.publish(
        channel_id,
        DispatchEvent::DmChannelCreate(crate::models::DmChannelSummary {
            channel: channel.clone(),
            participants: participants.clone(),
            pinned: false,
        }),
    );
    let new_user_view: Vec<User> = state
        .storage
        .list_dm_participant_users(channel_id)
        .await?
        .into_iter()
        .filter(|u| u.id != new_user.id)
        .collect();
    state.gateway.publish(
        new_user.id,
        DispatchEvent::DmChannelCreate(crate::models::DmChannelSummary {
            channel: channel.clone(),
            participants: new_user_view,
            pinned: false,
        }),
    );

    // If a call is already going on in this conversation, the new
    // member needs to be rung into it. Clients have no other way to
    // learn about a call than the `VOICE_STATE_UPDATE` fired when
    // someone joins — which happened before this person was in the
    // room, so they'd never see it. Replaying each current
    // participant's join to just this user (on their personal room, so
    // it lands right after the `DmChannelCreate` above) makes it look
    // to them exactly like the call starting.
    for (in_channel, user_id) in state.gateway.voice_participants(channel_id) {
        if in_channel == channel_id && user_id != new_user.id {
            state.gateway.publish(
                new_user.id,
                DispatchEvent::VoiceStateUpdate { channel_id, user_id, connected: true },
            );
        }
    }

    Ok(Json(DmSummary { channel, participants, pinned: false }))
}

/// Builds the new group for `add_participant`'s 1:1 case: the two
/// people in `pair_channel_id` plus `new_user`. Each member gets the
/// `DmChannelCreate` on their own personal room (nobody is subscribed
/// to the brand-new channel's room yet) with the list of *everyone
/// else*, and the caller's view is the response.
async fn start_group_from_pair(
    state: &SharedState,
    current: &CurrentUser,
    pair_channel_id: Id,
    new_user: User,
) -> AppResult<Json<DmSummary>> {
    let mut others: Vec<Id> = state
        .storage
        .list_dm_participant_users(pair_channel_id)
        .await?
        .into_iter()
        .map(|u| u.id)
        .filter(|id| *id != current.user.id)
        .collect();
    others.push(new_user.id);
    let channel =
        state.storage.create_group_dm(state.snowflake.next_id(), current.user.id, others).await?;

    let members = state.storage.list_dm_participant_users(channel.id).await?;
    for member in &members {
        let view: Vec<User> = members.iter().filter(|u| u.id != member.id).cloned().collect();
        state.gateway.publish(
            member.id,
            DispatchEvent::DmChannelCreate(crate::models::DmChannelSummary {
                channel: channel.clone(),
                participants: view,
                pinned: false,
            }),
        );
    }

    // If the 1:1 has a call going, the call moves with the conversation:
    // tell each of the original two so whoever is on it follows together.
    // Sent after the `DmChannelCreate` above, on the same personal rooms, so
    // every client knows the group by the time it hears about the move.
    let on_the_call = state
        .gateway
        .voice_participants(pair_channel_id)
        .into_iter()
        .any(|(in_channel, _)| in_channel == pair_channel_id);
    if on_the_call {
        for member in members.iter().filter(|m| m.id != new_user.id) {
            state.gateway.publish(
                member.id,
                DispatchEvent::DmCallMoved {
                    from_channel_id: pair_channel_id,
                    to_channel_id: channel.id,
                    by: current.user.id,
                },
            );
        }
    }

    let participants: Vec<User> = members.into_iter().filter(|u| u.id != current.user.id).collect();
    Ok(Json(DmSummary { channel, participants, pinned: false }))
}

async fn parse_dm_channel_id(raw: &str, state: &SharedState, user_id: Id) -> AppResult<Id> {
    let channel_id: Id =
        raw.parse().map_err(|_| AppError::bad_request("invalid_id", "invalid channel id"))?;
    let channel = state
        .storage
        .get_channel(channel_id)
        .await?
        .ok_or_else(|| AppError::not_found("not_found", "no such conversation"))?;
    if channel.guild_id.is_some() || !state.storage.is_dm_participant(channel_id, user_id).await? {
        return Err(AppError::not_found("not_found", "no such conversation"));
    }
    Ok(channel_id)
}

#[derive(Deserialize)]
pub struct OpenDmRequest {
    pub usernames: Vec<String>,
}

pub async fn open(
    State(state): State<SharedState>,
    current: CurrentUser,
    Json(body): Json<OpenDmRequest>,
) -> AppResult<Json<DmSummary>> {
    let usernames: Vec<String> =
        body.usernames.iter().map(|s| s.trim().to_lowercase()).filter(|s| !s.is_empty()).collect();
    if usernames.is_empty() {
        return Err(AppError::bad_request(
            "empty_participants",
            "pick at least one person to message",
        ));
    }

    let mut resolved = Vec::with_capacity(usernames.len());
    for username in &usernames {
        let user = state
            .storage
            .get_user_by_username(username)
            .await?
            .ok_or_else(|| AppError::not_found("not_found", "no such user"))?;
        resolved.push(user);
    }

    // Self-DM is the one case where the "other" participant is meant
    // to be yourself. Anything else, drop yourself out of the list —
    // picking your own name alongside others in a group picker means
    // "everyone else", not "a chat that includes two copies of me".
    if resolved.len() == 1 && resolved[0].id == current.user.id {
        let channel = state
            .storage
            .get_or_create_dm(state.snowflake.next_id(), current.user.id, current.user.id)
            .await?;
        return Ok(Json(DmSummary { channel, participants: vec![current.user], pinned: false }));
    }

    let mut seen = HashSet::new();
    let others: Vec<User> =
        resolved.into_iter().filter(|u| u.id != current.user.id && seen.insert(u.id)).collect();
    if others.is_empty() {
        return Err(AppError::bad_request(
            "empty_participants",
            "pick at least one person to message",
        ));
    }
    if others.len() + 1 > MAX_GROUP_DM_PARTICIPANTS {
        return Err(AppError::bad_request(
            "too_many_participants",
            format!("group DMs are limited to {MAX_GROUP_DM_PARTICIPANTS} people"),
        ));
    }

    if others.len() == 1 {
        let Some(other) = others.into_iter().next() else {
            return Err(AppError::bad_request(
                "empty_participants",
                "pick at least one person to message",
            ));
        };
        let channel = state
            .storage
            .get_or_create_dm(state.snowflake.next_id(), current.user.id, other.id)
            .await?;
        // Deliberately opening it brings it back even if it was closed.
        state.storage.unhide_dm(current.user.id, channel.id).await?;
        return Ok(Json(DmSummary { channel, participants: vec![other], pinned: false }));
    }

    let other_ids = others.iter().map(|u| u.id).collect();
    let channel = state
        .storage
        .create_group_dm(state.snowflake.next_id(), current.user.id, other_ids)
        .await?;
    Ok(Json(DmSummary { channel, participants: others, pinned: false }))
}
