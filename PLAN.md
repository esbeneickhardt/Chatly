# Self-Hosted Chat Server — Project Plan

> **Historical document.** This is the original roadmap, kept for the reasoning behind
> early decisions. It is **not** kept current: for what exists now see the
> [README](README.md), [docs/architecture.md](docs/architecture.md) and
> [CHANGELOG.md](CHANGELOG.md). (HISTORICAL)


A Discord-style text + voice server, written from the ground up, designed to run as a single container for a community of roughly 50–100 people. No third-party identity providers, no telemetry, no external services required at runtime.

**Stack:** Rust (server, gateway, SFU) · TypeScript (web client) · SQLite (storage) · Docker (deployment) · nginx (TLS termination, already in place)

**Guiding rules**

- One binary, one container, one data volume.
- Everything a user's browser talks to is served by that binary.
- No runtime dependency on any external service. Optional features may reach out (e.g. link previews), but must be off by default.
- Foundations we adopt rather than write: TLS/crypto primitives, Opus codec, the DTLS/SRTP transport layer. Everything above that is ours.
- Never throw work away: protocol, storage, and permissions are designed once, in Phase 0/1, and only extended afterwards.

---

## Phase 0 — Foundations ✅ (2026-09-11)

**Goal:** an empty-but-real application. The Rust binary serves a TypeScript page on `localhost:8080`, builds reproducibly, and runs in Docker. Estimated effort: one weekend to one week.

### 0.1 Repository layout

```
/
├── Cargo.toml              # workspace
├── crates/
│   ├── protocol/           # shared types: events, IDs, permissions (no I/O)
│   ├── server/             # the binary: HTTP, gateway, storage, later SFU
│   └── totp/               # small self-contained TOTP impl (Phase 1)
├── web/                    # TypeScript client (Vite)
├── docker/
│   ├── Dockerfile
│   └── docker-compose.yml
├── docs/
│   ├── protocol.md         # gateway event reference
│   └── admin.md            # self-hosting guide
└── PLAN.md                 # this file
```

- [x] Create the Cargo workspace with the three crates.
- [x] `protocol` crate has zero I/O dependencies (only `serde`, plus `thiserror` for error types), so the client tooling and future bots can consume it.
- [x] `web/` initialised with Vite + TypeScript, no UI framework yet (decide deliberately in Phase 2).
- [x] `.gitignore`, `rust-toolchain.toml`, `rustfmt.toml`, `clippy` in CI-strict mode (`cargo clippy --all-targets -- -D warnings` passes clean).
- [x] A `justfile` with: `build`, `run`, `test`, `web`, `docker` (plus `lint`, `up`, `down`).

### 0.2 Server skeleton

Crates adopted: `tokio`, `axum`, `serde`, `tracing`, `rusqlite` (bundled SQLite).

- [x] Binary starts, reads config, logs "listening on 0.0.0.0:8080".
- [x] Config from environment variables with an optional `config.toml`; env overrides file. Documented in `docs/admin.md`.
- [x] Structured logging to stdout via `tracing`; log level from `LOG_LEVEL`.
- [x] Graceful shutdown on SIGTERM (Docker sends this on `stop`) and Ctrl-C.
- [x] `/healthz` endpoint returning 200 with version string.
- [x] Static file serving: release builds embed `web/dist` via `rust-embed`; debug builds serve from disk (`web/dist`) so client changes don't need a server rebuild.
- [x] `/api/*` routes return JSON with a consistent error shape: `{ "error": { "code": "...", "message": "..." } }`.

### 0.3 Storage layer

- [x] `Storage` trait in `server` with async methods (`health_check` so far). Only `SqliteStorage` implements it.
- [x] SQLite opened with WAL mode, `synchronous=NORMAL`, foreign keys on, busy timeout set.
- [x] Migrations embedded in the binary (`include_str!`), run automatically at startup, tracked in a `schema_version` table. No separate migrate step.
- [x] `DATA_DIR` config key; database lives at `$DATA_DIR/chat.db`, attachments at `$DATA_DIR/files/`.

### 0.4 Snowflake IDs

- [x] 64-bit: 42 bits ms-since-custom-epoch · 10 bits node ID (always 0 for now) · 12 bits sequence.
- [x] Generator is monotonic within a process; handles clock going backwards by waiting.
- [x] Serialised as strings in JSON.
- [x] Unit tests: ordering, uniqueness under concurrency (16 threads × 2000 IDs), round-trip serialisation.
- Note: the generator (`server::snowflake`) isn't wired into `main` yet — nothing creates entities until Phase 1. It's fully implemented and tested so Phase 1 doesn't design it under deadline.

### 0.5 Docker

- [x] Multi-stage Dockerfile: stage 1 builds web (`node:20-alpine`), stage 2 builds Rust on `rust:1.98-alpine` (native musl target, statically linked), stage 3 is `gcr.io/distroless/static-debian12:nonroot`.
- [x] Runs as non-root UID (`nonroot`, 65532:65532).
- [x] `docker-compose.yml`: one service, port `8080`, volume `../data:/data`, env `DATA_DIR=/data`.
- [x] Image size: **5.04 MB** (target was under 50 MB). Startup to healthy: **under 0.3s** (target was under 1s).
- [x] `docker compose up` shows the placeholder page in a browser. **Milestone 0 complete.**
- Gotcha discovered during verification: a freshly-created host `./data` directory is owned by the host user, not UID 65532, so the non-root container can't write to it on first run. Documented the one-time `chown` fix in `docs/admin.md`.

---

## Phase 1 — Identity, Invites, MFA ✅ (2026-09-11)

**Goal:** accounts exist, registration is invite-only, TOTP works with any standard authenticator app. No third parties anywhere. Estimated effort: one to two weeks.

### 1.1 Data model

```
users        id, username, display_name, password_hash, created_at, is_owner, flags
sessions     id, user_id, token_hash, created_at, expires_at, last_seen, user_agent
invites      id, code, created_by, created_at, expires_at, max_uses, uses, revoked
mfa_totp     user_id, secret_enc, enabled, created_at
mfa_recovery user_id, code_hash, used_at
```

- [x] Migrations for the above (`migrations/0002_identity.sql`), plus a `can_invite` flag on `users` for the "trusted members can invite too" extension the plan calls out.
- [x] Usernames: lowercase, unique, 2–32 chars, restricted charset (`[a-z0-9_-]`). Display names are free-form.

### 1.2 Passwords and sessions

- [x] Argon2id via the `argon2` crate, default (OWASP-recommended) parameters.
- [x] Session token: 32 random bytes, base64url. Only its SHA-256 is stored. Sent as `HttpOnly; Secure; SameSite=Lax` cookie.
- [x] Session expiry: 30 days sliding. `last_seen` updated at most once per hour (fire-and-forget, off the request's critical path).
- [x] "Log out everywhere" invalidates all of a user's sessions.
- [x] Constant-time comparison via `argon2`'s own verifier for passwords; SHA-256 equality for tokens/recovery codes is a plain DB lookup (acceptable since those are high-entropy random values, not human-guessable secrets).

### 1.3 Invite-only registration

- [x] If the `users` table is empty, `POST /api/register` creates the owner without an invite (checked and inserted in one transaction — race-free). Every subsequent registration requires a valid invite code.
- [x] Invite validation: not revoked, not expired, `uses < max_uses` (NULL = unlimited). Incremented atomically in the same transaction as user creation.
- [x] Owner and `can_invite` users can create invites.
- [x] Invite URL format: `<PUBLIC_URL>/invite/<code>`; the web client reads the path and pre-fills registration.
- [x] Endpoints: list, create, revoke invites (owner-only for list/revoke, matching the current single-guild/no-admin-roles MVP).

### 1.4 TOTP (RFC 6238) ✅

Written in the `totp` crate — HOTP/TOTP math, base32, nothing else.

- [x] HOTP core: HMAC-SHA1 over an 8-byte big-endian counter, dynamic truncation, configurable digit count.
- [x] TOTP: counter = floor(unix_time / 30). Accepts the current step plus one step either side.
- [x] Replay protection: last-accepted-step persisted per user (`mfa_totp.last_step`); any step at or before it is rejected.
- [x] Secret: 20 random bytes, base32-encoded. Encrypted at rest with AES-256-GCM using a key from `SECRET_KEY` (or one generated once into `DATA_DIR/secret_key`).
- [x] Provisioning URI built server-side with the instance name as issuer.
- [x] QR code generated server-side as SVG (`qrcode` crate).
- [x] Enrollment flow: enroll (secret + QR) → confirm (one valid code) → enabled + ten recovery codes shown once.
- [x] Recovery codes: ten, 10 chars, unambiguous alphabet, SHA-256 hash stored, single-use (`used_at` set atomically on consumption).
- [x] Login flow: password → if enabled, 5-minute pre-auth token (in-memory, not persisted) → code or recovery code → full session.
- [x] Disabling MFA requires a current TOTP code or the password re-entered.
- [x] RFC 6238 Appendix B SHA1 test vectors pass exactly as published.

### 1.5 Rate limiting and abuse controls ✅

- [x] In-memory token buckets (`ratelimit::RateLimiter`) keyed by IP and by username for `/api/login`; by IP for `/api/register` and `/api/mfa/verify`.
- [x] MFA verification: max 5 attempts per pre-auth token, then the token is invalidated (`auth::preauth::PreAuthStore`).
- [x] `X-Forwarded-For` only trusted when the direct peer matches `TRUSTED_PROXY` (`client_ip::resolve`).

### 1.6 Client: auth screens ✅

- [x] Register (via invite link), login, MFA prompt, MFA enrollment + recovery codes + disable in a settings modal, sessions list with revoke and "log out everywhere".
- [x] No external fonts, scripts, or CDNs. Everything is bundled by Vite.
- [x] **Milestone 1 — met:** owner registers, creates an invite, second user registers via link, TOTP enrollment works with a real authenticator-style code (verified against RFC-correct HOTP math), log out, log in with MFA, recovery code works once and is rejected on reuse.

---

## Phase 2 — Gateway and Text Chat (MVP slice, 2026-09-11)

**Goal:** the real product. Real-time messaging in servers and channels with a permission system. Estimated effort: three to five weeks.

**Scope note:** this is a deliberately reduced first slice, built to reach a genuinely usable "two people chatting in real time" milestone quickly rather than the full multi-guild product. What's built is real end to end (not stubbed) — the reduction is in *breadth* (one guild, one channel, no roles/overwrites CRUD yet), not depth. See `docs/admin.md`'s "Current limitations" section for the user-facing version of this list.

### 2.1 Data model

```
guilds        id, name, owner_id, icon_file_id, created_at
channels      id, guild_id, name, kind(text|voice|category), parent_id, position, topic
members       guild_id, user_id, nickname, joined_at
roles         id, guild_id, name, color, position, permissions(bitfield), hoist, mentionable
member_roles  guild_id, user_id, role_id
overwrites    channel_id, target_kind(role|member), target_id, allow, deny
messages      id, channel_id, author_id, content, created_at, edited_at, flags, reply_to
read_states   user_id, channel_id, last_read_message_id
bans          guild_id, user_id, reason, created_at
```

- [x] Migrations (`migrations/0003_guilds.sql`) for `guilds`, `roles`, `channels`, `members`, `messages`. `member_roles`, `overwrites`, `read_states`, and `bans` are deferred — no CRUD exists yet that would populate them (adding empty, unused tables now would just be schema for its own sake).
- [x] Every guild gets an `@everyone` role with `id == guild_id`.
- [x] Indexes: `messages(channel_id, id DESC)`, plus `channels(guild_id)` and `members(user_id)`.
- [ ] `icon_file_id`, `parent_id`/category nesting, `topic` editing: not yet (no attachment pipeline until Phase 3, no channel-management UI yet).

### 2.2 Permissions ✅ (designed and implemented, not yet exercised by real role management)

- [x] `Permissions` bitflags in `protocol`: `VIEW_CHANNEL`, `SEND_MESSAGES`, `MANAGE_MESSAGES`, `MANAGE_CHANNELS`, `MANAGE_ROLES`, `MANAGE_GUILD`, `KICK_MEMBERS`, `BAN_MEMBERS`, `CREATE_INVITE`, `CONNECT`, `SPEAK`, `MUTE_MEMBERS`, `ADMINISTRATOR` — bits 13-63 reserved.
- [x] `protocol::permissions::resolve()`: owner/`ADMINISTRATOR` short-circuit → base role permissions → `@everyone` overwrite → role overwrites → member overwrite. Exhaustive unit tests including deny-then-allow.
- [x] Role hierarchy helper (`can_manage_role`) implemented and tested, not wired to an endpoint yet (no role-editing UI to call it from).
- [x] Every message create/list REST call runs through real `resolve()` — with an empty overwrite/role set today, but the same code path role/overwrite CRUD will extend.
- [ ] Per-connection permission caching: not needed yet at this scale/complexity; each request resolves fresh from two small indexed queries.

### 2.3 Gateway protocol ✅ (MVP subset — see `docs/protocol.md`)

- [x] Hello → Identify (within 10s or dropped) → Ready → Heartbeat/HeartbeatAck → Dispatch, all real and tested against a live client.
- [x] Ready payload: user, guilds (id/name/channels).
- [x] Heartbeat: interval from Hello; miss two intervals → close.
- [x] Event routing: `HashMap<GuildId, broadcast::Sender>` behind a lock (`gateway::GatewayHub`) — exactly the "nothing fancier" the plan asks for.
- [x] Every mutating REST call (message create) publishes its event after the DB transaction commits.
- [x] Origin header checked against `PUBLIC_URL`.
- [ ] Resume (op 3): not implemented. A client that sends it gets `InvalidSession` and must re-Identify. The client papers over this by reloading channel history on every reconnect instead of relying on replay.
- [ ] Per-connection outbound queue / slow-consumer disconnect: not implemented — `tokio::sync::broadcast`'s own lagged-receiver behavior (an `Err(Lagged)` that's currently just dropped) stands in for it at this scale.
- [ ] Events beyond `READY`/`MESSAGE_CREATE` (message update/delete, channel/guild/role events, presence, typing, read state): not implemented — no feature yet on either side would produce them.
- [ ] Multi-guild fan-in per connection: not implemented (see 2.1 scope note — there's only ever one guild right now).

### 2.4 REST API (implemented subset)

- [x] Guilds: list mine. Channels: list for a guild. Messages: list (cursor-paginated on snowflake ID, oldest-first) and create (4000-char limit, validated server-side).
- [ ] Guild create/update/delete/leave, channel create/update/delete/reorder, message edit/delete, members list/kick/ban/unban, roles CRUD/reorder, guild invites, read state, typing indicator: not implemented — see the scope note above. All would need real UI to be worth building.

### 2.5 Web client

No framework — plain TypeScript + direct DOM construction, decided now rather than deferred, since the alternative (Preact/SolidJS) wasn't needed at this size and the plan says to avoid pulling in ecosystem weight without a reason to.

- [x] Gateway client: connect, Identify, heartbeat, reconnect with exponential backoff. Re-Identifies from scratch on any drop (no Resume to use yet); reloads the open channel's history on every `READY` (covers the "don't lose messages sent while briefly disconnected" case without needing Resume).
- [x] Simple state held directly in the chat view's closures (`activeChannel`, last-rendered-author/time for grouping) rather than a separate normalized store — reasonable at "one guild, one channel" scale; revisit if/when multi-guild lands.
- [x] Layout: sidebar (guild name, channel list, user chip, settings/logout) · message pane · composer. No member list yet (no membership-management UI to feed it).
- [x] Composer: Enter sends, Shift+Enter newline, textarea auto-grows.
- [x] Own markdown renderer: bold, italic, inline code, auto-linked URLs. DOM tree via `createElement`/`textContent`, never `innerHTML` on message content. Strikethrough, code blocks, block quotes, mentions, and spoilers are not implemented yet.
- [x] Message grouping (same author within 5 minutes).
- [x] Settings: MFA enroll/disable, sessions list with revoke, invite creation (owner). No profile editing or theme toggle yet (dark-only, matching the plan's default).
- [ ] Virtualised message list, `@` mention autocomplete, unread/mention badges: not implemented — the last two need read-state tracking, which isn't built yet.
- [x] **Milestone 2 — met, at MVP scope:** two browser sessions (verified via a real `ws` client plus a jsdom-driven run of the actual compiled client against the real backend) register, land in the same default guild/channel, and see each other's messages live over the gateway. History pages backwards via cursor pagination. Full multi-guild permission-hides-a-channel behavior isn't demonstrable yet since there's only one channel — the underlying `resolve()` call is real and tested in isolation (see 2.2).

---

## Phase 3 — Completeness

**Goal:** the things that make it feel like a finished product rather than a demo. Estimated effort: two to three weeks.

### 3.1 Attachments

- [ ] `files` table: id, uploader_id, filename, mime, size, sha256, created_at.
- [ ] Upload endpoint with size limit (config, default 25 MB), streamed to `$DATA_DIR/files/<id>` — never buffered fully in memory.
- [ ] Content-type sniffed server-side, not trusted from the client. Serve with `Content-Disposition` and a strict `Content-Security-Policy` so uploaded HTML can never execute.
- [ ] Image thumbnails generated on upload (`image` crate), stored alongside.
- [ ] Attachments referenced from messages; deleting a message deletes orphaned files.
- [ ] Avatars and guild icons reuse the same pipeline.

### 3.2 Messaging features

- [ ] Replies (`reply_to`), rendered with a quote header.
- [ ] Reactions: `reactions` table (message_id, user_id, emoji). Unicode emoji only at first; custom emoji later.
- [ ] Pins per channel.
- [ ] Message search: SQLite FTS5 on `messages.content`, scoped to channels the user can view.
- [ ] Direct messages and group DMs modelled as channels with no guild and an explicit member list.

### 3.3 Notifications

- [ ] Per-user, per-guild, per-channel notification levels (all / mentions / none / mute until).
- [ ] Browser notifications via the Notification API (local to the browser; no push service).
- [ ] Unread and mention counts computed server-side and included in READY.

### 3.4 Moderation and admin

- [ ] Admin panel in the client: invites, users, sessions, bans, server settings.
- [ ] Audit log table: who did what, when, to what. Displayed per guild.
- [ ] Slow mode per channel.
- [ ] Bulk delete.
- [ ] Instance-level settings: registration mode (invite-only / closed), max upload size, instance name and icon.

### 3.5 Operations

- [ ] `chat backup <path>` subcommand: SQLite online backup API + tar of `files/`. Document a cron example.
- [ ] `chat restore <path>`.
- [ ] `chat admin reset-mfa <username>` and `chat admin reset-password <username>` for lockout recovery from the host shell.
- [ ] Prometheus-style `/metrics` (optional, off by default): connections, messages/s, DB latency.
- [ ] Startup self-check: data dir writable, SECRET_KEY set and stable, clock sane.
- [ ] `docs/admin.md` covers: first run, invites, backups, upgrades, recovery.
- [ ] **Milestone 3:** you could hand the compose file to a friend and they could run a community on it.

---

## Phase 4 — Voice (first slice, 2026-09-12)

**Goal:** voice channels that work through Docker and home NAT for a handful of people at once. This first slice covers one-to-one audio through the SFU; NAT traversal beyond a single host and the richer call UI are still open.

### 4.1 Architecture

- An SFU (selective forwarding unit) inside the same binary: each participant sends one audio stream up, the SFU forwards it to everyone else in the channel. No mixing, no transcoding. Implemented in `crates/server/src/voice/mod.rs` on top of `str0m` (sans-IO WebRTC; `rust-crypto` backend, no OpenSSL, so the musl/distroless build stays intact), driven by the same `Rtc` poll-input/poll-output pattern as str0m's own `chat.rs` example.
- Signaling rides the existing gateway WebSocket as op 4 (`VoiceStateUpdate` in, `VOICE_SERVER_UPDATE` dispatch out) rather than a separate channel — see `docs/protocol.md`.
- WebRTC in the browser talks DTLS-SRTP to the SFU. No mixing/transcoding: Opus packets are forwarded, not decoded.

### 4.2 Server

- [x] Voice channel membership tracked in-process by the `VoiceHub`/SFU task (join/leave via op 4); no persisted mute/deafen flags or a broadcast `VOICE_STATE_UPDATE` event yet — only the signaling round trip exists.
- [x] SFU listens on a single UDP port (`VOICE_PORT`, default 50000), all peers multiplexed via ICE ufrag demux (str0m's built-in behavior).
- [x] Offer/answer exchange over the gateway (op 4 both directions).
- [x] Public IP for ICE candidates from `VOICE_PUBLIC_IP` config; if unset, the server falls back to a locally-guessed host IP and logs a warning — no STUN fallback implemented.
- [x] Forward RTP audio packets between peers in the same channel (`propagate()` in `voice/mod.rs`). Mute is enforced client-side only (disabling the local track) — the server does not yet drop packets from a sender flagged as muted.
- [ ] RTCP PLI/NACK handling beyond what str0m does automatically.
- [ ] Per-channel participant cap.
- [ ] Speaking indicator (`ssrc-audio-level` → SPEAKING events).

### 4.3 Client

- [x] `getUserMedia` with echo cancellation, noise suppression, auto gain (`web/src/voice.ts`).
- [x] `RTCPeerConnection` with the SFU's own advertised host/reflexive candidates, plus a TURN relay fetched from `/api/voice/ice-servers` as a fallback for NAT pairs that can't traverse directly — see 4.4.
- [x] Minimal voice UI: voice channels are visually distinct in the channel list, joining shows a status bar with mute/leave controls. No participant list, speaking highlight, or deafen yet.
- [ ] Push-to-talk / voice-activity modes; input/output device selection; per-user volume.
- [ ] Reconnect on ICE failure without leaving the channel (a failed/closed connection currently just leaves).

### 4.4 Docker and NAT

- [x] Compose exposes `50000:50000/udp` and sets `VOICE_PUBLIC_IP` to the host's LAN address for same-network use.
- [x] Self-hosted TURN (`coturn` service in `docker/docker-compose.yml`, `TURN_SECRET`/`api::voice`) for NAT pairs that can't traverse directly. Added after real cross-network testing confirmed plain host/reflexive-only ICE (this section's original design) genuinely fails between two real home networks, not just as a theoretical gap — see UX_FEEDBACK.md for the live bug report that surfaced it.
- [ ] `network_mode: host` fallback documented.
- [ ] Wider test matrix: verified one remote pair over TURN; two+ remote peers behind different NATs simultaneously, and the "does 16 people hold up" question, are both still open.

### 4.5 Later (not in scope for v1)

- Video and screen share — **now done**, see 4.3 and UX_FEEDBACK.md batch 18.
- Noise suppression beyond browser defaults.

---

## Phase 5 — Deployment Behind nginx

**Goal:** public, TLS via your existing Let's Encrypt cert, container only exposed on localhost except the voice UDP port.

- [ ] Server binds `127.0.0.1:8080` (or the docker bridge) — not `0.0.0.0` on the host.
- [ ] Set `TRUSTED_PROXY=<nginx ip>` so rate limiting sees real client IPs.
- [ ] Set `PUBLIC_URL=https://your.domain` for invite links and cookie `Secure` flag.
- [ ] nginx server block: proxy `/` to the container; for `/gateway` add `Upgrade`/`Connection` headers and a long `proxy_read_timeout` (e.g. 1h) so WebSockets are not dropped; `client_max_body_size` matched to upload limit; HSTS.
- [ ] Voice UDP port forwarded on the router directly to the host, bypassing nginx.
- [ ] Security headers from the app itself (CSP, X-Content-Type-Options, Referrer-Policy) so they hold regardless of proxy.
- [ ] Upgrade procedure documented: `docker compose pull && docker compose up -d`; migrations run automatically; backup first.
- [ ] Log rotation handled by Docker's json-file driver limits in compose.
- [ ] **Milestone 5:** friends join via an invite link over HTTPS, enable MFA, talk in text and voice.

---

## Cross-Cutting Checklists

### Security

- [ ] All user content escaped or rendered via DOM construction; no `innerHTML`.
- [ ] CSRF: cookie is `SameSite=Lax` and all mutating routes require a custom header (`X-Requested-With`) or a per-session CSRF token.
- [ ] WebSocket origin check against `PUBLIC_URL`.
- [ ] Secrets never logged. `SECRET_KEY` rotation procedure documented (re-encrypts TOTP secrets).
- [ ] Dependency audit in CI: `cargo audit`, `cargo deny` with an allowlist; `npm audit`. Keep the dependency count small enough to actually read the list.
- [ ] Threat model doc: what an admin can see (everything on disk; be honest about this), what a member can see, what the network sees (TLS only).

### Privacy

- [ ] No analytics, no crash reporting, no update checks that phone home. If you want an update notice, make it opt-in and fetch a static JSON from a server you control.
- [ ] Link previews (if ever added) fetched by the server, opt-in per guild, with a documented note that the server's IP contacts the linked site.
- [ ] Data export per user (JSON of their messages and profile).
- [ ] Account deletion that anonymises messages rather than breaking history.

### Testing

- [ ] Unit tests: snowflakes, permissions, TOTP, markdown parser, gateway framing.
- [ ] Integration tests: spin up the binary against a temp SQLite file, run a scripted client through register → invite → login → MFA → send message → resume.
- [ ] Load test: 200 simulated gateway connections, 50 msg/s, confirm memory stays flat and p99 fan-out latency under 50 ms on a small VM.
- [ ] Browser smoke test (Playwright) for the core flows before each release.

### Documentation

- [ ] `docs/protocol.md` kept in sync with `protocol` crate (consider generating it).
- [ ] `docs/admin.md`: install, configure, backup, restore, upgrade, recover access.
- [ ] `docs/architecture.md`: one page with the diagram of binary → gateway → storage → SFU.
- [ ] `CHANGELOG.md` from the first tagged release.

---

## Suggested Order and Rough Timeline

| Phase | Effort | Cumulative |
|-------|--------|------------|
| 0 Foundations | 1 week | 1 week |
| 1 Identity + MFA + invites | 2 weeks | 3 weeks |
| 2 Gateway + text | 4 weeks | 7 weeks |
| 3 Completeness | 3 weeks | 10 weeks |
| 5 Deployment behind nginx | 2–3 days | ~10.5 weeks |
| 4 Voice | 6–8 weeks | ~4.5 months |

Phase 5 is deliberately pulled forward before voice: a text-only server your friends are actually using is worth more than a voice feature nobody has tested, and real usage will reshape Phase 3 priorities.

## Definition of "v1.0"

- Single container, single volume, documented install.
- Invite-only registration, TOTP MFA with recovery codes.
- Guilds, channels, roles, permissions, messages, attachments, replies, reactions, search, DMs.
- Voice channels working through NAT for a small group.
- Backup, restore, and lockout recovery commands.
- No network connections initiated by the server other than those the admin explicitly configures.
