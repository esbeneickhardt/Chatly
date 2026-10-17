# HTTP API reference

Every route the server exposes under `/api`. **This file is checked
against the router by a test** (`api::tests::docs_list_every_route`):
adding a route without documenting it here fails `cargo test`.

A machine-readable route inventory is in [openapi.json](openapi.json)
(generated from this file by `just openapi`).

For the WebSocket gateway and voice signalling see
[protocol.md](protocol.md). Deployment and configuration are in
[admin.md](admin.md); how the pieces fit together is in
[architecture.md](architecture.md).

## Conventions

- **Bodies and IDs.** JSON in, JSON out. Every entity id is a 64-bit
  snowflake serialized as a **string** (JavaScript can't hold 64 bits in
  a number).
- **CSRF.** Every request that isn't `GET`/`HEAD`/`OPTIONS` must carry an
  `X-Requested-With` header (any value). Browsers can't add it
  cross-origin without a preflight, which is the whole defence.
- **Authentication.** A human authenticates with the `session` cookie
  (`HttpOnly`, `Secure`, `SameSite=Lax`, 30-day sliding expiry). A bot
  authenticates with `Authorization: Bot <token>` and is refused by
  anything that manages accounts or sessions. A *guest* (a no-signup
  visitor to a DM invite link) has a 12-hour session and the same
  restrictions.
- **Errors.** Every failure has the shape
  `{"error": {"code": "snake_case_code", "message": "human text"}}`.
  `code` is stable and safe to match on; `message` may be reworded.
  Statuses used: 400 invalid input, 401 not signed in, 403 not allowed,
  404 not found (also used to hide the existence of things you can't
  see, e.g. a private channel), 409 conflict, 429 rate limited.
- **Rate limits** (per client IP unless noted): login 10/min and 5/min
  per username, registration 5/hour, MFA 10/min.
- **Permission names** (`MANAGE_CHANNELS`, …) are the server-level
  permissions defined in `crates/protocol/src/permissions.rs`. The owner
  and anyone holding `ADMINISTRATOR` (a *server admin*) have all of them.
  See [architecture.md](architecture.md#authorization-model) for the two
  administration levels.

## Account and session

| Method | Path | Who | Purpose |
|---|---|---|---|
| POST | `/register` | anyone | First-ever account becomes the global admin; everyone else needs an invite code |
| POST | `/login` | anyone | Returns `{user}`, or `{mfa_required, preauth_token}` when MFA is on |
| POST | `/logout` | session | End this session |
| POST | `/logout-all` | session | End every session for the account |
| GET | `/me` | session | The current user |
| PATCH | `/me` | session (human) | Update display name, friend-request setting |
| DELETE | `/me` | session (human) | Delete the account (password required) |
| POST | `/me/avatar` | session (human) | Set the avatar from an uploaded file |
| POST | `/me/password` | session (human) | Change password |
| GET | `/me/export` | session (human) | Download your messages |
| POST | `/me/transfer-ownership` | global admin | Hand the global-admin role to another account |
| GET | `/sessions` | session (human) | List your sessions (current one flagged) |
| POST | `/sessions/revoke-others` | session (human) | Sign out everywhere else |
| DELETE | `/sessions/{id}` | session (human) | Revoke one session |
| POST | `/mfa/totp/enroll` | session (human) | Start TOTP enrollment: secret, `otpauth://` URI, QR |
| POST | `/mfa/totp/confirm` | session (human) | Finish enrollment with a code; returns recovery codes once |
| POST | `/mfa/totp/disable` | session (human) | Turn MFA off (code or password) |
| POST | `/mfa/verify` | pre-auth token | Complete login with a TOTP or recovery code |

## Invites

| Method | Path | Who | Purpose |
|---|---|---|---|
| POST | `/invites` | `CREATE_INVITE` (or DM participant) | Create an invite for a channel or DM |
| GET | `/invites` | session (human) | Invites you created |
| DELETE | `/invites/{id}` | creator | Revoke |
| POST | `/invites/redeem` | session (human) | Join the destination of a code (idempotent) |
| GET | `/invites/{code}/preview` | anyone | What a code leads to, so a signed-out visitor sees the right form |
| POST | `/register-guest` | anyone | No-signup guest for a DM invite (rate limited like registration) |

## Servers (guilds)

"Server" is what *Add Server* creates.

| Method | Path | Who | Purpose |
|---|---|---|---|
| GET | `/guilds` | session | Servers you belong to |
| POST | `/guilds` | session (human) | Create a server; you become its owner |
| GET | `/guilds/{id}` | member | Details, including `viewer_permissions` |
| PATCH | `/guilds/{id}` | `MANAGE_GUILD` | Rename / change icon |
| DELETE | `/guilds/{id}` | owner | Delete the server |
| PATCH | `/guilds/{id}/invite-policy` | `MANAGE_GUILD` | Whether anyone (vs. admins only) can invite |
| POST | `/guilds/{id}/transfer-ownership` | owner | Give the server to another member |
| POST | `/guilds/{id}/leave` | member (not owner) | Leave, erasing or anonymizing your messages |
| GET | `/guilds/{id}/members` | member | Member list |
| DELETE | `/guilds/{id}/members/{user_id}` | `KICK_MEMBERS` | Remove a member (only the owner may remove a server admin) |
| GET | `/guilds/{id}/audit-log` | `MANAGE_GUILD` (every server admin) | This server's administrative actions, newest first: `?before=<id>&limit=<n>` |
| GET | `/guilds/{id}/voice-state` | member | Who's in which voice channel right now |
| PUT | `/guilds/{id}/admins/{user_id}` | server admin | Make a member a server admin |
| DELETE | `/guilds/{id}/admins/{user_id}` | owner, or the admin themself | Remove server-admin status |
| GET | `/guilds/{id}/bots` | `MANAGE_GUILD` | Bots in the server |
| POST | `/guilds/{id}/bots` | `MANAGE_GUILD` | Create a bot; its token is returned once |
| POST | `/guilds/{id}/bots/{bot_id}/revoke` | `MANAGE_GUILD` | Revoke a bot's token |

## Roles and channel overwrites

| Method | Path | Who | Purpose |
|---|---|---|---|
| GET | `/guilds/{id}/roles` | member | All roles including `@everyone` |
| POST | `/guilds/{id}/roles` | `MANAGE_ROLES` | Create (can't grant what you don't hold) |
| PATCH | `/guilds/{id}/roles/{role_id}` | `MANAGE_ROLES` | Edit (only roles below your own highest) |
| DELETE | `/guilds/{id}/roles/{role_id}` | `MANAGE_ROLES` | Delete |
| GET | `/guilds/{id}/members/{user_id}/roles` | member | A member's assigned roles |
| POST | `/guilds/{id}/members/{user_id}/roles/{role_id}` | `MANAGE_ROLES` | Assign |
| DELETE | `/guilds/{id}/members/{user_id}/roles/{role_id}` | `MANAGE_ROLES` | Unassign |
| POST | `/channels/{id}/overwrites/roles/{role_id}` | `MANAGE_ROLES` | Set a role's allow/deny for one channel |
| DELETE | `/channels/{id}/overwrites/roles/{role_id}` | `MANAGE_ROLES` | Clear it |
| POST | `/channels/{id}/overwrites/members/{user_id}` | `MANAGE_ROLES` | Set a member's allow/deny for one channel |
| DELETE | `/channels/{id}/overwrites/members/{user_id}` | `MANAGE_ROLES` | Clear it |

## Channels and messages

| Method | Path | Who | Purpose |
|---|---|---|---|
| GET | `/guilds/{id}/channels` | member | Channels you can see (flags `can_manage`, `can_moderate` are yours) |
| POST | `/guilds/{id}/channels` | `MANAGE_CHANNELS` | Create a text or voice channel (private to its member list) |
| DELETE | `/guilds/{id}/channels/{channel_id}` | `MANAGE_CHANNELS` | Delete a channel and its messages |
| GET | `/channels/{id}/roster` | `VIEW_CHANNEL` | Who is on a private channel's member list |
| POST | `/channels/{id}/members` | `MANAGE_CHANNELS` | Add a member to a private channel |
| DELETE | `/channels/{id}/members/{user_id}` | `MANAGE_CHANNELS` | Remove one |
| GET | `/channels/{id}/messages` | `VIEW_CHANNEL` (or DM participant) | A window of history, always oldest first: the newest by default, or `?before=<id>` (older — scroll up), `?after=<id>` (newer — scroll down after a jump), `?around=<id>` (that message with context on both sides). At most one; `limit` ≤ 100 |
| POST | `/channels/{id}/messages` | `SEND_MESSAGES` (or DM participant) | Send (≤ 4000 chars, with optional attachments and a reply target) |
| PATCH | `/messages/{id}` | author | Edit within the edit window |
| DELETE | `/messages/{id}` | author, or `MANAGE_MESSAGES` | Delete |
| GET | `/search` | see below | Full-text search over messages (below) |
| POST | `/messages/{id}/reactions/{emoji}` | channel access | React |
| DELETE | `/messages/{id}/reactions/{emoji}` | channel access | Remove your reaction |

### Search

`GET /search?q=<words>` plus **exactly one** scope: `channel_id=<id>`
(one channel or DM), `guild_id=<id>` (every channel of a server you can
read), or `scope=dms` (all your direct messages). Optional `before=<id>`
(older than this message — the pagination cursor) and `limit` (≤ 50).

Results are messages, **newest first**. Matching is by whole word, case-
and accent-insensitive, all words required, with the last word also
matching as a prefix so results appear while you're still typing. Your
text is never interpreted as query syntax. A hit is only returned if you
could read that channel: SQL narrows to the scope, and every channel a hit
is in is re-checked against your permissions.

## Direct messages and friends

| Method | Path | Who | Purpose |
|---|---|---|---|
| GET | `/dms` | session | Your conversations (your private "You" chat is always present; closed chats are hidden until new activity) |
| POST | `/dms` | session | Open a chat: one username → the 1:1 (created if needed, and un-closed); several → a new group |
| POST | `/dms/{id}/participants` | participant | Add someone. To a **1:1** this starts a *new* group and leaves the 1:1 untouched; to a group it adds in place. Never allowed on your private chat |
| GET | `/dms/voice-state` | session | Who is on a call right now in each of your conversations: `[{channel_id, user_id}]` |
| POST | `/dms/{id}/pin` | participant | Pin to the top of your list |
| DELETE | `/dms/{id}/pin` | participant | Unpin |
| POST | `/dms/{id}/hide` | participant | Close it in your list (returns on new activity or when you open it) |
| POST | `/dms/{id}/leave` | participant | Leave a group (3+ people) |
| POST | `/dms/{id}/call/decline` | participant | Tell the others you turned down their call (they see "Declined") |
| GET | `/users/search` | session | Find people by name: `?q=` |
| GET | `/friends` | session | Your friends |
| DELETE | `/friends/{id}` | session | Unfriend |
| GET | `/friends/requests` | session | Incoming and outgoing requests |
| POST | `/friends/requests` | session | Send a request by username |
| POST | `/friends/requests/{id}` | recipient | Accept (creates the 1:1) |
| DELETE | `/friends/requests/{id}` | either side | Decline / cancel |
| PATCH | `/friends/settings` | session | Whether you accept friend requests |

## Files, system, voice

| Method | Path | Who | Purpose |
|---|---|---|---|
| POST | `/uploads` | session | Upload a file (size limit `MAX_UPLOAD_MB`); returns its id |
| GET | `/files/{id}` | access to where it was posted | Download; supports `Range` |
| GET | `/system/stats` | session | This app's own network throughput |
| GET | `/voice/ice-servers` | session | Short-lived STUN/TURN credentials for a call |
| GET | `/push/key` | session | The server's Web Push (VAPID) public key, as `{"public_key"}` |
| POST | `/push/subscriptions` | session | Register this browser for push (`PushSubscription.toJSON()`: `{"endpoint","keys":{"p256dh","auth"}}`); only known push services are accepted, and it lasts as long as this session |
| POST | `/push/subscriptions/remove` | session | Stop push to a browser: `{"endpoint"}` |

## Global admin

The *global admin* is the deployment's owner (`users.is_owner`). These
routes are refused to everyone else. They are separate from a server's
own admins (see above), whose authority stops at their server.

| Method | Path | Who | Purpose |
|---|---|---|---|
| GET | `/admin/users` | global admin | Every account |
| POST | `/admin/users/{id}/delete` | global admin | Delete an account and everything it owns |
| POST | `/admin/users/{id}/password` | global admin | Give an account a new, generated password (returned once as `{"password"}`) and sign it out everywhere; two-factor stays on |
| GET | `/admin/guilds` | global admin | Every server on the deployment, with owner and counts |
| DELETE | `/admin/guilds/{id}` | global admin | Delete a server |
| GET | `/admin/guilds/{id}/members` | global admin | A server's members |
| POST | `/admin/guilds/{id}/owner` | global admin | Reassign a server to another of its members |
| GET | `/admin/audit-log` | global admin | What the global admin has done to the deployment (deleting accounts or servers, resetting passwords, reassigning owners), newest first |
