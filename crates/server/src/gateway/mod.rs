//! The `/gateway` WebSocket. Frame shape and op table are documented in
//! `docs/protocol.md`. This is a deliberately small first slice: Hello,
//! Identify, Ready, Heartbeat, and Dispatch of `MESSAGE_CREATE` work;
//! Resume (op 3) is not implemented yet — a client that sends it gets
//! `InvalidSession` and must re-Identify.

mod hub;

pub use hub::{DispatchEvent, GatewayHub};

use std::time::Duration;

use axum::extract::ws::{Message as WsMessage, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use futures_util::stream::{SelectAll, StreamExt};
use tokio::time::Instant;
use tokio_stream::wrappers::BroadcastStream;

use crate::api::current_user::CurrentUser;
use crate::api::permissions::{broadcast_room, require_channel_permission};
use crate::models::User;
use crate::state::SharedState;
use protocol::{Id, Permissions};

const HEARTBEAT_INTERVAL_MS: u64 = 30_000;
const IDENTIFY_TIMEOUT: Duration = Duration::from_secs(10);

pub async fn handler(
    current: CurrentUser,
    State(state): State<SharedState>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Response {
    if let Some(origin) = headers.get(axum::http::header::ORIGIN).and_then(|v| v.to_str().ok()) {
        if !origin_allowed(origin, &state.config.public_url) {
            return (StatusCode::FORBIDDEN, "origin not allowed").into_response();
        }
    }

    ws.on_upgrade(move |socket| handle_socket(socket, state, current.user))
}

/// A pure string-exact `Origin == PUBLIC_URL` check silently breaks the
/// gateway (and therefore every "live" feature: message edit/delete,
/// reactions, voice presence) the moment a browser reaches the app by
/// any address other than the one baked into `PUBLIC_URL` — e.g.
/// `PUBLIC_URL=http://localhost:8090` but the browser was pointed at
/// `http://127.0.0.1:8090` (common with SSH/VS Code port forwarding).
/// REST calls still succeed either way, so the visible symptom is
/// "I deleted/edited a message and it didn't happen" — it did, the
/// confirmation just never arrived over the (rejected) socket.
///
/// This widens the check to also accept the *other* loopback spellings
/// on the same scheme and port as `public_url` — never anything beyond
/// that, so a genuinely different (cross-site) origin is still
/// rejected exactly as before.
fn origin_allowed(origin: &str, public_url: &str) -> bool {
    let origin = origin.trim_end_matches('/');
    let public_url = public_url.trim_end_matches('/');
    if origin == public_url {
        return true;
    }
    let Some((o_scheme, o_host, o_port)) = parse_origin(origin) else { return false };
    let Some((p_scheme, p_host, p_port)) = parse_origin(public_url) else { return false };
    if o_scheme != p_scheme || o_port != p_port {
        return false;
    }
    const LOOPBACK_HOSTS: &[&str] = &["localhost", "127.0.0.1", "[::1]", "::1"];
    LOOPBACK_HOSTS.contains(&o_host) && LOOPBACK_HOSTS.contains(&p_host)
}

/// Splits `scheme://host[:port]` (the only shape an `Origin` header or
/// `PUBLIC_URL` takes — no path/query) into its three parts. Handles a
/// bracketed IPv6 host (`[::1]:8090`) by splitting on the port only
/// after the closing bracket.
fn parse_origin(value: &str) -> Option<(&str, &str, &str)> {
    let (scheme, rest) = value.split_once("://")?;
    let (host, port) = match rest.find(']') {
        Some(bracket_end) => {
            let host = &rest[..=bracket_end];
            let port = rest[bracket_end + 1..].strip_prefix(':').unwrap_or("");
            (host, port)
        }
        None => rest.rsplit_once(':').unwrap_or((rest, "")),
    };
    Some((scheme, host, port))
}

async fn send_frame(
    socket: &mut WebSocket,
    op: u8,
    d: serde_json::Value,
    s: Option<u64>,
    t: Option<&str>,
) -> Result<(), axum::Error> {
    let frame = serde_json::json!({ "op": op, "d": d, "s": s, "t": t });
    socket.send(WsMessage::Text(frame.to_string())).await
}

fn frame_op(text: &str) -> Option<u8> {
    let value: serde_json::Value = serde_json::from_str(text).ok()?;
    value.get("op")?.as_u64().map(|n| n as u8)
}

async fn handle_socket(mut socket: WebSocket, state: SharedState, user: User) {
    let hello = serde_json::json!({ "heartbeat_interval_ms": HEARTBEAT_INTERVAL_MS });
    if send_frame(&mut socket, 10, hello, None, None).await.is_err() {
        return;
    }

    let identified = tokio::select! {
        msg = socket.recv() => matches!(msg, Some(Ok(WsMessage::Text(text))) if frame_op(&text) == Some(2)),
        _ = tokio::time::sleep(IDENTIFY_TIMEOUT) => false,
    };
    if !identified {
        let _ = socket.close().await;
        return;
    }

    let guilds = match state.storage.list_guilds_for_user(user.id).await {
        Ok(guilds) => guilds,
        Err(_) => return,
    };
    let dms = state.storage.list_dms_for_user(user.id).await.unwrap_or_default();

    let mut guild_payloads = Vec::with_capacity(guilds.len());
    for guild in &guilds {
        let channels = state.storage.list_channels_for_guild(guild.id).await.unwrap_or_default();
        guild_payloads
            .push(serde_json::json!({ "id": guild.id, "name": guild.name, "channels": channels }));
    }
    let dm_payloads: Vec<_> = dms
        .iter()
        .map(|d| serde_json::json!({ "channel_id": d.channel.id, "users": d.participants }))
        .collect();

    // A freshly-connecting client needs a snapshot of who's already
    // online, the same way `voice_participants` snapshots who's
    // already in a voice channel — everything from here on is only
    // *changes*, via `PresenceUpdate`. Instance-wide rather than
    // scoped to this user's own guilds/DMs: at this app's scale
    // (self-hosted, everyone already knows everyone exists via the
    // invite flow) that's not a meaningful privacy concern, and it
    // avoids an extra per-guild member-list query here.
    let online_user_ids = state.gateway.online_user_ids();

    let mut seq: u64 = 1;
    let ready = serde_json::json!({
        "user": user,
        "guilds": guild_payloads,
        "dms": dm_payloads,
        "online_user_ids": online_user_ids,
    });
    if send_frame(&mut socket, 0, ready, Some(seq), Some("READY")).await.is_err() {
        return;
    }

    // Only announce "online" on this user's *first* live connection —
    // a second tab/device shouldn't re-announce someone who was
    // already online. Broadcast to every guild and DM room they're
    // in, the same fan-out a message would get.
    if state.gateway.mark_online(user.id) {
        for guild in &guilds {
            state.gateway.publish(
                guild.id,
                DispatchEvent::PresenceUpdate { user_id: user.id, online: true },
            );
        }
        for dm in &dms {
            state.gateway.publish(
                dm.channel.id,
                DispatchEvent::PresenceUpdate { user_id: user.id, online: true },
            );
        }
    }

    // One broadcast receiver per guild plus one per DM channel the user
    // is in, merged into a single stream. Guild channels fan out under
    // their guild's id; DM channels (no guild) fan out under their own
    // channel id — see api::messages::create. `subscribed_rooms` tracks
    // every room id already covered so the dynamic-resubscribe path
    // below (`new_dm_channel_id`) can't double-subscribe: a DM channel
    // from an old, since-ended friendship isn't deleted (chat history
    // stays), so re-befriending that same person hands back the exact
    // channel id this connection may *already* be subscribed to — a
    // second, redundant subscription would otherwise deliver every
    // future message in it twice for the rest of this connection's life.
    let mut subscribed_rooms: std::collections::HashSet<Id> = std::collections::HashSet::new();
    let mut events: SelectAll<BroadcastStream<DispatchEvent>> = SelectAll::new();
    for guild in &guilds {
        subscribed_rooms.insert(guild.id);
        events.push(BroadcastStream::new(state.gateway.subscribe(guild.id)));
    }
    for dm in &dms {
        subscribed_rooms.insert(dm.channel.id);
        events.push(BroadcastStream::new(state.gateway.subscribe(dm.channel.id)));
    }
    // This connection's own personal room (see `GatewayHub::subscribe`)
    // — for events with no shared guild/DM to broadcast through yet,
    // like a friend request landing, or a brand new DM channel (a
    // request just got accepted, or someone added you to a group) that
    // this connection wasn't already subscribed to.
    subscribed_rooms.insert(user.id);
    events.push(BroadcastStream::new(state.gateway.subscribe(user.id)));

    let mut last_heartbeat = Instant::now();
    let heartbeat_timeout = Duration::from_millis(HEARTBEAT_INTERVAL_MS * 2);
    let mut check_interval = tokio::time::interval(Duration::from_secs(5));

    // Registered once here (not per-voice-join) so the SFU can push a
    // fresh offer at any time — e.g. when someone else joins the same
    // voice channel and a new track needs forwarding to this client.
    //
    // A user can have several connections (tabs, devices, a page that has
    // reconnected before the old connection timed out); `conn_id` is how the
    // voice side tells them apart, so a call's messages reach the one that
    // owns it and only its departure ends the call (see `voice::signals`).
    let (conn_id, mut voice_rx) = state.voice.register(user.id);

    loop {
        tokio::select! {
            incoming = socket.recv() => {
                match incoming {
                    Some(Ok(WsMessage::Text(text))) => {
                        match frame_op(&text) {
                            Some(1) => {
                                last_heartbeat = Instant::now();
                                if send_frame(&mut socket, 11, serde_json::Value::Null, None, None).await.is_err() {
                                    break;
                                }
                            }
                            Some(4) => {
                                handle_voice_state_update(&state, user.id, conn_id, &text)
                                    .await
                            }
                            // Resume isn't implemented yet; tell the client to re-Identify.
                            Some(3)
                                if send_frame(&mut socket, 9, serde_json::Value::Null, None, None)
                                    .await
                                    .is_err() =>
                            {
                                break;
                            }
                            _ => {}
                        }
                    }
                    Some(Ok(WsMessage::Close(_))) | None => break,
                    Some(Err(_)) => break,
                    _ => {}
                }
            }
            event = events.next(), if !events.is_empty() => {
                match event {
                    Some(Ok(event)) => {
                        // A DM channel this connection wasn't already
                        // subscribed to (a friend request just got
                        // accepted, or this user was added to a group)
                        // — start receiving its future messages live
                        // too, not just this one announcement.
                        // `subscribed_rooms.insert` both checks and
                        // records in one step — re-befriending someone
                        // hands back the same (never-deleted) channel
                        // id from the old friendship, which this
                        // connection may already be subscribed to; a
                        // second subscription would double-deliver
                        // every future message in it.
                        if let Some(channel_id) = event.new_dm_channel_id() {
                            if subscribed_rooms.insert(channel_id) {
                                events.push(BroadcastStream::new(state.gateway.subscribe(channel_id)));
                            }
                        }
                        seq += 1;
                        let ok = send_frame(&mut socket, 0, event.payload(), Some(seq), Some(event.name())).await;
                        if ok.is_err() {
                            break;
                        }
                    }
                    // A slow consumer missed some events (broadcast channel
                    // lagged). Nothing to replay without Resume — just keep going.
                    Some(Err(_)) => {}
                    None => break,
                }
            }
            signal = voice_rx.recv() => {
                let Some(signal) = signal else { continue };
                seq += 1;
                let d = serde_json::json!({ "channel_id": signal.channel_id, "sdp": signal.sdp });
                if send_frame(&mut socket, 0, d, Some(seq), Some("VOICE_SERVER_UPDATE")).await.is_err() {
                    break;
                }
            }
            _ = check_interval.tick() => {
                if last_heartbeat.elapsed() > heartbeat_timeout {
                    break;
                }
            }
        }
    }

    // The counterpart to the "first connection" broadcast above — only
    // announce "offline" once this was the user's *last* live
    // connection (they could still have another tab/device open).
    if state.gateway.mark_offline(user.id) {
        for guild in &guilds {
            state.gateway.publish(
                guild.id,
                DispatchEvent::PresenceUpdate { user_id: user.id, online: false },
            );
        }
        for dm in &dms {
            state.gateway.publish(
                dm.channel.id,
                DispatchEvent::PresenceUpdate { user_id: user.id, online: false },
            );
        }
    }

    // `unregister` sends `VoiceCommand::Leave` for this user when this was
    // the connection their call belongs to (or their last one), so the SFU
    // side is torn down whether or not this socket ever sent the explicit
    // "leave voice" op. A stale connection closing while the call runs on
    // another one leaves it alone, and says nothing about the call either.
    if state.voice.unregister(user.id, conn_id) {
        if let Some((channel_id, room)) = state.gateway.voice_state_of(user.id) {
            state.gateway.set_voice_state(user.id, None);
            state.gateway.publish(
                room,
                DispatchEvent::VoiceStateUpdate { channel_id, user_id: user.id, connected: false },
            );
        }
    }
}

/// Parses and applies an incoming op 4 (VoiceStateUpdate) frame:
/// `{ channel_id: string, sdp: {type, sdp} }` to join/renegotiate, or
/// `{ channel_id: null }` to leave. Errors are logged and otherwise
/// ignored — a malformed frame just doesn't change voice state.
///
/// Also enforces `Permissions::CONNECT` on the target channel (this
/// was previously unchecked — any authenticated user could join any
/// voice channel by id) and broadcasts `VOICE_STATE_UPDATE` to the
/// channel's broadcast room (its guild, or the DM channel itself —
/// see `permissions::broadcast_room`) so others can keep a live
/// participant list. DM channels work the same way guild channels do
/// here: `require_channel_permission`'s DM branch just checks
/// participation regardless of which permission bit was asked for, so
/// a "call" is really just a voice join against the DM's own channel
/// id, with no separate ringing/accept flow.
async fn handle_voice_state_update(
    state: &SharedState,
    user_id: Id,
    conn_id: crate::voice::ConnId,
    text: &str,
) {
    #[derive(serde::Deserialize)]
    struct VoiceStateUpdate {
        channel_id: Option<String>,
        sdp: Option<serde_json::Value>,
        /// `{ mid: "camera" | "screen" }` for whichever of *this*
        /// offer's own video m-lines are a camera vs a screen share —
        /// the client already knows this (it's the one that created
        /// the tracks), the server has no other way to tell them apart
        /// (there's nothing in plain SDP for it). Only ever set on an
        /// "offer"; unrecognized values are just dropped, not errors.
        #[serde(default)]
        video_purposes: std::collections::HashMap<String, String>,
        /// An offer that changes a connection which stays up (camera or
        /// screen share turned on or off), not a fresh join.
        #[serde(default)]
        renegotiate: bool,
    }
    #[derive(serde::Deserialize)]
    struct Frame {
        d: VoiceStateUpdate,
    }

    let Ok(frame) = serde_json::from_str::<Frame>(text) else { return };

    let Some(channel_id) = frame.d.channel_id else {
        // Only the connection the call belongs to can end it: a stale tab
        // sending "leave" must not hang up a call running on another device.
        if !state.voice.leave(conn_id, user_id) {
            return;
        }
        let was_in = state.gateway.voice_state_of(user_id);
        state.gateway.set_voice_state(user_id, None);
        if let Some((left_channel_id, room)) = was_in {
            state.gateway.publish(
                room,
                DispatchEvent::VoiceStateUpdate {
                    channel_id: left_channel_id,
                    user_id,
                    connected: false,
                },
            );
        }
        return;
    };
    let Ok(channel_id) = channel_id.parse::<Id>() else { return };
    let Some(sdp) = frame.d.sdp else { return };

    let sdp_type = sdp.get("type").and_then(|v| v.as_str()).unwrap_or_default();
    match sdp_type {
        "offer" => {
            let Ok(channel) =
                require_channel_permission(state, user_id, channel_id, Permissions::CONNECT).await
            else {
                return;
            };
            let room = broadcast_room(&channel);
            let Ok(offer) = serde_json::from_value(sdp) else { return };

            let renegotiate = frame.d.renegotiate;
            if !state.voice.offer(
                conn_id,
                user_id,
                channel_id,
                room,
                offer,
                frame.d.video_purposes,
                renegotiate,
            ) {
                // A renegotiation from a connection that does not own the call.
                return;
            }
            let previous = state.gateway.voice_state_of(user_id);
            if renegotiate && previous == Some((channel_id, room)) {
                // Same call, same connection: nobody needs to hear about it.
                return;
            }

            state.gateway.set_voice_state(user_id, Some((channel_id, room)));
            if let Some((old_channel_id, old_room)) = previous {
                if old_channel_id != channel_id {
                    state.gateway.publish(
                        old_room,
                        DispatchEvent::VoiceStateUpdate {
                            channel_id: old_channel_id,
                            user_id,
                            connected: false,
                        },
                    );
                }
            }
            state.gateway.publish(
                room,
                DispatchEvent::VoiceStateUpdate { channel_id, user_id, connected: true },
            );
        }
        "answer" => {
            if let Ok(answer) = serde_json::from_value(sdp) {
                state.voice.answer(conn_id, user_id, answer);
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod origin_tests {
    use super::origin_allowed;

    #[test]
    fn exact_match_is_allowed() {
        assert!(origin_allowed("http://localhost:8090", "http://localhost:8090"));
    }

    #[test]
    fn trailing_slash_is_ignored() {
        assert!(origin_allowed("http://localhost:8090/", "http://localhost:8090"));
    }

    #[test]
    fn loopback_ip_is_allowed_when_public_url_says_localhost() {
        assert!(origin_allowed("http://127.0.0.1:8090", "http://localhost:8090"));
    }

    #[test]
    fn localhost_is_allowed_when_public_url_says_loopback_ip() {
        assert!(origin_allowed("http://localhost:8090", "http://127.0.0.1:8090"));
    }

    #[test]
    fn ipv6_loopback_is_allowed() {
        assert!(origin_allowed("http://[::1]:8090", "http://localhost:8090"));
    }

    #[test]
    fn mismatched_port_is_rejected() {
        assert!(!origin_allowed("http://127.0.0.1:9999", "http://localhost:8090"));
    }

    #[test]
    fn mismatched_scheme_is_rejected() {
        assert!(!origin_allowed("https://127.0.0.1:8090", "http://localhost:8090"));
    }

    #[test]
    fn unrelated_origin_is_rejected() {
        assert!(!origin_allowed("https://evil.example", "http://localhost:8090"));
    }
}
