# Changelog

All notable changes. Format follows [Keep a Changelog](https://keepachangelog.com/);
versions follow [Semantic Versioning](https://semver.org/). The
finer-grained, per-request history of the UI work lives in
[UX_FEEDBACK.md](UX_FEEDBACK.md).

## [Unreleased]

### Added
- **Reset password** for the global admin (Global admin → All accounts): a new
  generated password, shown once, and the account is signed out everywhere.
- **Settings → Devices → Test my connection**: says in words whether this device
  can make a call (microphone, secure page, voice relay, UDP/TCP reachability).
- **Calls that never connect are ended with a message** after 20 seconds instead
  of sitting there dead. The server logs whether a client's packets ever arrive
  (`docs/admin.md`, "When a call will not connect").
- **"A new version is available" banner** for tabs left open across a deploy
  (checked every 10 minutes and when you return to the tab; Reload / Later).
  The server also sends proper `Cache-Control` headers now.
- **Switching calls asks first**: joining or answering a call while you are on
  another asks "Leave your current call?".
- **One always-on-top window for all pop-outs** (Chrome, Edge; Document
  Picture-in-Picture). Several videos can float together and stay over a
  full-screen app; the plain-window fallback (Firefox) explains its limit.
- **Roles have an Assign button** for giving people a role, separate from Edit
  (permissions and position); with a member filter and a count. Creating a role
  opens Assign straight away.
- **Camera and screen share are always separate tiles**, each with its own
  Pop out and Full screen. Pop out uses the browser's Picture-in-Picture
  (always on top, so you can watch a screen share full screen and still see
  your friend) and otherwise opens a real window of its own; any number of
  those can be open at once. The old "camera overlays the screen share"
  bubble and its setting are gone.
- **Ctrl/Cmd+K quick switcher, rebuilt**: every channel of every server,
  conversations and servers, ranked fuzzy search with highlighting, `#`
  channels / `@` people / `>` actions / `?` message search, recent choices
  first, call actions (camera, screen share, leave), Manage server, Global
  admin and device settings, and proper listbox semantics for screen readers.
- **OpenAPI 3 route inventory** (`docs/openapi.json`), generated from
  `docs/api.md` by `scripts/gen-openapi.py`; a test fails if a route is
  missing from it.
- **Installable app and background notifications** (manifest, icons, a
  non-caching service worker; opt-in in Settings → Devices).
- **Request ids and structured request logging** (`X-Request-Id`).
- **Audit log**: a server's administrative actions (Manage server → Audit
  log) and the global admin's own (Global admin → Activity), migration 0025.
- **Declining a call** now tells the caller ("Declined"), via
  `POST /dms/:id/call/decline` and the `DM_CALL_DECLINED` event.
- A **load test** and `docs/performance.md` with a measured reference run.
- **Message search** (SQLite FTS5): this channel, this server, or your
  direct messages; jump to a result. Privacy is enforced in SQL *and*
  re-checked with the permission engine (migration 0024).
- **History paging**: older messages load as you scroll up; jumping to a
  result or reply loads the history around it; `?after=` and `?around=`
  on the messages endpoint.
- **Accessibility**: keyboard-operable server rail and conversation
  lists, landmarks, a live message log, focus ring, reduced motion, AA
  contrast, and axe-core scans in CI.
- **Operator commands**: `chatly backup`, `chatly restore`,
  `chatly admin reset-password`, `chatly admin reset-mfa`.
- **Global admin panel → All servers**: every server on the deployment
  with owner, member and channel counts; view members, reassign the owner,
  delete a server.
- **Server admins**: make/remove a server admin from a server's Members
  tab (owner plus `ADMINISTRATOR` holders); owner-only demotion, self
  step-down; admins see every private channel.
- **Friends** are always listed in Direct Messages, including ones whose
  chat you closed.
- HTTP-level test harness, web unit tests (Vitest), end-to-end tests
  (Playwright), and CI covering format, lint, tests, and a scanned image.

### Changed
- **Dependencies updated**: axum 0.8, tower-http 0.7, toml 1, infer 0.22, base64 0.23;
  web tooling on eslint 10, vitest 5 and jsdom 30. Building the web client now needs
  **Node 22.12+** (CI and the Docker build use Node 24).
- **Renamed to Chatly** (binary, image, compose project, UI and docs). Browser
  settings and the live address are kept.
- **The TURN secret moved to `docker/.env`** (git-ignored) instead of the compose file.
- **Calling back into a call in progress no longer rings**: the app now asks the
  server who is on each conversation's call (`GET /api/dms/voice-state`) when it
  connects and when you return to Direct Messages, and no longer forgets it when
  you visit another server. Before, it thought nobody was there and played the
  ring-back tone for someone already on the call.
- **Calls survive a user having several connections** (two tabs, a phone and a
  computer, or a page that reconnected before its old connection timed out).
  Before, the newest connection stole the call's messages so the device that
  made the call never connected, and any old connection closing hung up the
  call on another device. The connection that starts a call now owns it.
- **Call video uses the space**: with the chat hidden the video now fills the
  width (a leftover cap left a 240px empty strip), and the tile grid is chosen
  from the space available, so two webcams stack in a tall pane instead of
  standing as narrow slivers.
- **Adding someone to a call in progress keeps everyone together.** The call
  now moves into the new group chat for everyone on it (`DM_CALL_MOVED`),
  instead of only for the person who added, which left the other person
  behind in the old 1:1 call.
- **Turning a camera or screen share on or off no longer interrupts the call.**
  It used to rebuild your whole connection: your microphone was re-acquired,
  every voice cut out for a moment, and everyone's tiles (and full screen)
  dropped. The live connection is now changed in place.
- **Clearer, safer voice**: sent at 64 kbps (was 32) with "high" priority, so
  a screen share can no longer squeeze it on a crowded connection.
- **Much faster database access** (about five times the throughput and ten
  times lower latency in the load test): a first-in-first-out queue in front
  of the SQLite connection, one database round trip per permission check,
  message pages enriched with one query per table, cached prepared
  statements, and the member list loaded only for messages containing `@`.
  Details and numbers in `docs/performance.md`.
- **Every source file is now under 600 lines**, enforced by a test. The chat
  view (5,041 lines) is a 540-line composition root over 16 modules; the
  stylesheet, Settings, server modals, server settings, video panel and voice
  client are split into per-area files; the storage trait is twelve small
  traits with their SQLite implementations beside them; the SFU is three
  files. No behaviour change (byte-identical CSS build; all tests pass).
- The call video panel (`views/video-panel.ts`) and the DM call stage and
  ringing (`views/dm-call.ts`) are their own modules, taking ~1,300 lines
  out of the chat view (5,040 → 3,770); the web image build now uses
  `npm ci` for a lockfile-exact install.
- The release build is optimized for speed (`opt-level = 3`, ~9% more
  requests per second than the previous size-optimized profile).
- Adding someone to a **1:1** now starts a *new* group and leaves the 1:1
  untouched; adding to a group still grows it in place.
- **Channel-level admins are removed** in favour of server-level
  permissions (`MANAGE_CHANNELS`, `MANAGE_MESSAGES`). Migration 0023 keeps
  existing channel admins' access and gives them a scoped "Channel
  manager" role. The API's `is_admin` on channels is replaced by
  `can_manage` and `can_moderate`.
- Screen-share video is sent as motion content with bitrate/frame-rate
  limits; the voice server uses larger socket buffers and reads packets in
  batches.
- Shared-audio and per-person volume sliders go up to 300%.

### Fixed
- A person added to a DM during a call is now rung into it.
- A member with only `KICK_MEMBERS` could remove a server admin.

## [0.1.0]

First self-hosted release: invite-only accounts with TOTP MFA; servers
with text and voice channels, roles and channel overwrites; direct
messages, groups and friends; attachments, reactions, replies, Markdown
and LaTeX; voice, video and screen sharing through a built-in SFU with a
TURN fallback; bots; guest links; account and data export.
