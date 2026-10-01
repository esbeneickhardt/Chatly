//! The voice SFU (`PLAN.md` Phase 4). Relays audio *and* video (camera
//! or screen share — both are just another video `m=` line to str0m,
//! no distinction needed at this layer) with real keyframe handling
//! (no simulcast — every track is a single quality layer, so there's
//! no per-`rid` layer selection to do). Signaling rides the existing
//! `/gateway` WebSocket (op 4) instead of a WebRTC data channel, which
//! is the one real deviation from the str0m upstream `chat.rs` example
//! this module's structure — including the keyframe-request relay
//! pattern — is closely modeled on (verified against the real crate
//! source before writing this, not guessed).
//!
//! str0m is sans-IO: nothing here happens unless this task's loop
//! drives it. One UDP socket is shared by every voice connection,
//! demultiplexed via each `Rtc`'s own `accepts()` check (ICE
//! ufrag/credentials), matching how a real SFU multiplexes many peers
//! on a single port.

mod client;
mod sfu;
mod signals;

use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
use std::sync::{Arc, Mutex as StdMutex, Weak};
use std::time::{Duration, Instant};

use anyhow::Context;
use protocol::Id;
use serde::Serialize;
use socket2::{Domain, Protocol, Socket, Type};
use str0m::change::{SdpAnswer, SdpOffer, SdpPendingOffer};
use str0m::media::{Direction, KeyframeRequest, KeyframeRequestKind, MediaData, MediaKind, Mid};
use str0m::net::{Protocol as NetProtocol, Receive};
use str0m::{Candidate, Event, IceConnectionState, Input, Output, Rtc};
use tokio::net::UdpSocket;
use tokio::sync::mpsc;

use crate::gateway::{DispatchEvent, GatewayHub};
pub use signals::ConnId;
use signals::SignalRegistry;

/// Requested kernel buffer size for the shared voice UDP socket (each of
/// send and receive) — see `spawn`.
const UDP_SOCKET_BUFFER_BYTES: usize = 4 * 1024 * 1024;

/// A signaling message the SFU needs delivered to one specific user's
/// gateway connection (an SDP answer to their offer, or a fresh
/// server-initiated offer when a new remote track needs adding).
pub struct VoiceSignal {
    pub channel_id: Id,
    /// Already `{"type": "offer"|"answer", "sdp": "..."}` — str0m's
    /// `SdpOffer`/`SdpAnswer` serialize to exactly the shape a
    /// browser's `RTCSessionDescriptionInit` expects, so this can be
    /// forwarded to the client verbatim.
    pub sdp: serde_json::Value,
}

/// Which real-world source a video `m=` line comes from. str0m/WebRTC
/// has no concept of this — a camera and a screen share are both just
/// a video track — so the client tags each of its own outgoing video
/// mids and the tag rides along in the signaling frame (see
/// `VoiceCommand::Offer::video_purposes`). Used only to pick a
/// `stream_id` (see `negotiate_if_needed`) that lets every remote peer
/// tell a user's camera and screen share apart client-side.
#[derive(Clone, Copy, PartialEq, Eq)]
enum VideoPurpose {
    Camera,
    Screen,
}

impl VideoPurpose {
    fn as_str(self) -> &'static str {
        match self {
            VideoPurpose::Camera => "camera",
            VideoPurpose::Screen => "screen",
        }
    }
}

enum VoiceCommand {
    /// A client's SDP offer: the initial join, or — with `renegotiate` —
    /// a change (camera or screen share on or off) to a connection that
    /// stays up.
    Offer {
        user_id: Id,
        channel_id: Id,
        /// The gateway room this channel broadcasts presence/messages
        /// through (see `api::permissions::broadcast_room`) — a guild's
        /// own id, or a DM channel's own id. Carried alongside
        /// `channel_id` purely so a connection this SFU itself times
        /// out (see `ICE_DISCONNECT_GRACE`) can publish that departure
        /// to the right room without needing to look anything up; the
        /// SFU has no other way to resolve a channel back to its guild.
        room_id: Id,
        offer: SdpOffer,
        /// `{ mid: "camera" | "screen" }` for whichever of this
        /// offer's own video m-lines are which, as raw strings off the
        /// wire — the client is the only side that knows (it created
        /// the tracks). Parsed (and unrecognized values/audio mids
        /// dropped) when the offer is actually applied.
        video_purposes: HashMap<String, String>,
        /// Apply this offer to the client's live connection instead of
        /// replacing it, so nothing else about the call is interrupted.
        renegotiate: bool,
    },
    /// A client's answer to a server-initiated offer (new remote track).
    Answer {
        user_id: Id,
        answer: SdpAnswer,
    },
    Leave {
        user_id: Id,
    },
}

/// Handle used by the rest of the server (gateway connections, mainly)
/// to talk to the voice SFU task.
#[derive(Clone)]
pub struct VoiceHub {
    commands: mpsc::UnboundedSender<VoiceCommand>,
    signal_registry: Arc<StdMutex<SignalRegistry>>,
}

impl VoiceHub {
    /// Registers one of `user_id`'s gateway connections to receive voice
    /// signaling pushed from the SFU while it owns the user's call. Call
    /// once per connection, right after Identify; the returned receiver is
    /// what the gateway loop selects on alongside the socket and heartbeat.
    pub fn register(&self, user_id: Id) -> (ConnId, mpsc::UnboundedReceiver<VoiceSignal>) {
        crate::sync::lock(&self.signal_registry).register(user_id)
    }

    /// The connection closed. Returns whether the user's call ended with it
    /// (it owned the call, or it was their last connection); a stale
    /// connection closing leaves a call running elsewhere alone.
    pub fn unregister(&self, user_id: Id, conn: ConnId) -> bool {
        let ends_call = crate::sync::lock(&self.signal_registry).unregister(user_id, conn);
        if ends_call {
            let _ = self.commands.send(VoiceCommand::Leave { user_id });
        }
        ends_call
    }

    /// A fresh offer makes `conn` the owner of the user's call (taking it over
    /// from another device if need be). A renegotiation is only accepted from
    /// the connection that owns the call. False if it was ignored.
    #[allow(clippy::too_many_arguments)]
    pub fn offer(
        &self,
        conn: ConnId,
        user_id: Id,
        channel_id: Id,
        room_id: Id,
        offer: SdpOffer,
        video_purposes: HashMap<String, String>,
        renegotiate: bool,
    ) -> bool {
        {
            let mut registry = crate::sync::lock(&self.signal_registry);
            if renegotiate {
                if !registry.owns(user_id, conn) {
                    return false;
                }
            } else {
                registry.claim(user_id, conn);
            }
        }
        let _ = self.commands.send(VoiceCommand::Offer {
            user_id,
            channel_id,
            room_id,
            offer,
            video_purposes,
            renegotiate,
        });
        true
    }

    /// The owner's answer to a server-initiated offer; ignored from anyone else.
    pub fn answer(&self, conn: ConnId, user_id: Id, answer: SdpAnswer) {
        if crate::sync::lock(&self.signal_registry).owns(user_id, conn) {
            let _ = self.commands.send(VoiceCommand::Answer { user_id, answer });
        }
    }

    /// `conn` leaves the call. False (and nothing happens) if it does not own
    /// it: a stale tab must not hang up a call running on another device.
    pub fn leave(&self, conn: ConnId, user_id: Id) -> bool {
        if !crate::sync::lock(&self.signal_registry).release(user_id, conn) {
            return false;
        }
        let _ = self.commands.send(VoiceCommand::Leave { user_id });
        true
    }
}

fn send_signal(
    registry: &StdMutex<SignalRegistry>,
    user_id: Id,
    channel_id: Id,
    sdp: &impl Serialize,
) {
    let Ok(value) = serde_json::to_value(sdp) else { return };
    crate::sync::lock(registry).send(user_id, VoiceSignal { channel_id, sdp: value });
}

/// Guesses a real (non-wildcard) local IP to advertise as a host ICE
/// candidate, by asking the OS which interface it would use to reach
/// an arbitrary public address — a UDP `connect()` never actually
/// sends a packet, so this works offline too.
fn guess_host_ip() -> IpAddr {
    std::net::UdpSocket::bind("0.0.0.0:0")
        .and_then(|probe| {
            probe.connect("8.8.8.8:80")?;
            probe.local_addr()
        })
        .map(|addr| addr.ip())
        .unwrap_or(IpAddr::V4(std::net::Ipv4Addr::LOCALHOST))
}

/// Binds the voice UDP socket and spawns the SFU driver task. Call once
/// at startup. `gateway` lets the SFU publish `VOICE_STATE_UPDATE` (and
/// clear presence) itself the moment it times out a dead connection
/// (see `ICE_DISCONNECT_GRACE`) — without it, the only thing that ever
/// noticed that departure was the *gateway* connection's own, much
/// coarser heartbeat timeout (up to a minute), which left a participant
/// whose WebRTC media had already silently died still showing as
/// "in the call" for everyone else for that entire window.
pub fn spawn(
    voice_port: u16,
    public_ip: Option<IpAddr>,
    gateway: Arc<GatewayHub>,
) -> anyhow::Result<VoiceHub> {
    str0m::crypto::from_feature_flags().install_process_default();

    let raw_socket = Socket::new(Domain::IPV4, Type::DGRAM, Some(Protocol::UDP))
        .context("voice: create socket")?;
    // Every participant's media shares this one socket, and a screen
    // share's keyframe alone is a burst of a hundred-odd packets that
    // arrive back to back. The kernel default (~200 KiB) is small
    // enough that a burst plus a few other senders overflows it —
    // dropped packets that then look like network loss, trigger
    // keyframe requests, and make the next burst (another keyframe)
    // even bigger. The kernel silently clamps the request to
    // `net.core.{r,w}mem_max`, so log what was actually granted.
    let _ = raw_socket.set_recv_buffer_size(UDP_SOCKET_BUFFER_BYTES);
    let _ = raw_socket.set_send_buffer_size(UDP_SOCKET_BUFFER_BYTES);
    raw_socket.bind(&SocketAddr::from(([0, 0, 0, 0], voice_port)).into())?;
    raw_socket.set_nonblocking(true)?;
    tracing::info!(
        recv_buffer = raw_socket.recv_buffer_size().ok(),
        send_buffer = raw_socket.send_buffer_size().ok(),
        "voice: UDP socket buffers"
    );
    let socket = UdpSocket::from_std(raw_socket.into())?;

    let host_ip = guess_host_ip();
    if public_ip.is_none() {
        tracing::warn!(
            "VOICE_PUBLIC_IP not set — voice will only work for peers that can reach {host_ip} \
             directly (same host or LAN). Set VOICE_PUBLIC_IP for internet-facing use."
        );
    }

    let (tx, rx) = mpsc::unbounded_channel();
    let signal_registry = Arc::new(StdMutex::new(SignalRegistry::default()));
    let hub = VoiceHub { commands: tx, signal_registry: signal_registry.clone() };

    tokio::spawn(sfu::run(socket, host_ip, public_ip, voice_port, rx, signal_registry, gateway));

    Ok(hub)
}
