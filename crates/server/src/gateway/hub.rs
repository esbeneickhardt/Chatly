use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

use protocol::Id;
use serde::Serialize;
use tokio::sync::broadcast;

use crate::models::{DmChannelSummary, FriendRequest, Message};

/// A gateway event, ready to become the `d`/`t` of a Dispatch frame.
#[derive(Debug, Clone)]
pub enum DispatchEvent {
    MessageCreate(Message),
    /// Reused for any in-place message change — reactions and edits.
    /// Carries the full, current message rather than a diff.
    MessageUpdate(Message),
    /// A message was deleted (by its author, or by someone holding
    /// `MANAGE_MESSAGES` — a moderator, a server admin, or the owner). Just enough for clients to remove it locally —
    /// no point re-sending a message that no longer exists.
    MessageDelete {
        channel_id: Id,
        message_id: Id,
    },
    /// Someone joined or left a voice channel in this guild. Not a
    /// full voice-state snapshot (no mute/deafen flags yet — see
    /// PLAN.md 4.2) — just enough for clients to keep a live
    /// participant list per channel.
    VoiceStateUpdate {
        channel_id: Id,
        user_id: Id,
        connected: bool,
    },
    /// Someone sent *you* a friend request — published to the
    /// recipient's own personal room (see `GatewayHub::publish`'s
    /// doc comment on reusing user ids as rooms).
    FriendRequestCreate(FriendRequest),
    /// A new DM channel now includes you — either a friend request
    /// you sent/received just got accepted (a fresh 1:1 exists), or
    /// someone added you to an existing conversation, growing it into
    /// a group. Published to your own personal room; the gateway loop
    /// also dynamically subscribes your connection to the new
    /// channel's own room right when this event is handled, so
    /// messages in it start arriving live without reconnecting.
    DmChannelCreate(DmChannelSummary),
    /// Someone left a group DM (see `api::dms::leave`) — published to
    /// the channel's own room so everyone still in it drops that
    /// person from their local participant list live, without needing
    /// a full refetch. Not sent to the leaver themselves; they already
    /// know from their own request's response.
    DmParticipantLeave {
        channel_id: Id,
        user_id: Id,
    },
    /// Someone turned down an incoming call in this DM (see
    /// `api::dms::decline_call`) — so the caller can show "Declined"
    /// instead of ringing on until it times out.
    DmCallDeclined {
        channel_id: Id,
        user_id: Id,
    },
    /// A call in a 1:1 conversation moved into a new group chat because
    /// `by` added someone to it (see `api::dms::add_participant`). Sent to
    /// each of the two people who were in that conversation, so whoever is
    /// on the call follows it together: three people in one call, not one
    /// person alone in the group and another left behind in the 1:1.
    DmCallMoved {
        from_channel_id: Id,
        to_channel_id: Id,
        by: Id,
    },
    /// Someone with a DM or a guild in common with you just connected
    /// (their *first* live gateway connection, not e.g. a second tab)
    /// or fully disconnected (their *last* one closed) — see
    /// `GatewayHub::mark_online`/`mark_offline`. Published to every
    /// guild and DM room they're part of, same fan-out as a message.
    PresenceUpdate {
        user_id: Id,
        online: bool,
    },
}

impl DispatchEvent {
    pub fn name(&self) -> &'static str {
        match self {
            DispatchEvent::MessageCreate(_) => "MESSAGE_CREATE",
            DispatchEvent::MessageUpdate(_) => "MESSAGE_UPDATE",
            DispatchEvent::MessageDelete { .. } => "MESSAGE_DELETE",
            DispatchEvent::VoiceStateUpdate { .. } => "VOICE_STATE_UPDATE",
            DispatchEvent::FriendRequestCreate(_) => "FRIEND_REQUEST_CREATE",
            DispatchEvent::DmChannelCreate(_) => "DM_CHANNEL_CREATE",
            DispatchEvent::DmParticipantLeave { .. } => "DM_PARTICIPANT_LEAVE",
            DispatchEvent::DmCallDeclined { .. } => "DM_CALL_DECLINED",
            DispatchEvent::DmCallMoved { .. } => "DM_CALL_MOVED",
            DispatchEvent::PresenceUpdate { .. } => "PRESENCE_UPDATE",
        }
    }

    /// The DM channel a freshly-created conversation lives in, if
    /// that's what this event is — used by the gateway loop to know
    /// which room to dynamically subscribe the connection to.
    pub fn new_dm_channel_id(&self) -> Option<Id> {
        match self {
            DispatchEvent::DmChannelCreate(dm) => Some(dm.channel.id),
            _ => None,
        }
    }

    pub fn payload(&self) -> serde_json::Value {
        #[derive(Serialize)]
        #[serde(untagged)]
        enum Payload<'a> {
            Message(&'a Message),
            MessageDelete { channel_id: Id, message_id: Id },
            VoiceState { channel_id: Id, user_id: Id, connected: bool },
            FriendRequest(&'a FriendRequest),
            DmChannel(&'a DmChannelSummary),
            DmParticipantLeave { channel_id: Id, user_id: Id },
            DmCallDeclined { channel_id: Id, user_id: Id },
            DmCallMoved { from_channel_id: Id, to_channel_id: Id, by: Id },
            Presence { user_id: Id, online: bool },
        }
        let payload = match self {
            DispatchEvent::MessageCreate(msg) | DispatchEvent::MessageUpdate(msg) => {
                Payload::Message(msg)
            }
            DispatchEvent::MessageDelete { channel_id, message_id } => {
                Payload::MessageDelete { channel_id: *channel_id, message_id: *message_id }
            }
            DispatchEvent::VoiceStateUpdate { channel_id, user_id, connected } => {
                Payload::VoiceState {
                    channel_id: *channel_id,
                    user_id: *user_id,
                    connected: *connected,
                }
            }
            DispatchEvent::FriendRequestCreate(request) => Payload::FriendRequest(request),
            DispatchEvent::DmChannelCreate(dm) => Payload::DmChannel(dm),
            DispatchEvent::DmParticipantLeave { channel_id, user_id } => {
                Payload::DmParticipantLeave { channel_id: *channel_id, user_id: *user_id }
            }
            DispatchEvent::DmCallDeclined { channel_id, user_id } => {
                Payload::DmCallDeclined { channel_id: *channel_id, user_id: *user_id }
            }
            DispatchEvent::DmCallMoved { from_channel_id, to_channel_id, by } => {
                Payload::DmCallMoved {
                    from_channel_id: *from_channel_id,
                    to_channel_id: *to_channel_id,
                    by: *by,
                }
            }
            DispatchEvent::PresenceUpdate { user_id, online } => {
                Payload::Presence { user_id: *user_id, online: *online }
            }
        };
        serde_json::to_value(payload).expect("dispatch payloads always serialize")
    }
}

/// Per-guild event fan-out. At this scale (50-100 users, one guild in
/// this MVP) a `HashMap<GuildId, Sender>` behind a lock is exactly the
/// "nothing fancier" the plan calls for — see `PLAN.md` 2.3.
pub struct GatewayHub {
    channels: Mutex<HashMap<Id, broadcast::Sender<DispatchEvent>>>,
    /// `user_id -> (voice_channel_id, guild_id)` for every currently
    /// connected voice participant, instance-wide. This lives here
    /// (not inside the SFU/`VoiceHub`) because it's presence
    /// bookkeeping, not media state — and a freshly-connecting client
    /// needs a way to snapshot "who's already in which voice channel"
    /// that doesn't depend on having seen the `VOICE_STATE_UPDATE`
    /// events that got them there.
    voice_presence: Mutex<HashMap<Id, (Id, Id)>>,
    /// Ref-counted per-user connection count — a user can have several
    /// gateway connections open at once (multiple tabs/devices), and
    /// they should only show as offline once *all* of them are gone,
    /// not the first one that closes.
    online_counts: Mutex<HashMap<Id, u32>>,
    /// The connections whose page someone is looking at and using right now
    /// (gateway op 12), per user. While any is, Web Push leaves them alone.
    active: Mutex<HashMap<Id, HashSet<u64>>>,
}

const CHANNEL_CAPACITY: usize = 256;

impl GatewayHub {
    pub fn new() -> Self {
        GatewayHub {
            channels: Mutex::new(HashMap::new()),
            voice_presence: Mutex::new(HashMap::new()),
            online_counts: Mutex::new(HashMap::new()),
            active: Mutex::new(HashMap::new()),
        }
    }

    fn sender(&self, room_id: Id) -> broadcast::Sender<DispatchEvent> {
        let mut channels = crate::sync::lock(&self.channels);
        channels.entry(room_id).or_insert_with(|| broadcast::channel(CHANNEL_CAPACITY).0).clone()
    }

    /// `room_id` is usually a guild or DM channel id, but a user's own
    /// id works just as well as a "room" only they subscribe to (see
    /// `gateway::mod::handle_socket`, which subscribes every
    /// connection to its own user id alongside its guilds/DMs) — for
    /// events like a friend request that have no shared guild/channel
    /// to broadcast through yet. Safe to mix: every id here comes from
    /// the same global snowflake generator (`SnowflakeGenerator`), so
    /// a user id can never collide with a guild/channel id.
    pub fn subscribe(&self, room_id: Id) -> broadcast::Receiver<DispatchEvent> {
        self.sender(room_id).subscribe()
    }

    /// Publishes an event to everyone currently subscribed to `room_id`
    /// (a guild, a DM channel, or a specific user's own room — see
    /// `subscribe`). A room with no live connections simply has no
    /// subscribers yet — that's not an error.
    pub fn publish(&self, room_id: Id, event: DispatchEvent) {
        let _ = self.sender(room_id).send(event);
    }

    /// Records that `user_id` joined `channel_id` (in `guild_id`), or
    /// clears their entry entirely when `state` is `None` (left, or
    /// their connection dropped).
    pub fn set_voice_state(&self, user_id: Id, state: Option<(Id, Id)>) {
        let mut presence = crate::sync::lock(&self.voice_presence);
        match state {
            Some(s) => {
                presence.insert(user_id, s);
            }
            None => {
                presence.remove(&user_id);
            }
        }
    }

    /// The `(channel_id, room_id)` `user_id` is on a call in, if any.
    pub fn voice_state_of(&self, user_id: Id) -> Option<(Id, Id)> {
        crate::sync::lock(&self.voice_presence).get(&user_id).copied()
    }

    /// `(channel_id, user_id)` for every voice participant currently
    /// connected somewhere in `guild_id` — a point-in-time snapshot for
    /// a client that just connected (or switched guilds) and needs to
    /// know who's already there before any live update arrives.
    pub fn voice_participants(&self, guild_id: Id) -> Vec<(Id, Id)> {
        let presence = crate::sync::lock(&self.voice_presence);
        presence
            .iter()
            .filter(|(_, (_, g))| *g == guild_id)
            .map(|(user_id, (channel_id, _))| (*channel_id, *user_id))
            .collect()
    }

    /// Records one more live gateway connection for `user_id`. Returns
    /// `true` only when this was their *first* — i.e. they were
    /// offline a moment ago and are now online — so the caller knows
    /// whether a `PresenceUpdate` is actually worth publishing.
    pub fn mark_online(&self, user_id: Id) -> bool {
        let mut counts = crate::sync::lock(&self.online_counts);
        let count = counts.entry(user_id).or_insert(0);
        *count += 1;
        *count == 1
    }

    /// The counterpart to `mark_online`, called once per connection as
    /// it closes. Returns `true` only when that was their *last* live
    /// connection — i.e. they're now fully offline.
    pub fn mark_offline(&self, user_id: Id) -> bool {
        let mut counts = crate::sync::lock(&self.online_counts);
        match counts.get_mut(&user_id) {
            Some(count) if *count > 1 => {
                *count -= 1;
                false
            }
            Some(_) => {
                counts.remove(&user_id);
                true
            }
            None => false,
        }
    }

    /// Records whether connection `conn` of `user_id` is in active use. A
    /// closing connection must report `false`.
    pub fn set_active(&self, user_id: Id, conn: u64, active: bool) {
        let mut map = crate::sync::lock(&self.active);
        if active {
            map.entry(user_id).or_default().insert(conn);
        } else if let Some(conns) = map.get_mut(&user_id) {
            conns.remove(&conn);
            if conns.is_empty() {
                map.remove(&user_id);
            }
        }
    }

    /// Whether `user_id` is using Chatly on any device right now.
    pub fn is_active(&self, user_id: Id) -> bool {
        crate::sync::lock(&self.active).contains_key(&user_id)
    }

    /// Every user id with at least one live gateway connection right
    /// now — for a freshly-connecting client to snapshot who's already
    /// online, the same role `voice_participants` plays for voice.
    pub fn online_user_ids(&self) -> std::collections::HashSet<Id> {
        crate::sync::lock(&self.online_counts).keys().copied().collect()
    }
}

impl Default for GatewayHub {
    fn default() -> Self {
        Self::new()
    }
}
