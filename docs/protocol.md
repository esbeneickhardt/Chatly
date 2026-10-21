# Protocol reference

The WebSocket gateway and voice signalling. The REST surface is in
[api.md](api.md) (checked against the router by a test); how the pieces
fit is in [architecture.md](architecture.md). This file is maintained by
hand — when you add or change a gateway event, update it in the same
change.

## Common shapes

- **Entity ids** are 64-bit snowflakes (`protocol::id`): 42 bits of
  milliseconds since 2024-01-01T00:00:00Z, 10 bits of node (always 0 —
  single instance), 12 bits of sequence. They sort by creation time and
  are always serialized as JSON **strings**.
- **Errors** from `/api/*` are
  `{"error": {"code": "snake_case", "message": "human text"}}`.
  `code` is stable; `message` may be reworded.

## Gateway

A WebSocket at `/gateway`. The browser's session cookie authenticates the
handshake; the `Origin` header is checked against `PUBLIC_URL` (loopback
hosts are treated as equivalent, for development). The client must still
send Identify as a protocol step.

Frame: `{ "op": <int>, "d": <payload>, "s": <seq | null>, "t": <event | null> }`

| op | name | direction | purpose |
|----|------|-----------|---------|
| 0 | Dispatch | S→C | An event; carries `s` (sequence) and `t` (name) |
| 1 | Heartbeat | C→S | "Still alive" |
| 2 | Identify | C→S | Must arrive within 10 s of connecting or the socket is closed |
| 3 | Resume | C→S | **Not implemented** — the server answers op 9 and the client re-Identifies |
| 4 | VoiceStateUpdate | C→S | Join, renegotiate, or leave a voice channel (below) |
| 9 | InvalidSession | S→C | Reply to Resume |
| 10 | Hello | S→C | Sent on connect: `{heartbeat_interval_ms}` (30 000) |
| 11 | HeartbeatAck | S→C | Reply to Heartbeat |
| 12 | Activity | C→S | `{active: bool}`: whether someone is using this page (in front, focused, touched in the last 3 minutes). Sent on connect and on every change; a user with any active connection gets no Web Push |
| 13 | MicProblem | C→S | `{problem: bool}`: whether the people in your call can't hear you because of your microphone (blocked, gone, sending silence). Sent when it changes and again when someone joins; ignored when you aren't in a call |

The server closes a connection that misses two heartbeat intervals.
There is no event replay: after any reconnect the client gets a fresh
`READY` and refetches what it needs.

### Rooms and subscriptions

A connection subscribes to its own **user room**, every **guild** it's a
member of, and every **DM channel** it's a participant in; a
`DM_CHANNEL_CREATE` arriving on the user room subscribes it to the new
channel immediately. Every event below is delivered to whichever room it
was published to.

### Dispatch events (`t`)

| Event | Payload | Delivered to |
|---|---|---|
| `READY` | `{ user, guilds: [{id, name, channels}], dms: [{channel_id, users}], online_user_ids }` | the connection, once, after Identify |
| `MESSAGE_CREATE` | a message | the guild / DM room |
| `MESSAGE_UPDATE` | a message — also fired for reactions (the whole message is resent) | the guild / DM room |
| `MESSAGE_DELETE` | `{ channel_id, message_id }` | the guild / DM room |
| `VOICE_STATE_UPDATE` | `{ channel_id, user_id, connected }` | the guild / DM room; also replayed to one user added to a DM mid-call |
| `VOICE_MIC_PROBLEM` | `{ channel_id, user_id, problem }` | the room of the call that person is in (op 13); a `VOICE_STATE_UPDATE` for them clears it |
| `VOICE_SERVER_UPDATE` | `{ channel_id, sdp }` | the one connection (signalling reply, below) |
| `PRESENCE_UPDATE` | `{ user_id, online }` | every room the user is in (only on their first / last connection) |
| `FRIEND_REQUEST_CREATE` | a friend request | the recipient's user room |
| `DM_CHANNEL_CREATE` | `{ channel, participants, pinned }` — `participants` are *everyone except the receiver* | a new chat's members' user rooms; also the existing room when someone is added to a group |
| `DM_PARTICIPANT_LEAVE` | `{ channel_id, user_id }` | the DM room |
| `DM_CALL_DECLINED` | `{ channel_id, user_id }` — someone turned down the call | the DM room |
| `DM_CALL_MOVED` | `{ from_channel_id, to_channel_id, by }` — a call in a 1:1 moved into the new group made by adding someone; whoever is on it follows. Sent only when a call is going, after the group's `DM_CHANNEL_CREATE` | each of the two people in the 1:1 (personal rooms) |

### Voice signalling (op 4 / `VOICE_SERVER_UPDATE`)

Voice uses the gateway only for SDP; the media is a separate UDP stream
to the SFU on `VOICE_PORT`. There is no second signalling connection.

- **C→S, op 4** — `d: { channel_id, sdp, video_purposes, renegotiate }`.
  `{channel_id, sdp: <offer>}` joins a voice channel;
  `{channel_id: null}` leaves. `video_purposes` maps each of the offer's
  own video `mid`s to `"camera"` or `"screen"` (plain SDP can't say),
  which the server uses to tag the forwarded streams so peers can tell a
  camera from a screen share. `CONNECT` on the channel is enforced
  server-side. For a DM the check is just "are you a participant" — a
  call is a voice join against the DM's own channel id; there is no
  separate ringing or accept step.
- **S→C, `VOICE_SERVER_UPDATE`** — `d: { channel_id, sdp }`: an `answer`
  to a join, or an unsolicited `offer` when another participant's track
  needs adding to this peer connection.
- **One call per user, on one connection.** A user may have several gateway
  connections (tabs, devices, a page that reconnected before the server noticed
  its old connection died). The one whose fresh offer started the call *owns*
  it: the server's answers and offers for that call go to it, only it may
  renegotiate, answer or leave, and only its closing ends the call. Another
  connection of the same user closing (or sending "leave") changes nothing.
  A fresh offer from a different connection takes the call over (one device at
  a time; the other device's media stops).
- An offer **without** `renegotiate` is a fresh join: the server builds a new
  peer connection. An offer **with** `renegotiate: true` (camera or screen
  share turned on or off) is applied to the client's live connection, so the
  microphone and everyone's audio carry on. The client re-uses one
  transceiver per slot (camera, screen video, screen audio): turning a share
  off sets it `inactive`, turning it on again sets it `sendonly`; the server
  follows the media line's direction (`MediaChanged`) to start or stop
  forwarding it. The client falls back to a fresh join if the connection is
  not up or the server does not answer within a few seconds.
- The server and a client can offer at the same moment. The **server wins**:
  it drops a `renegotiate` offer that arrives while its own is waiting for an
  answer, and the client (which accepts the server's offer, rolling back its
  own) then offers again.

### Voice presence (`VOICE_STATE_UPDATE`)

Broadcast to the channel's room whenever someone joins or leaves — also
on an abrupt loss (closed tab, dead connection), which the SFU detects
itself after a 15 s ICE grace period. A client that has just connected
has seen none of these and asks for a snapshot:
`GET /api/guilds/:id/voice-state` → `[{channel_id, user_id}]`. For DMs
there is no snapshot endpoint; a client learns a DM call exists from the
join events (see [architecture.md](architecture.md#voice-and-video)).

### Media

- Audio: Opus. Video: whatever the browser and str0m negotiate (VP8,
  VP9 and H.264 are enabled); no simulcast, one quality layer per track.
- The SFU relays RTP without transcoding and forwards keyframe requests
  (PLI/FIR), throttled to one per second per track.
- ICE: the server advertises a host candidate and, if `VOICE_PUBLIC_IP` is
  set, a reflexive one. Short-lived STUN/TURN credentials come from
  `GET /api/voice/ice-servers` (see `TURN_*` in [admin.md](admin.md)).
