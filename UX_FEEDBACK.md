# UX feedback tracker

This file exists because assistant memory across sessions is not
reliable — it's the source of truth for outstanding UI/UX work the
user has asked for. **Update it in the same turn as any change it
describes.** Never mark something done without having rebuilt,
redeployed to `http://127.0.0.1:8090`, and verified it there (or via
`curl`/jsdom against that instance) — "should work" is not "done."

Test accounts on the local instance: `admin`/`admin1234`,
`alice`/`alicepass1`, `bob`/`bobpass123`.

## Open

Numbered by when they were raised. Do not renumber when items are
resolved — strike through instead, so history stays legible.

### Batch 72 — 2026-10-01 (renamed to Chatly)

219. [x] **Chatty is now called Chatly.** The tab title, the installed app's
     name, the update banner, the TOTP issuer default, the CLI (`chatly`), the
     Docker image and compose project, and all docs say Chatly. The address
     (chatty.ebbemonster.dk) is unchanged, and so are the keys your browser
     stores settings under, so sidebar widths, audio and notification choices
     carry over. Verified on the live instance after redeploying.

### Batch 71 — 2026-09-19 (ask before switching calls; three in one call)

209. [x] **Ask before jumping from one call to another.** Starting or joining a
     call (a DM's Call button, a server voice channel, Ctrl+K, or answering an
     incoming call) while you are already on one now asks "Leave your current
     call?", naming both ("a call with Ben" / "a call with Cy", or the voice
     channel). Cancel keeps you where you are (an incoming call keeps ringing so
     you can still answer it); "Switch call" does it. Leaving your own call, or
     joining when you are on none, never asks. Tested end to end.
210. [x] **Adding someone to a call in progress no longer strands anyone.** Cause:
     adding a person to a 1:1 makes a new group chat (the 1:1 stays), and only
     *you* were carried into the group's call; the other person stayed behind
     in the old call, alone, and just got a ring for the group. That was the
     "rerouted to a new call" you saw, and the old test even expected it. Now
     the server tells both people on the call (`DM_CALL_MOVED`), so the call
     follows the conversation for everyone: three people, one call. The other
     person is not asked (it is the same call gaining someone) and sees a
     short notice; the newcomer is rung as usual. If the other person was
     still being rung, that ring is replaced by one for the group. Tested at the
     server (the event goes to both, in the right order, and only when a call is
     going) and in the browser with three people.
211. [x] **Roles: an explicit "Assign" button, and create-then-assign.** Each role
     row is `Assign` · `Edit` · `Delete` (`@everyone` has no Assign), with the
     number of people holding it shown beside the position. Assign opens only
     the people (with a "Find a member" filter); Edit opens only permissions and
     position. Creating a role now opens its Assign panel straight away, so the
     flow is create, then assign. (The button was first labelled "Members (n)";
     renamed to match how you describe it.)
212. [x] **Why the Assign button was missing from your screenshot: an old tab.**
     The Members/Assign button had been deployed and was in the live bundle, but
     a tab opened before the deploy keeps running the old code, and nothing told
     it otherwise. Two fixes so no change can hide like that again: the server
     now sends `Cache-Control` (the page, service worker and manifest are always
     re-checked; hashed files are kept for good), and an open tab checks every
     10 minutes and whenever you come back to it, then shows **"A new version of
     Chatly is available"** with Reload / Later. It never reloads by itself, so
     it cannot drop a call. Tested.
213. [x] **Calls that cannot connect now say so.** Reported: on a phone, calling and
     joining a voice channel both "didn't work" (no mic, sound or camera). What the
     production logs showed: that phone's connection never got past "Checking"
     on the server while everyone else's completed in milliseconds, i.e. its
     network never completed a connection with the voice server. What made it
     look like a bug in the app: a call that never connects sat on screen looking
     connected (call screen, buttons) with nothing flowing, for half a minute or
     more, and then vanished without a word. Now: after 20 seconds without a
     connection it says "Couldn't connect the call…" (with what to try) and hangs
     up. Tested with a browser that is not allowed to connect.
214. [x] **Was it the "ask before switching calls" prompt?** Checked, and no: it
     cannot block a first call (it only asks when a call is already up; the
     phone's logs show the connection attempts themselves stalling), and I
     confirmed a phone-sized touch browser calls, connects and hears fine. One
     related hole is fixed: a call that has failed or dropped no longer counts as
     "a call you are on", so it can never trigger the question.
215. [x] **Settings → Devices → "Test my connection".** Checks the page is secure, the
     microphone opens, the voice relay is configured, and whether this device can
     reach the voice server's address service and the relay over UDP and over TCP,
     then says in plain words what is wrong (e.g. "This network is blocking voice
     traffic… switch between Wi-Fi and mobile data"). Run it on the phone that
     fails, on the network that fails. The server now also logs whether a
     client's packets ever arrive (see `docs/admin.md`, "When a call will not
     connect"). Also: if a browser refuses the voice sender settings (bitrate and
     priority), it now gets a working call with its defaults instead of none.
216. [x] **Webcam-to-webcam layout wasted space** (the strip "where the chat used
     to be"). Two causes. With the chat hidden the video area stopped 240px
     short of the edge (a leftover width cap), leaving an empty strip. And the
     tiles were arranged in a square-ish grid whatever the space, so two
     webcams in a tall pane were two narrow slivers with a small picture in each.
     Now the video takes the full width when the chat is hidden, and the grid is
     chosen from the actual space (two webcams stack in a tall pane, sit side by
     side in a wide one), re-chosen when the pane changes size. Tested, and
     checked by eye.
217. [x] **Two tabs or devices on the same account broke calls** (found while
     answering "does it give issues if two connect from the same wifi?").
     Two people on one wifi is fine: the server tells connections apart by
     their credentials and port, not by address (a three-person call from one
     machine is in the test suite), and I checked that packets from inside your
     network reach the server through its public address. The real fault was one
     *account* with more than one connection (a second tab, a phone plus a
     computer, an installed app plus a browser tab, or a page that reconnected
     before the server noticed its old connection had died, which phones do
     constantly). The server kept a single signalling channel per user, so the
     newest connection stole the call's messages (the device that made the call
     never got its answer and never connected), and any old connection closing
     also hung up the user's call on the other device. Now the connection that
     starts a call owns it: its messages go to it, and only its closing (or its
     own "leave") ends the call. A different device starting a call takes it over
     (one device at a time). Tested in unit tests and with two tabs in a browser.
     This is a likely cause of the phone report above, which fits the logs:
     signalling that never arrived looks exactly like a connection that never
     completes.
218. [x] **Calling back into a call still in progress rang someone who was already
     on it.** Reproduced first: Ann calls Ben, Ben answers, Ann hangs up (Ben
     stays), then Ann reloads or visits another server and presses Call again.
     She joined straight into the call, but the screen said "Ringing", showed
     Ben as being rung, and played the ring-back tone. Cause: a client only
     learns who is on a conversation's call from live join/leave events, so after
     a reload, a reconnect, or going to another server (which wiped that
     knowledge) it believed nobody was on the call. Fixes: the server can now
     say who is on a call in each of your conversations
     (`GET /api/dms/voice-state`), the client asks when it connects, reconnects
     and returns to Direct Messages, switching servers no longer forgets
     conversation calls, and Call re-checks who is really there once connected
     before ringing anyone. Calling someone who has also left still rings, as it
     should. Tested both ways, and the endpoint at the server.

### Batch 70 — 2026-09-19 (voice quality, Ctrl+K, separate webcam and screen-share windows)

204. [x] **Voice quality: toggling a camera or screen share no longer cuts the
     call.** Root cause found in the code, not guessed: every toggle tore down
     your whole peer connection, re-acquired the microphone (so its automatic
     gain re-settled audibly), rebuilt the audio graph, and made everyone else
     lose and regain your voice and all your video. It is now renegotiated in
     place. Pinned by an end-to-end test that turns a camera and a screen share
     on and off and asserts neither side's connection was recreated and the
     audio track stayed the same one. Also: voice is sent at 64 kbps (was 32)
     and at "high" priority (the browser default was "low", the same as
     video), also tested.
205. [x] **Webcam and screen share are always separate tiles, and each can be
     popped out.** The old design drew a person's camera as a bubble *on top
     of* their screen share, so "Pop out" on that tile could only pop the
     screen, never the webcam. Every stream now has its own tile with its own
     Focus, Pop out and Full screen. Pop out uses the browser's own
     Picture-in-Picture (always on top, so it stays visible over a full-screen
     screen share) and falls back to a real window of its own where that isn't
     available (Firefox) or is already taken; a blocked window now says so
     instead of silently doing nothing. Full screen also survives the call
     changing underneath it: re-laying-out the tiles used to move the
     full-screen tile in the page, which makes the browser leave full screen.
206. [x] **Ctrl/Cmd+K rebuilt** — see CHANGELOG. Works from anywhere, even with
     Settings open, and puts focus back where it was on close.
207. [x] **Roles: a separate "Members" button for assigning people.** Each role
     row now reads `Members (n)` · `Edit` · `Delete`. Members opens just the
     people (with a "Find a member" filter and a live count); Edit opens just
     the permissions and position; only one is open at a time. Before, the
     people list sat at the very bottom of Edit, under the whole permission
     checklist. `@everyone` has no Members button (everyone has it). Tested
     end to end, including that the server really holds the assignment.
208. [x] **Pop-outs staying visible over a full-screen app (macOS).** On a Mac, a
     full-screen app gets its own Space and an ordinary browser window can't
     float over it; only Picture-in-Picture windows can. Pop out now tries, in
     order: **Document Picture-in-Picture** (Chrome, Edge: one always-on-top
     window holding *every* popped-out video, each with a "put back" button),
     the browser's native video Picture-in-Picture (Safari), and only then a
     plain window (Firefox), which now says plainly that a full-screen app will
     hide it and suggests Focus + Hide chat instead of Full screen. Before, a
     second pop-out fell back to a plain window because the browser's single
     Picture-in-Picture slot was taken. Tested with a stand-in for the browser
     API (the shared-window logic); that it floats over a full-screen app is the
     operating system's behaviour and could not be tested here.

### Batch 69 — 2026-09-19 (no more giant files: every source file under 600 lines)

203. [x] **UX/maintainer ask**: "For the huge files, why not divide the code
     into smaller modules? No one can find their way around a 3000+ line
     file!" Done, and made a rule: **no hand-written source file may exceed
     600 lines** (Rust, TypeScript, CSS, tests included), enforced by a test
     with an empty exception list. Before/after for the offenders:
     `chat.ts` 5,041 → 542 (plus 16 modules of ≤ 470), `style.css` 4,337 → 12
     ordered files, `sqlite.rs` 1,511 → a connection file plus twelve
     domain files each holding a small trait and its implementation,
     `settings.ts` 1,244, `guild-settings.ts` 1,128, `servers.ts` 804,
     `video-panel.ts` 1,067, `voice.ts` 1,038, `voice/mod.rs` 812 and
     `http_tests.rs` 602 all split by responsibility. The largest file in the
     repository is now 595 lines. Behaviour unchanged, and checked the hard
     way: the built CSS is byte-identical (same content hash as production);
     typecheck, lint, 77 Rust tests, 68 web unit tests and all 18 end-to-end
     browser tests pass after every step. Details, the module map and the
     lessons learned (script the moves; let the type-checker and browser tests
     referee) are in `docs/architecture.md`, "Small files, by rule".

### Batch 68 — 2026-09-19 (installable app, background notifications, request ids, first big split of the chat view)

200. [x] **Chatly can be installed as an app**, and can notify you. It now
     ships a web-app manifest, icons (192/512 PNG and an SVG) and a
     service worker, so the browser offers *Install* and it opens in its own
     window on desktop and phone. *Settings → Devices → Show notifications
     when the app is in the background* (off until you turn it on — the
     browser's permission prompt is one-shot) raises a notification for
     every direct message, for mentions elsewhere, and for incoming calls,
     but **only while the app isn't in front of you** (a notification for
     what you're looking at is noise), one per conversation rather than a
     stack, and clicking it brings the app to that conversation. The
     service worker deliberately caches nothing, so a deploy can never leave
     anyone on a stale bundle. Limitation, stated in the admin guide: this is
     not Web Push — nothing arrives once every Chatly window is closed.
     Verified: manifest and worker are served with the right types and the
     worker registers; with the permission stubbed (headless Chromium never
     grants it or shows real notifications) the app asks for exactly
     "Ben: are you there?" on the right conversation when — and only when —
     it's backgrounded and enabled; 8 unit tests cover the on/off/denied/
     unsupported/backgrounded logic.
201. [x] **Every API request is logged with a request id** (returned as
     `X-Request-Id`, and kept if a reverse proxy already set one), one
     structured line each — method, path *without* the query string (search
     terms don't belong in logs), status, milliseconds. A hostile or
     oversized incoming id is replaced. Documented in the admin guide.
202. [x] **The chat view is coming apart.** `views/chat.ts` was one function
     of ~5,000 lines. Two self-contained slices are now their own modules
     behind explicit interfaces: the call video panel (grid and layouts,
     the draggable self-view, tile controls — `views/video-panel.ts`,
     ~1,050 lines) and the DM call stage with ringing and the incoming-call
     card (`views/dm-call.ts`, ~520), leaving `chat.ts` at ~3,770. Behaviour
     unchanged: typecheck and lint clean, and all 18 end-to-end tests pass
     (a new one covers video tiles and focusing). The end-to-end suite paid
     for itself here: the first mechanical extraction of the DM call slice
     rewrote `/api/dms/…` inside a string to `/api/ctx.dms/…`, which
     neither `tsc` nor ESLint can see, and the "declining a call tells the
     caller" test failed on it immediately. The technique — and the
     lesson — are written down in `docs/architecture.md`.

### Batch 67 — 2026-09-19 (audit log, call decline, measured performance)

197. [x] **Audit log**, at both administration levels. *Manage server →
     Audit log* (for anyone with `MANAGE_GUILD`, i.e. every server admin)
     lists what changed in that server, newest first, in sentences — "Ana
     made Ben a server admin", "Ana created the channel #plans", "Ana
     removed Sam from the server" — for promotions and demotions, kicks,
     role create/edit/delete/assign/unassign, channel create/delete,
     server rename/icon, invite-policy changes, ownership transfer, and
     bots. The global admin gets *Settings → Global admin → Activity* for
     what they did to the deployment (deleting accounts or servers,
     reassigning owners); those are recorded at deployment level so the
     trace of a deleted server outlives the server. Names are captured at
     the time, so an entry still reads correctly after a rename or after
     the thing it was about is gone. Writing an entry never blocks the
     action it records. Migration 0025, validated against a copy of the
     real database. HTTP tests cover: what gets recorded and in what order,
     who can read it (server admins yes; members and outsiders no), paging,
     and the global log surviving the server's deletion; an end-to-end test
     checks both screens.
198. [x] **Declining a call now reaches the caller.** Declining used to just
     dismiss the card on your side while the caller kept hearing the
     ring-back until it timed out. Now the caller's stage shows the person
     as "Declined" (a dimmed avatar) and, if everyone they rang declined,
     the status reads "Declined"/"Everyone declined" and the ring-back
     stops. New endpoint `POST /api/dms/:id/call/decline` and gateway event
     `DM_CALL_DECLINED`. Verified in two real browsers.
199. [x] **Performance measured, not asserted.** A load test drives the real
     router and database with 60 people acting at once (about 2,800
     requests) and prints latency percentiles; `docs/performance.md` records
     the method, a reference run (≈350 requests/s at saturation — roughly
     ten times what the community should generate — with p95 under about
     0.4 s while every client is queued on one SQLite connection), and the
     honest caveats: the shared host makes absolute numbers swing several-
     fold from run to run, so builds are only compared by alternating runs
     back to back. That method showed `opt-level = 3` about 9% faster than
     the previous size-optimized `"z"` release profile, so the release
     profile now favours speed. (An early "3.6× slower" reading of `"z"`
     turned out to be host noise and was discarded rather than written up.)

### Batch 66 — 2026-09-19 (taking every quality dimension to 10: search, history, accessibility, operations, tests, docs)

The user asked for the nine-way quality analysis (code quality,
maintainability, readability, documentation, efficiency, utility,
feature completeness, ease of use, best practices) to be taken to 10/10.
This batch is the first pass through it; what's done and what isn't is
recorded honestly in the final report and `CHANGELOG.md`.

192. [x] **Message search** — the biggest missing feature. A search button
     in the channel header (and Ctrl+Shift+F, and "Search messages" in
     the command palette) opens a panel: type, choose *This channel* /
     *This server* / *Direct messages*, click a result to jump to it.
     Words are matched whole-word, case- and accent-insensitively, all
     required, with the last word also matching as a prefix so results
     appear while typing; matches are highlighted and long messages are
     excerpted around the match. Backed by SQLite FTS5 (migration 0024,
     with triggers so edits, deletes and even cascaded server/channel
     deletes keep the index correct). **Privacy is enforced twice**: SQL
     narrows to the requested scope (a DM search can only ever touch
     conversations you're in), then every channel a hit is in is re-checked
     with the real permission engine, so private channels and overwrites
     are respected; typed text is never interpreted as FTS syntax (a stray
     quote is not a 500). Migration 0024 validated against a **copy** of
     the real database first: 88/88 messages indexed, FTS integrity check
     clean.
193. [x] **Old history is now reachable.** Discovered while building the
     above: the message list only ever loaded the newest 50 messages and
     had no way to load older ones. It now loads older pages as you scroll
     up (keeping your place), and after jumping to a search result or a
     reply quote loads a window *around* that message that scrolls both
     ways; a "Jump to present" button returns to the live end, and messages
     arriving while you're in the past are held behind it rather than
     appended out of order. Reply quotes to messages that aren't loaded
     now load the history around them instead of doing nothing. The server
     gained `?after=` and `?around=` alongside `?before=`.
194. [x] **Accessibility pass.** Automated axe-core (WCAG 2.1 A/AA) scans of
     the sign-in screen, server view, server settings, DMs, search, user
     settings and the global admin panel now run in CI and pass with zero
     violations (they started with contrast, missing button names and
     unlabelled inputs). Beyond what a scanner sees: the server rail and
     channel/DM rows were mouse-only `div`s — they're now keyboard
     focusable and operable with Enter/Space (with names and
     `aria-current` for the open one); the app has real landmarks (servers
     nav, channels nav, main), the message list is a live log so new
     messages are announced without re-reading the whole list on a switch;
     icon-only buttons get their tooltip as an accessible name and form
     labels are connected to their inputs (a safety net in `a11y.ts`, unit
     tested); there is one visible keyboard-focus ring; animations stop for
     people who ask their system for reduced motion; the confirm dialog
     and search panel trap/restore focus and close on Escape. Filled
     buttons use a darker accent and accent-coloured text a lighter one so
     both reach 4.5:1 contrast. Verified with a keyboard-only end-to-end
     test (focus a rail icon, Enter; Space on a conversation; Escape closes
     search and returns focus).
195. [x] **Operations.** `chatly backup <dir>` (consistent live snapshot),
     `chatly restore <dir> [--force]` (verifies the backup first, keeps the
     replaced database), and `chatly admin reset-password|reset-mfa <user>`
     for lockouts — the previous instructions were "edit the database with
     sqlite3". Exercised against a copy of the real production data.
196. [x] **Engineering quality.** CI (format, clippy `-D warnings`, tests,
     typecheck, ESLint, Prettier, unit tests, end-to-end tests in real
     browsers, image build + vulnerability scan) and a tag-driven release
     workflow; an in-process HTTP test harness and 25+ tests over the real
     router and database; 60 web unit tests; a 14-test Playwright suite
     (DMs, admin levels, calls, screen share, search, accessibility);
     `unwrap`/`expect` in server code cut from 56 to 8 (each an infallible
     or startup-only invariant), and mutex poisoning no longer cascades
     into a permanent outage. Docs rewritten to match the code: an API
     reference checked against the router by a test, architecture, protocol,
     admin guide (backup, recovery, real limitations), SECURITY,
     CONTRIBUTING, CHANGELOG; PLAN.md marked historical.

### Batch 65 — 2026-09-19 (admin levels: server admin vs. global admin; friends always in Direct Messages; adding to a 1:1 makes a new group)

Terminology used from here on, in the UI and the code: a **server** is
what "Add Server" creates (a guild); **global** means across the entire
deployment.

190. [x] **UX ask**: "In the direct messages all friends should always be
     available. Right now if you add a person to a chat, then the
     original chat is forever gone."
     - **Cause**: "Add people" grew the 1:1 *in place* — the chat with
       that friend became a group chat, so there was no longer a 1:1 with
       them at all, and the DM list only ever showed existing
       conversations. (The same held for any 1:1 you'd closed.)
     - **Adding to a 1:1 now starts a new group** with the two of them
       plus the newcomer and leaves the original 1:1 untouched, history
       and all — the newcomer only ever sees the group. Adding to a chat
       that is already a group still grows it in place. If you were in a
       call in the 1:1 when you added someone, the call moves into the new
       group: you join it, and everyone in the group (including the person
       still on the old call) gets the normal incoming-call ring.
     - **Every friend is always reachable**: under your conversations the
       DM list now shows a "Friends" section with any friend who has no
       open 1:1 (one you closed, or one that got converted before this
       fix). Clicking one opens the chat again — the *same* conversation if
       it exists, un-hidden, rather than a duplicate. Friends who do have
       an open chat aren't listed twice.
     - Chats that were already converted into groups before this fix
       can't be split apart retroactively, but the friend is back in the
       list and a fresh 1:1 is one click away.
     **Verified live** (three real Chromium sessions on a scratch
     instance): closed the chat with a friend → it moved to "Friends";
     clicking it reopened it and it left that section; added a third
     person from the 1:1 → the list showed the new "Alice, Carol · 3
     Members" group *and* the original 1:1 with Alice. HTTP-level tests
     cover: new group vs. in-place growth, what each of the three people
     sees, and close → reopen returning the same conversation.

191. [x] **UX ask**: "In addition to being able to see 'All Accounts', the
     global server admin should also be able to see 'All Servers'. Right
     now I think there is no differentiation between admins for the
     individual servers and the admin for the full complete instance. We
     need this differentiation. Right now admins are added at the channel
     level. That should be removed, and instead be at the server level."
     - **Two levels of admin, kept distinct.** *Global admin* (the
       instance owner — the first account, movable via "Transfer
       ownership"): Settings now has a **Global admin** tab (was "Admin")
       with **All accounts** and **All servers**. All servers lists every
       server on the deployment — including ones the global admin never
       joined — with owner, member count, channel count and creation date;
       from there the global admin can see a server's members, hand the
       server to another of its members (the owner went missing), or
       delete the server. Being the global admin gives no standing
       *inside* a server you haven't joined (verified: it can't read that
       server's channels), and a server admin has no say in the global
       panel. *Server admin*: the server's owner, plus anyone with the
       `ADMINISTRATOR` permission.
     - **Making a server admin is one click**: Manage server → Members
       shows "Owner" / "Server admin" badges and a **Make admin** button
       (backed by a built-in "Admin" role, created on first use — the
       Roles tab shows it and the label now says "Server admin" instead of
       "Administrator"). Rules: any server admin can promote; only the
       owner can remove another admin (an admin can always **step down**
       themselves); the owner can't be demoted; and a member with only
       `KICK_MEMBERS` can no longer eject an admin. Server admins also see
       every private channel and can create/delete channels, remove
       members and change the invite policy — but can't delete the server
       or hand it over (those stay owner-only).
     - **Channel-level admins are gone.** No more "Admins" tab in a
       channel's settings, no per-channel admin routes, no "creator is the
       channel's admin". Who can manage a channel is the server-level
       `MANAGE_CHANNELS` permission and who can delete other people's
       messages is `MANAGE_MESSAGES` (both resolved per channel with
       overwrites); the client gets `can_manage` / `can_moderate` on each
       channel instead of the old `is_admin`. A channel's settings now
       only edit who can see it and delete it.
     - **Migration 0023** turns existing channel admins into something
       equivalent rather than dropping them: each keeps access to the
       private channels they administered, and gets a per-server "Channel
       manager" role with exactly `MANAGE_MESSAGES | MANAGE_CHANNELS` —
       deliberately not admin, so nobody is silently promoted (server
       owners are skipped; they already have everything). Validated
       against a **copy** of the real production database first: exactly
       one such delegate existed and got the role; `foreign_key_check`
       clean; the live database untouched. A unit test pins the same
       behaviour.
     **Verified live** (scratch instance, real browsers): Global admin →
     All servers listed both servers (one the admin isn't in) with the
     right owner/counts and the members view; the owner promoted a member
     via Make admin (badge appeared, tab preserved, Roles tab showed the
     new Admin role), and that member's own view showed "Step down as
     admin" and no controls over the owner; a channel's settings showed no
     Admins tab. Nine new HTTP-level tests (real router + real database
     via the new in-process harness) cover: admin-endpoint gating, global
     admin sees unjoined servers but has no access inside, reassign/delete,
     promote-then-run-the-server incl. private channels and the owner-only
     limits, demote rules, the kick guard, and the removed routes.

     Also in this batch: `renderAvatarEl` (5 copies) and `confirmDialog`
     (3 copies) are now one shared `web/src/ui.ts`; the confirm dialog
     gained dialog semantics (`alertdialog`, labelled/described), Escape,
     a focus trap and focus restore, and defaults focus to Cancel for a
     destructive action.

### Batch 64 — 2026-09-18 (screen share: smoother video and louder audio for viewers; adding someone mid-call now rings them in)

188. [x] **UX ask**: "I tried to share a youtube video, but it lags like
     crazy for the receiver. Is there any way to make it go more
     fluently through and also the audio is very low for the receiver
     despite having it on max at them."
     - **Why the video crawled**: Chrome treats anything from
       `getDisplayMedia` as a slide-style "screencast" — on a tight uplink
       it protects resolution and drops the frame rate to a few fps, which
       is exactly what a video playing in a shared tab looks like on the
       far end. Nothing in the app overrode that, and no encoder limits
       were set at all. Screen video is now declared `contentHint =
       "motion"` (hold the frame rate, shed resolution instead) and sent
       with explicit limits — 4 Mbps, 30 fps, and a 4K/1440p monitor is
       scaled to at most 1920 px on its long edge so it isn't software-
       encoded at full size. The shared *audio* track is declared "music"
       (Chrome otherwise tunes it as call speech) with a 128 kbps ceiling.
     - **Server side of the same lag**: the SFU shares one UDP socket
       between every participant and processed one datagram per loop
       pass — each pass re-polling every connection — so a keyframe
       (a hundred-odd packets back to back) could overflow the kernel's
       default receive buffer; the lost packets then look like network
       loss and provoke *more* keyframe requests. It now asks for 4 MiB
       socket buffers (the kernel granted 416 KiB here — it clamps to
       `net.core.rmem_max`/`wmem_max`, which is logged at startup as
       `voice: UDP socket buffers`; raise those sysctls on the host for
       more) and drains up to 256 queued datagrams per pass.
     - **Why the audio was quiet**: an `<audio>` element's `volume` tops
       out at 1.0, so "max" could never be louder than the source — and
       a YouTube tab is routinely far quieter than a mic that went
       through AGC. The remote volume sliders (the person's voice, their
       screen-share audio, and the per-person ones in the voice-channel
       list) now go to **300%**, with a detent that snaps at 100% the way
       it already did at 0%, and a tooltip showing the percentage. Above
       100% the audio is routed through a Web Audio gain node (element
       kept attached but muted, which Chrome needs to feed a remote
       stream into Web Audio) followed by a soft limiter, so a boosted
       loud passage compresses instead of clipping. At or below 100% it's
       the plain element as before. If the listener picked a specific
       speaker and their browser can't route Web Audio to it, it stays
       capped at 100% rather than blasting the wrong device.
     **Verified live** (scratch instance, three real Chromium sessions,
     a synthetic 2560×1440 60 fps "screen" with a 440 Hz tone): the
     sender's screen video reported `contentHint = motion`,
     `maxBitrate 4000000`, `maxFramerate 30`, `scaleResolutionDownBy
     1.33` (2560→1920), audio `music`/128000; the sender encoded at 29 fps
     and the receiver decoded 30 fps with 0 dropped frames. Receiver
     volume: at 300% the gain node read 3 and the tone measured after the
     limiter was RMS 0.094, at 150% it was 1.5 and 0.047 (exactly 2:1),
     the element was muted while boosted and back to unmuted volume 1 at
     100%. **Not reproducible here**: the original lag comes from a
     constrained real-world link, which localhost doesn't have — what was
     verified is that the new encoder settings are actually in effect and
     the pipeline is intact, not the before/after on a poor connection.
     If it still stutters on a weak connection, the next lever is
     downstream bandwidth estimation/pacing in the SFU (str0m's BWE is
     currently off), a bigger change.

189. [x] **UX ask**: "if in a direct call, then adding someone to the call
     doesn't work. They don't get a call into the chat."
     - **Cause** (two gaps): clients only ever learn about a call from the
       `voice_state_update` fired when somebody *joins* it. Someone added
       afterwards wasn't in the room when that fired, so nothing told them
       a call was going on. And even a replayed event would have been
       dropped — the new member's client didn't put the DM into its list
       unless they happened to be on the Home view, and the call handler
       ignores channels it doesn't know.
     - **Fix**: when someone is added to a conversation with a live call,
       the server replays each current participant's "joined" to just the
       new member right after the `DM_CHANNEL_CREATE` that introduces the
       chat, so it looks to them exactly like the call starting: incoming
       call card, ring, Answer/Decline. On the client, `dm_channel_create`
       now refetches the DM list wherever you are, and call events wait
       for that refetch. On the adder's side the new person shows on the
       stage as ringing (with the ring-back tone) until they pick up.
     **Verified live**: Alice and Bob in a call in their DM, Alice added
     Carol through the real "Conversation options → Add people" UI — Carol's
     page showed the incoming-call card "Incoming call · Alice, Bob";
     Alice's stage showed
     Carol as a third, ringing avatar; answering put Carol in the call
     with both others visible. Repeated for the branch where the new member
     is *not* on Home (Dave, freshly added, sitting on a server view with
     no DM list loaded): the card still appeared ("Incoming call · Alice,
     Bob, Carol"). `tsc`, `vite build`, `cargo clippy`,
     `cargo test` (61) clean; no migration.

### Batch 63 — 2026-09-18 (phone video call: the self-view bubble is movable and resizable; ending a call no longer leaves an empty box)

187. [x] **UX ask**: "When on phone in the cam chat, we have some issues:
     1. The floating video of one self cannot be moved around or be
     resized. 2. Closing the call leaves behind an empty box where the
     video used to be."
     - **Movable/resizable self-view**: on a phone, one-on-one, with chat
       hidden, the call reshapes into "them full-screen, you a corner
       bubble" — but that bubble was a fixed CSS box pinned top-right
       (30% wide, capped at 140px). New `self-bubble.ts` makes it a real
       floating window: drag it anywhere with one finger, pinch with two
       to resize (it grows out from under the fingers), or drag the grip
       in its bottom-right corner to resize with one — the pinch works but
       is fiddly on something that small. It can't be dragged or sized
       off-screen (min 84px, max 70% of the screen width), a finger lifted
       mid-pinch carries on as a drag instead of jumping, and its
       tile's own buttons (focus/pop out/full screen) still work. Position
       and size are remembered (`chatty:selfBubble`) as percentages
       *between the screen's edges* — the same convention as the desktop
       camera overlay — so rotating the phone can't strand it off-screen.
       They're applied as CSS custom properties that only the bubble rule
       reads, never as plain inline left/top/width, so none of it leaks
       into the ordinary grid layouts the same tile element is used in
       when it isn't a bubble (verified: with chat shown again the tile is
       back to a normal positioned tile).
     - **The empty box**: reproduced, and it wasn't specific to phones.
       Focusing a tile turns the video area into a spotlight plus a
       filmstrip with its own resize handle — both direct children of the
       tile container — and "is there any video left to show" counted
       *every child*, not tiles. Ending the call (or the focused person
       leaving) removed the tiles but left the filmstrip's resize handle
       behind (the un-focused layout removed the filmstrip but not its
       handle), so the panel stayed open around nothing: measured live at
       390×380 with zero tiles and a stray divider bar. Fixed both halves:
       the layout now removes that handle when it drops the filmstrip, and
       the visibility check counts actual `.video-tile`s (descendants, since
       in a focused layout most sit inside the filmstrip). Same change also
       fixes the "rotate" button's tile count in a focused call, which was
       counting the filmstrip container as a tile.
     **Verified live** on a 390×844 phone session in a real call, using
     genuine multi-touch events (CDP `Input.dispatchTouchEvent`, not
     synthetic mouse events): the bubble started at its top-right default
     (117×156); a one-finger drag moved it to the lower left; a two-finger
     pinch-out grew it 117→273px (the 70% cap); dragging the grip shrank
     it 273→201px; a drag far past the screen's top-left corner clamped it
     at (0,0); the saved prefs were the expected percentages. For the
     empty box: reproduced first (stacked layout, tile focused, hang up →
     panel still 390×380 with 0 tiles and a leftover handle), then after
     the fix the same sequence left the panel hidden with no children.
     Also re-ran the earlier phone scenarios (guild voice alone, hang up
     first, other side hangs up first) — all still clean. `tsc`, `vite
     build`, `cargo test` (61) clean; frontend-only, no migration;
     redeployed; scratch instance and scripts removed.

### Batch 62 — 2026-09-18 (call stage: nicer type and tighter spacing, resizable, and no more doubled-up controls)

186. [x] **UX ask** (with screenshots of the ringing stage and the header
     above it): "A few notes on this calling: 1. I am not loving the font
     for the names and 'Ringing', also the space down to the controls
     seems too big. 2. The area between the chat and the calling should
     be adjustable. 3. I am wondering a bit about this dual controls
     thing here in the image. Is there any better way?"
     - **Type and spacing**: names were small, muted, regular-weight
       text and the status a dim 0.9rem line; names are now 0.95rem
       semibold in the normal text color, the status 1.05rem medium, and
       "Ringing" / "Waiting for others to join" carry three pulsing dots
       instead of a static "…" that read as frozen. The big gap to the
       controls came from the layout itself: the stage was a fixed ~42vh
       box with its avatars pinned to the top and its controls to the
       bottom (`space-between`), so any spare height became a gulf in
       the middle. It's now one group (avatars → status → controls)
       centered in whatever height the stage has, content-sized by
       default — measured live: the stage went from ~420px to 302px, with
       28px between the status line and the controls.
     - **Adjustable**: a grip bar between the stage and the conversation
       drags the stage's height (mouse or touch), remembered across
       reloads, double-click to snap back to the content-sized default.
       Below ~310px it switches to a `tight` layout (smaller avatars sized
       from the height, no name labels, snugger spacing, and a smaller
       ringing pulse so it doesn't spill past the smaller stage) so it
       can shrink to 190px without clipping its own controls. The handle
       only shows in the default shape — not in the slim bar (video on)
       or the phone's full-screen call screen, where there's no
       conversation below to trade space with.
     - **Doubled controls**: the screenshot showed hang-up twice (the
       header's phone-off button and the stage's red one) — and, on a
       phone, mic/camera mirrors in the header on top of the stage's
       too. Rule now: **whichever surface is actually showing the call
       controls owns them.** While the stage is on screen, the header's
       hang-up (and the phone-only mic/camera copies) hide; guild voice
       calls have no stage, so they keep the header ones; and on a
       phone with video on — where the compact stage is hidden entirely
       to save vertical room — the header copies come back, since
       they're then the only ones. What's left in the header is view
       controls (sidebar, hide chat, pop-out, rotate) that aren't call
       controls at all. Not touched: the mic/deafen/camera/screen
       buttons in the sidebar footer, which are the always-there device
       toggles for any call (or none) rather than part of a specific
       call's UI — say the word if you'd rather they step aside during a
       DM call too.
     **Verified live** with two sessions (desktop + a 390×844 phone):
     computed font size/weight and the status→controls gap as above;
     dragging the grip +120px took the stage 302→422px and dragging it up
     hit the 190px floor in `tight` mode with 60px avatars; the saved
     height survived a reload and a fresh call; double-click reset it to
     302px and cleared the saved value; the handle hides in compact; the
     header hang-up computes `display: none` while the stage is up; on the
     phone an audio call showed the full-screen stage with the header
     copies hidden, and when the other side turned video on (compact
     stage hidden) the header's hang-up/mic/camera returned. `tsc`, `vite
     build`, `cargo clippy/test` (61) clean; frontend-only, no migration;
     redeployed; scratch instance and scripts removed.

### Batch 61 — 2026-09-18 (reply quotes no longer show machine-generated filenames)

185. [x] **UX ask**: "For quoting the filenames, use the original
     filename, not the hashed name. The hashed name tells users
     nothing." Checked before changing anything: there is no separate
     hashed name anywhere in the app. Uploads are stored on disk under
     their snowflake id, but the `files.filename` column — and every
     place that shows a name — holds exactly the filename the
     uploader's device sent. The names that read as hashes are
     generated by the *source* (looking at a copy of the real database:
     a phone camera's `17895058467123352784638444487746.jpg`, the
     Windows snipping tool's `{453C540C-C0CE-4F19-8A32-A371BDD48080}.png`,
     a random token like `zR4i8xCkXImx…-2511858679.png`), so there's no
     "original" to fall back to — that *is* the original. What can be
     done is stop quoting a meaningless name in a one-line preview.
     `file-labels.ts` (`friendlyFileLabel`) now decides: a real
     filename is shown as-is; one that looks machine-generated (a GUID,
     a long run of digits/hex, or a long random mixed-case token with
     digits) is replaced with what the file is — "Image", "Video",
     "Audio", or e.g. "PDF file" — and the real filename stays on hover.
     Applied to both places a reply preview names an attachment (the
     quote in the message list and the composer's "Replying to" banner,
     which share one chip); images keep their thumbnail either way. The
     check is deliberately conservative — a wrongly flagged human name
     only costs a generic label with the real name in the tooltip.
     Not changed: attachments shown in the message itself and in the
     composer's pending-upload chips still show the filename as sent,
     since the ask was about quoting; the same helper could be applied
     there if wanted.
     **Verified**: ran the heuristic over the real production filenames
     plus human-style ones (16 cases: the three generated examples above,
     a GUID `.mp4`, a hex `.pdf` → "PDF file", versus `report.txt`,
     `DSC_5949-web.jpg`, `Trainspotting.wav`, `01. Challengers.flac`,
     `Screenshot_20240101-101010_Instagram.png`,
     `MyHolidayPhotoFinal2024.jpg`, a sentence-style name, and camera
     `IMG_2024…` names — all kept as-is), then live in a real browser:
     replying to an image uploaded as a numeric name and as a GUID name
     both quoted "Image" (thumbnail present, real name in the tooltip),
     in the quote and in the banner, while `holiday-plan.png` quoted as
     itself. `tsc`, `vite build`, `cargo test` (61) clean; frontend-only,
     no migration; redeployed; scratch instance and script removed.

### Batch 60 — 2026-09-18 (your private chat can't have people added; group chats look like groups; calling a group rings everyone)

184. [x] **UX ask**: "In the 'Direct Chats' there seems to be a way to
     make ones own chat go away. If you 'Add friend' your own chat with
     ourself dissapears. We instead need that for your private chat you
     cannot add anyone. For other chats if you add, then the
     'channel-list' shows something like that in the image, with two
     overlapping icons, and then two names (or as many characters there
     are room for) and text under of how many members in the chat.
     Pressing the call button in a group call, calls all into the chat
     similarly as in Discord (see image)."
     - **Why the private chat "went away"**: "Add people" (and "Invite
       by link", which adds whoever redeems it the same way) worked on
       the self-chat, which the code had deliberately allowed ("turns it
       into a real 1:1"). But the channel stays flagged `is_self_dm`, and
       `find_existing_self` resolves "your" private chat by that flag —
       so it kept finding *that* channel (now a chat with the person you
       added) and never created a fresh private one. Nothing was
       deleted; the "You" chat was just replaced by a conversation with
       someone else. Now refused on both routes server-side
       (`api::dms::add_participant` and `api::invites::create` return
       `self_dm_is_private`, via a new `Storage::is_self_dm`), and the
       conversation-options button is hidden outright for the private
       chat — every entry in that menu (add people, invite link, close)
       was off-limits for it anyway.
     - **The one already-affected chat, on production**: checked a copy
       of the real database first (never the live file) — exactly one
       shared "self-DM" exists, admin's, with annemonster added.
       Migration 0022 clears the flag on any self-DM with more than one
       participant, so it becomes the ordinary conversation it de facto
       already was (nothing deleted, nobody loses access to anything)
       and the next DM-list fetch creates that account a fresh private
       chat. Side effect worth knowing: admin and annemonster will now
       have that old chat *and* their other 1:1 in their lists as two
       separate conversations, since they're genuinely two channels.
       Migration verified against the real-database copy (applied
       cleanly, that channel unflagged, the four genuine solo self-chats
       untouched, schema at 22) and covered by a unit test that
       unflags only the shared case.
     - **Group chats in the list**: a group DM row now shows two
       overlapping avatars (the first two other people, ringed so they
       read as a stack) instead of one generic "people" icon, then the
       names as one line — as many as fit, ellipsized — and "N Members"
       underneath, counting yourself like Discord ("Bob, Carol, Dave —
       4 Members"). The conversation header shows the same count next to
       the names. 1:1s and the private chat look as before.
     - **Calling a group**: it already reached everyone (the call is
       announced to the whole conversation), but two rough edges showed
       up when tested with four real sessions. The caller's stage showed
       only people who'd already answered once *anyone* did — Carol and
       Dave vanished from it the moment Bob picked up; now everyone who
       hasn't answered stays visible as a dimmed ringing avatar until the
       ring times out (the ring-back *sound* still stops at the first
       answer). And every later person to join re-fired the incoming
       card for everyone still ringing, flipping "Alice is calling" to
       "Bob is calling" — the card now stays on whoever rang first.
     **Verified live**: private-chat add-person and invite-link both 400
     with `self_dm_is_private`; the private chat's options button is
     hidden; a real four-account group ("Bob, Carol, Dave — 4 Members")
     renders the stacked avatars and count in the list and header;
     Alice calling it put incoming cards (naming Alice) on Bob's, Carol's
     and Dave's screens at once, and her stage showed all four avatars
     with three ringing; after Bob answered his showed as connected and
     Carol/Dave stayed ringing with the ring-back stopped; after Carol
     answered, only Dave was still ringing, and Bob's own stage showed
     Bob, Alice and Carol. `cargo build/clippy/test --workspace` clean
     (61 tests, one new for the migration), `npx tsc --noEmit` and `npx
     vite build` clean; redeployed via `docker compose -f
     docker/docker-compose.yml up -d --build`, migration 22 applied to
     the live database; scratch instances and scripts cleaned up.

### Batch 59 — 2026-09-18 (DM calls get a real call screen, ringing on both ends, and a proper incoming-call card)

183. [x] **UX ask** (with a screenshot of Discord's DM call screen):
     "We need to polish how it feels to call someone or be called.
     Right now you just get with weird bar in the chat that says: '🔊
     In this call'. Can we do something like Discord, where it looks
     more like this, and makes a calling sound in both places." Three
     separate gaps, all in the DM-call flow:
     - **No call screen.** A DM call was a thin banner under the header
       ("🔊 In a call with X" + a Leave button), with the controls
       tucked in the sidebar footer. Replaced it with a *call stage*
       (`renderDmCallStage` in chat.ts): a dark panel above the
       conversation with large avatars for everyone on the call, a
       status line, and a Discord-style control pill (mic, deafen,
       camera, share screen) plus a red hang-up. It has three shapes,
       chosen by what else is competing for the screen: a fixed-height
       panel above the chat by default; a slim bar (small avatars +
       controls) once a video grid is on screen, since the tiles already
       show people; and full-screen ("fill") when chat is hidden with no
       video — which is exactly what a phone call is, since mobile
       already auto-hides chat on joining a call (before this, that left
       an audio-only DM call on a phone as a blank screen). On phones the
       compact bar is hidden entirely: the header already carries
       mic/camera/leave in a call, and there's no room above the video.
       When someone else is in the call and you haven't joined, the same
       stage shows them with a green "Join Call" button instead of the
       controls. The old paragraph of echo advice ("Muting only stops
       your mic — try Deafen…") moved into the Deafen button's tooltip,
       where someone reaching for it will actually see it.
     - **The caller heard nothing while waiting.** Starting a call just
       joined voice silently. Now the caller hears a distinct ring-back
       tone (`playOutgoingCallSound`, a single lower, softer tone — never
       to be mistaken for the callee's two-tone ring) and the stage shows
       the person being rung as a dimmed, pulsing avatar with "Ringing…"
       until they pick up, you hang up, or 45 seconds pass ("No answer",
       avatar greyed). Only an explicit *start a call* rings
       (`startDmCall`) — never joining an existing call, and never one of
       the internal rejoins a camera toggle triggers (`onStateChange`
       fires for all of those), which is why the trigger is a short-lived
       flag set by the button rather than inferred from "no one else is
       here yet" (the participant map isn't seeded for DMs after a page
       load, so inference would ring someone who's already on the call).
     - **The callee got a small popup.** Rebuilt the incoming-call
       banner as a Discord-style card: the caller's avatar, their name,
       "Incoming call…" (with the conversation name for a group DM), and
       round green Answer / red Decline buttons; still rings on the
       existing two-tone pattern until answered, declined, the caller
       hangs up, or 30s.
     Also added, because the stage needs it and the guild voice list
     benefits too: **speaking rings for the *other* person**. The client
     previously only detected *your own* mic activity; `VoiceClient` now
     taps each remote mic stream with an analyser (`watchRemoteSpeaking`,
     reporting via `onRemoteSpeakingChange`) and rings their avatar green
     while they talk, in both the stage and the guild voice-channel
     participant rows. It uses waveform RMS with a short hold rather
     than the local check's frequency-bin average, since a remote stream
     has already been through the sender's noise suppression and Opus and
     can carry its energy in a narrow band that barely moves an average
     across every bin.
     Fixed two things found along the way: **ring sounds could be
     silent** — a `suspended` AudioContext (every browser's autoplay
     policy, until the page has had a user gesture) plays nothing, which
     is exactly the situation of an incoming call ringing in a tab that's
     sat idle since it loaded; `playTones` now resumes a suspended
     context, and `installAudioUnlock` creates/resumes it on the first
     click/keypress/tap. And **answering a call could render the
     conversation twice**: it runs `switchToHome` (which selects the
     first DM) and then `selectDm` on the actual caller back to back, so
     two message fetches raced and both appended their results (visibly:
     two "No messages yet" lines, and for a real conversation duplicated
     messages) — `loadMessages` now discards a fetch that's been
     superseded by a newer one, which also fixes the same race on any
     rapid channel switch.
     **Not done, deliberately:** there's no *decline* signal — the caller
     keeps hearing the ring-back until the 45s timeout even if the callee
     declines, because telling the caller needs a new gateway event and
     server change; and Discord's "X started a call" line in the chat
     itself isn't there (that needs a persisted system-message type).
     Both are natural follow-ups.
     **Verified live** with two real browser sessions (Alice calling Bob,
     fake mic/camera devices, audio instrumented at the oscillator
     level): the caller's stage showed both avatars with Bob ringing and
     "Ringing…" while a 425Hz ring-back played and Bob's page showed the
     incoming card and played the 440/480Hz ring; on Answer both stages
     showed both avatars with the ring-back confirmed stopped (its
     oscillator count stopped incrementing); Alice hanging up left
     Alice's stage on "Bob is in a call" with Join, and Bob's on
     "Waiting for others to join…"; the speaking ring lit on the *remote*
     avatar on both sides (sampled the DOM over ~25s: ~80% of samples,
     the rest being before the tone started; per-second RMS logs
     confirmed the detector tracked the tone); a 390×844 phone session
     got the full-screen call screen (stage 390×780, `fill`, chat
     hidden); with Alice's camera on, her stage collapsed to the compact
     bar (72px) beside the video grid while Bob's phone hid it
     completely. Full pipeline: `cargo build/clippy/test --workspace`
     clean (60 tests, no backend changes), `npx tsc --noEmit` and `npx
     vite build` clean; redeployed via `docker compose -f
     docker/docker-compose.yml up -d --build` (frontend-only, no
     migration); scratch instance and every Playwright script cleaned up.

### Batch 58 — 2026-09-17 (Settings/Manage Server go full-screen and swipeable on mobile, no more floating card with clipped tabs)

182. [x] **UX ask**: "We need to fix the server settings and profile
     settings to look decent in mobile. We could make them swipable
     and get rid of the scoll bars." Both modals share the exact same
     `.settings-modal`/`.settings-nav`/`.settings-content` shell
     (`settings.ts` and `guild-settings.ts` mirror each other
     deliberately), so this was one fix applied to both. Confirmed the
     actual problem live before guessing at it: on a 390×844 viewport
     the modal rendered as a 342×717 floating card with the chat
     visible around every edge — neither a clean floating dialog nor a
     real screen, just an awkward in-between — and its horizontal tab
     strip genuinely overflowed (482px of tabs in a 340px-wide nav),
     with the close button's fixed `top/right: 1rem` position landing
     directly on top of whichever tab happened to sit in that corner
     (confirmed via computed rects, not just a screenshot guess).
     - **"Look decent"**: made `.settings-modal` a true full-screen
       overlay on mobile (`position` unchanged, but sized to
       `100vw`/`100dvh` with no rounded corners and the backdrop's own
       padding zeroed via `.modal-backdrop:has(> .settings-modal)`),
       matching what Discord/Slack/Teams all actually do on a phone-
       sized viewport rather than shrinking their desktop dialog down.
       Fixed the close-button overlap properly: a first attempt
       reserved space on the *right* end of the scrollable tab strip,
       which only helped the *last* tab and did nothing for whichever
       tab (with 7 tabs, "Account" — not the last one at all) happened
       to sit under that corner at the strip's default, unscrolled
       position. Reserving *vertical* space instead
       (`.settings-nav`'s `padding-top`, pushing every tab's row below
       the close button's own row) fixes it regardless of tab count or
       label lengths, since no tab can ever reach up into that row at
       all — confirmed by checking every tab's bounding rect against
       the close button's, not just the one that looked clipped in a
       screenshot.
     - **"Get rid of the scroll bars"**: `scrollbar-width: none` (Firefox)
       and `::-webkit-scrollbar { display: none }` (Chrome/Safari) on
       both the horizontal tab strip and the vertical content pane —
       still scrolls by touch, just without the visible track/thumb
       that read as "web page" rather than "phone app."
     - **"Make them swipable"**: added a swipe-left/right gesture on
       `.settings-content` that moves to the next/previous tab (never
       wraps around, and bails out cleanly if the gesture reads as a
       vertical scroll instead — the same drag-detection idiom
       chat.ts's own mobile nav-drawer swipe-to-close already uses,
       applied here to a different element). Implemented identically in
       both files despite their different tab-switching internals
       (`guild-settings.ts` keeps every panel built and toggles
       `.hidden`; `settings.ts` tears down and rebuilds `content` on
       every switch, since one of its tabs — Devices — keeps a live mic
       meter open that needs tearing down) — the gesture itself doesn't
       care which approach a tab switch uses underneath.
     **Verified live** on a 390×844 mobile viewport: confirmed the
     modal now measures exactly 390×844 (full screen) with zero
     backdrop padding; confirmed via computed bounding rects that no
     tab in either modal overlaps the close button, for all 7 tabs in
     Settings and all 4 in Manage Server; confirmed `scrollbar-width:
     none` takes effect; ran a real synthetic touch-drag sequence and
     confirmed it advances Settings from Profile→Devices and back, and
     Manage Server from General→Members→Roles; re-confirmed the
     desktop layout (1280×800) is completely unaffected — still the
     900×680 floating dialog with its vertical side nav, since every
     change here lives inside the existing `max-width: 768px` block.

Full pipeline: `cargo build/clippy/test --workspace` clean (60 tests,
no backend changes this batch). `npx tsc --noEmit`, `npx vite build`,
both clean. Redeployed via `docker compose -f docker/docker-compose.yml
up -d --build`; confirmed `chatly-chatly-1` up, HTTP port still
`127.0.0.1`-only, no migration (frontend-only), and
`https://chatty.ebbemonster.dk/` serving the new bundle. Cleaned up the
scratch instance and every Playwright/debug script used to verify this
(including two throwaway ones written specifically to pin down the
close-button overlap before trusting a fix for it).

### Batch 57 — 2026-09-17 (reply quotes now show markdown, images, and files, not a blank line or "(attachment)")

181. [x] **UX ask**: "We need the Replys to show a bit of the original
     text. Right now it shows a line or so, and nothing if markdown,
     files or images. All other tools like Discord, Teams and Slack
     show the images, text, or the file name as quotes in replys in
     addition to the link to the original message. We need to do the
     same." Two separate root causes, one in each of the two places a
     reply preview renders (the message-list quote, and the composer's
     own "Replying to" banner while writing one):
     - **"Nothing if markdown"**: both places ran the quoted content
       through the *full* block-aware markdown renderer (fenced code,
       tables, headings — each producing a block element with its own
       margin/padding) into a container clipped to `max-height: 1.4em`.
       For a plain one-line message this coincidentally looked fine;
       for anything with real block structure, the block's own top
       spacing pushed the actual text below the clipped area entirely
       — confirmed live, not just a theoretical read of the CSS: a
       reply to a message starting with a fenced code block rendered
       as a visibly blank quote. Fixed by collapsing the quoted content
       to one line first (`flattenForReplyPreview`: join every line
       with a space, drop bare ` ``` ` fence-marker lines while keeping
       the code's own text) and handing that to `renderInline` instead
       — the existing single-line-only renderer this file already had,
       previously reserved for other things — which still renders
       bold/italic/inline-code/links/mentions correctly, just never as
       a multi-line block.
     - **"Nothing if files or images"**: the server's reply-preview
       payload (`MessageReplyPreview`) only ever carried the replied-to
       message's text `content` — never its attachments, so an
       image/file-only original (empty `content`) had literally nothing
       to show beyond a generic "(attachment)" label with no idea what
       it actually was. Added `first_attachment`/`attachment_count` to
       `MessageReplyPreview` (`models.rs`), populated in `enrich()`
       alongside the message's own attachment lookup — one extra
       `files::for_message` call against the *replied-to* message's id.
       The client now renders a small thumbnail for an image attachment
       or a paperclip-plus-filename chip for anything else
       (`renderReplyAttachmentChip`, shared by both the quote and the
       composer banner), with a "+N more" suffix for a multi-attachment
       original rather than silently dropping the rest. The composer's
       "Replying to" banner gets the identical treatment, reading
       straight off the full, already-in-memory `Message` object
       (`message.attachments`) rather than needing its own network
       round trip — it had the exact same two bugs (full markdown into
       a clipped line, nothing shown at all for an attachment-only
       original) since it shared the same rendering approach.
     Left the actual preview *length* alone (`REPLY_PREVIEW_MAX_CHARS =
     120`) — matches Discord/Slack's own one-short-line convention, and
     wasn't actually part of the complaint once "shows nothing" was
     fixed.
     **Verified live** by sending and replying to four distinct message
     types and inspecting the real rendered HTML (not just believing
     the code should work): a plain one-line message; a message mixing
     inline `**bold**` with a fenced ` ```js ` code block (confirmed the
     quote now reads "some intro **bold** then: const x = 42;
     console.log(x);" with the bold actually bolded, instead of blank);
     an image-only message (confirmed a real `<img src="/api/files/…">`
     thumbnail plus its filename, in both the message-list quote *and*
     the composer banner); a file attachment sent together with a
     caption (confirmed the paperclip-filename chip and the caption
     text both show, side by side). Re-ran `cargo test --workspace`
     (60 tests, all still passing) since this touched the message
     query/enrichment path shared by every other message-fetching
     endpoint.

Full pipeline: `cargo build/clippy/test --workspace` clean (60 tests).
`npx tsc --noEmit`, `npx vite build`, both clean. Redeployed via
`docker compose -f docker/docker-compose.yml up -d --build`; confirmed
`chatly-chatly-1` up, HTTP port still `127.0.0.1`-only, no migration
(no schema change — only the API response shape gained two new fields),
and `https://chatty.ebbemonster.dk/` serving the new bundle. Cleaned up
the scratch instance and the Playwright script used to verify all four
message-type scenarios.

### Batch 56 — 2026-09-17 (mobile video/chat divider is now draggable, same as desktop's)

180. [x] **UX ask**: "On mobile can we also make such that is the chat
     is out, you can pull the boarder between chat and video up or down
     to make either larger/smaller." Desktop's divider (dragging
     `--video-pane-width`) already did this for the side-by-side
     layout; mobile's `.video-chat-resize-handle` was outright
     `display: none`, and the panel's height was a flat, undraggable
     `max-height: 45vh`. Reworked `startVideoChatDrag` (chat.ts) to
     handle both axes from one shared implementation: it checks
     `window.innerWidth` fresh at the *start* of every drag (not baked
     into which listener fired) and adjusts `--video-pane-height`
     instead of `--video-pane-width` once `.content-split` is stacked
     — so a desktop window narrowed past the mobile breakpoint
     mid-session still drags whichever axis it's actually laid out on.
     Added real touch support (`touchstart`/`touchmove`/`touchend`
     alongside the existing mouse listeners) since a phone has no mouse
     to drag with. Restyled the handle for mobile: a full-width 18px
     horizontal grip with a small pill indicator (there's no `:hover`
     on a touchscreen to reveal a plain unmarked bar the way desktop's
     5px vertical one relies on). Stays hidden whenever chat itself is
     hidden, same as desktop — nothing to drag the video pane's height
     against once chat isn't there to trade space with.
     Found and fixed a real bug *during verification, before this
     shipped*: the first version used `max-height` (a ceiling) instead
     of `height` for the mobile panel — confirmed live that dragging to
     *shrink* worked, but dragging to *grow* silently did nothing at
     all, because a `max-height` can only ever cap a box down to fit
     smaller content, never stretch one past its own natural size. The
     desktop divider works because it drives an actual `width`, not a
     `max-width` — switched mobile to the same pattern (an assigned
     `height`), which is what actually makes both directions work.
     **Verified live** on a 390×844 mobile viewport, mid-call with chat
     shown: confirmed the handle is hidden while chat is auto-hidden
     and appears once chat is shown again; a real touch-drag sequence
     grew the video panel (380px → 489px) and correctly persisted that
     exact height across a page reload; a second drag shrank it back
     down (380px → 239px) with the chat column visibly taking the
     freed space; dragging far past the floor clamped exactly to the
     120px minimum rather than collapsing further. Separately
     reconfirmed the desktop horizontal drag still works unchanged
     after the shared refactor (431px → 584px).

Full pipeline: `cargo build/clippy/test --workspace` clean (60 tests,
no backend changes this batch). `npx tsc --noEmit`, `npx vite build`,
both clean. Redeployed via `docker compose -f docker/docker-compose.yml
up -d --build`; confirmed `chatly-chatly-1` up, HTTP port still
`127.0.0.1`-only, no migration (frontend-only change), and
`https://chatty.ebbemonster.dk/` serving the new bundle. Cleaned up the
scratch instance and every Playwright script used to verify this.

### Batch 55 — 2026-09-17 (security hardening: dependency auditing, response headers, and real custom roles/permission overwrites)

Requested as a follow-up to a full security review of the app, asking
to bring four specific parameters to "10/10": dependency/supply-chain
hygiene, transport/network-layer headers, input validation/injection
resistance, and authorization/RBAC granularity.

176. [x] **Dependency/supply-chain hygiene**. `cargo audit` (newly
     installed) ran clean against all 291 crate dependencies, and `npm
     audit --production` was already clean — nothing to actually fix
     today. The gap was that neither check ran *automatically*, so a
     newly-published advisory against something already in a lockfile
     would only ever be noticed by someone thinking to run the audit
     by hand. Added `.github/dependabot.yml` (weekly update PRs for
     cargo, npm, the Dockerfile's own base images, and the workflow
     files themselves) and `.github/workflows/dependency-audit.yml`
     (`cargo audit` + `npm audit --audit-level=high`, on every push/PR
     touching a lockfile and weekly regardless, to catch a new
     advisory against an *unchanged* dependency too).
     **Verified**: `cargo audit` and `npm audit --production` both ran
     clean locally; both new YAML files parse as valid YAML.

177. [x] **Transport/network-layer headers**. The main app served no
     security headers at all — only the file-download route
     (`uploads::download`) had its own, deliberately different
     sandboxing CSP. Added `security_headers::apply`, a response
     middleware wrapping the *entire* router (`main.rs`), setting CSP,
     `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
     `Referrer-Policy: same-origin`, `Strict-Transport-Security`, and a
     `Permissions-Policy` scoped to exactly the device APIs this app's
     own calling needs (camera/mic/display-capture, same-origin only).
     It only fills in a header a handler hasn't already set, so
     `uploads::download`'s own stricter, `sandbox`ed CSP is untouched.
     Found and fixed a real bug *while verifying this, before it ever
     shipped*: the first CSP draft's `font-src 'self'` broke KaTeX math
     rendering, because KaTeX embeds its fonts as base64 `data:` URIs
     rather than separate files — added `data:` to `font-src`.
     **Verified live**: headers present on `/`, on a 401 API error
     response, and on the gateway upgrade response; the upload route's
     own CSP confirmed untouched (still `default-src 'none'; sandbox`).
     Ran a full Playwright pass under the real strict CSP — login,
     joining a voice/video call, toggling the camera, opening the
     mobile drawer and Settings — with zero CSP console violations
     after the `data:` fix; separately confirmed a math message
     (`$$E=mc^2$$`) still renders with real glyphs, not missing ones.

178. [x] **Input validation/injection resistance**. Already solid on
     inspection (parameterized queries throughout, upload content-type
     sniffed from real bytes rather than trusted from the client,
     snowflake IDs parsed before every lookup, consistent length caps
     on every user-text field) — the two concrete gaps were exactly
     items 176 and 177 above (no dependency-vuln scanning, no CSP on
     the main app), both now closed. Nothing else to change here.

179. [x] **Authorization/RBAC granularity** — by far the largest of
     the four. The permission-*resolution* algorithm
     (`protocol::permissions::resolve`, with a full test suite) and the
     `roles` table itself (one implicit `@everyone` row per guild,
     `id == guild_id`) had existed since Phase 2 — what was missing was
     everything around them: a way to add a *second* role, assign it to
     anyone, or set a per-channel overwrite. Added:
     - Migration 0021: `member_roles` (guild+user+role) and
       `channel_overwrites` (role- or member-targeted allow/deny per
       channel) — validated both against a real copy of the production
       database (see below), not just a fresh scratch one.
     - Full role CRUD, assignment, and channel-overwrite endpoints
       (`api::roles`) — gated throughout by two guards matching
       Discord's own rules for the same reason: `ensure_can_grant`
       (you can only ever hand out a permission you hold yourself —
       otherwise a `MANAGE_ROLES` holder with nothing else could grant
       themselves `ADMINISTRATOR`) and `ensure_can_manage_role` (you
       can only touch a role strictly below your own highest one).
     - Wired `require_guild_permission`/`require_channel_permission`
       (used by essentially every existing endpoint already) to
       actually union in a member's assigned roles' permissions and
       apply channel overwrites, instead of always resolving against
       just the bare `@everyone` base — every endpoint that already
       checked a specific permission bit (kicking, creating invites,
       managing channels, etc.) picked up real role-awareness for
       free. Found and fixed the one exception: message-moderation
       (`can_moderate_channel`) checked only the older, separate
       `channel_admins` table, so a role's `MANAGE_MESSAGES` bit would
       have resolved correctly but done nothing — wired it to also
       accept a resolved `MANAGE_MESSAGES` permission.
     - A minimal but real "Roles" tab in Manage Server: create a role
       with a permission checklist, edit permissions/position, delete
       it (refused for `@everyone`), and check/uncheck which members
       have it — all against the actual API, server-enforced. Channel
       overwrites don't have UI yet (API-only for now, same as bots
       shipped in an earlier batch with no UI at all).
     **Verified live** end-to-end against a real running instance (not
     just unit tests): created a role, assigned it, confirmed the
     assignee could then do what it granted (deleted another member's
     message via the new `MANAGE_MESSAGES` path) and *not* do what it
     didn't; confirmed `ensure_can_grant` blocks handing out a
     permission the actor doesn't have while still allowing a subset
     they do; confirmed the hierarchy guard blocks managing a role at
     the actor's own highest position and allows one below it; found
     and fixed a real bug live (the overwrite upsert's `ON CONFLICT`
     target didn't match its own partial unique index, 500ing on the
     very first attempt — fixed and re-verified the full set/re-set/
     clear cycle); confirmed a channel overwrite actually blocks/
     restores `SEND_MESSAGES` for a specific member; ran the full
     backend test suite (60 tests) clean throughout. Also validated
     migration 0021 against a read-only-treated *copy* of the real
     production database (copied `chat.db`/`-wal`/`-shm` together,
     never touching the live files) — applied cleanly, server started
     and answered `/healthz` normally against it.

Full pipeline: `cargo build/clippy/test --workspace` clean (60 tests).
`npx tsc --noEmit`, `npx vite build`, both clean. Redeployed via
`docker compose -f docker/docker-compose.yml up -d --build`; confirmed
`chatly-chatly-1` up, HTTP port still `127.0.0.1`-only, the new
migration applied cleanly against the real database, and
`https://chatty.ebbemonster.dk/` serving the new bundle with the new
security headers present. Cleaned up every scratch instance, scratch
port, and Playwright script used across all four items.

### Batch 54 — 2026-09-17 (mobile in-call header decluttered for mic/camera; gateway and voice reconnect immediately when a phone comes back from sleep)

174. [x] **UX ask**: "On mobile it looks better now, but I think in
     the top we should get rid of things that matter less on mobile:
     Network info, the popout button, the channel name. That way we
     can have the webcam and mute buttons there, and maybe even the
     chat button." The mic/camera toggles already existed, but only in
     the sidebar footer — mobile reaches that through the hamburger
     drawer only, meaning muting or turning the camera on/off mid-call
     meant closing the call view to open the drawer first. Rather than
     move those buttons (still needed on desktop, where the drawer is
     always open), added mobile-only mirror buttons (`headerCameraBtn`/
     `headerMuteBtn`) wired to the exact same toggle handlers and icon-
     sync functions as the sidebar footer's, so both always agree.
     Freed the room for them the way asked: while a call is connected
     (`channelHeader` gets an `in-call` class, alongside `endCallBtn`'s
     existing hidden/shown logic in `onStateChange`), the mobile media
     query now hides the channel name, the network-bandwidth widget,
     and the "pop webcam into its own window" button — none of which
     matter while a phone call already has your full attention — and
     shows the mic/camera mirrors in the space that frees up. The
     "hide chat" button already lived in the header from an earlier
     batch and needed no change to be part of this.
     **Verified live** on a 390×844 mobile viewport, mid-call: confirmed
     the channel name, network-status button, and webcam-popout button
     are all hidden while connected; confirmed both new header buttons
     are visible; clicking the header mic button muted (both it and the
     sidebar-footer mirror showed the same "muted" state, confirming
     they share the real toggle); clicking the header camera button
     turned the camera on and correctly showed "active"; screenshotted
     the result to confirm the header actually reads as intended
     (menu, camera, mic, end-call, hide-chat — no clutter).

175. [x] **UX ask**: "there is still some stability issues with the
     chat, especially on mobile. Can we keep the connection more
     robust e.g. to the screen turning off on mobile, such that it
     keeps running, even if changing apps?" Root cause: mobile browsers
     throttle (or fully suspend) a hidden tab's own timers hard enough
     that the gateway's heartbeat routinely stops firing once the
     screen turns off — after `heartbeat_timeout` (twice the 30s
     interval — `gateway/mod.rs`) the server gives up and closes the
     socket, or the phone's radio going to sleep drops the connection
     outright. The existing reconnect logic (exponential backoff,
     `scheduleReconnect`) was itself queued as a `setTimeout` *while
     hidden*, so it was subject to the exact same throttling — the tab
     could sit there looking disconnected for far longer than its own
     requested backoff delay, until whatever got through eventually did.
     Added a `visibilitychange` listener to `GatewayClient`: the moment
     the tab is actually looked at again, if the socket isn't already
     open or connecting, cancel any pending backed-off reconnect and
     connect immediately instead of waiting it out. Gave `VoiceClient`
     the matching treatment for an active call: WiFi/cellular radios
     suspending during screen-off leaves `pc.connectionState` sitting
     in "disconnected"/"failed" with nothing flowing for either side to
     renegotiate on its own; on visibility resume, if the call is
     genuinely stuck in one of those states, it now rejoins immediately
     (the same full rebuild `join()` already does for a plain camera/
     screen toggle — camera/screen streams survive it, only the peer
     connection itself gets torn down and renegotiated) instead of
     waiting out the rest of `RECONNECT_GRACE_MS` only to hang up
     anyway once the person's already back.
     **Verified live**: patched `WebSocket`/`RTCPeerConnection` to
     count real instances created, then force-closed the live gateway
     socket while `document.visibilityState` was `"hidden"` — confirmed
     no new socket appeared 100ms later (backoff correctly not yet
     due); flipped visibility to `"visible"` and confirmed a *new*
     gateway socket appeared within 150ms, well before the pending
     backoff's own 1s delay would have fired on its own. Separately
     confirmed the voice side doesn't *over*-correct: toggling
     visibility hidden→visible during a healthy, already-connected call
     left the `RTCPeerConnection` count unchanged (no spurious rejoin
     of a call that was never actually broken). Full genuine OS-level
     radio suspension isn't reproducible in headless Chromium, so the
     "actually recovers a truly dead call" path relies on `join()`
     itself being the same, already-exercised rebuild path camera/
     screen toggles use — not a new, separately-verified mechanism.

Full pipeline: `cargo build/clippy --workspace` clean (no backend
changes). `npx tsc --noEmit`, `npx vite build`, both clean. Redeployed
via `docker compose -f docker/docker-compose.yml up -d --build`;
confirmed `chatly-chatly-1` up, HTTP port still `127.0.0.1`-only, clean
startup logs (no migration), and `https://chatty.ebbemonster.dk/`
serving the new bundle. Cleaned up the scratch instance and the
Playwright script used to verify both fixes.

### Batch 53 — 2026-09-17 (mobile full-screen call view was clamped to a narrow column; new "rotate grid" control)

172. [x] **UX ask**: "On mobile we need all video to tak up all of the
     screen, currently is just shows as a weird column to the left.
     Also add an option to highlight one video on mobile..." Two
     things bundled in this one, both about the full-screen mobile
     call view Batch 52 just added:
     - The "weird column" *was* a regression, and a self-inflicted one:
       Batch 51 (item 169, immediately above) added
       `max-width: calc(100% - 240px)` to the *base*, unscoped
       `.video-tiles-panel` rule to stop it overflowing a shrunk
       *desktop* window — but nothing excluded mobile from that same
       rule. On a phone already narrower than 240px, that clamp left
       almost nothing to render into (≈150px of a 390px-wide screen),
       which is exactly the "column on the left" being described. The
       analogous `.sidebar` rule had already been given a
       `max-width: none` override inside the mobile media query back
       in Batch 51 — the video panel just hadn't gotten the same
       override. Added it now.
     - "highlight one video" already existed (Batch 52, item 171): the
       per-tile focus/spotlight button, always-visible and touch-sized
       under the existing `@media (hover: none)` rule. It just hadn't
       actually been checked *inside* the now-fixed full-screen mobile
       view specifically — the column bug above meant that view hadn't
       been usable in that context yet. Re-verified it live in place
       rather than assuming the earlier, isolated check still applied.
     **Verified live** with two real participants (desktop + a
     390×844 mobile viewport), both with camera on: confirmed the
     mobile video panel now measures exactly 390px wide (full viewport
     width, not a clamped column); confirmed tapping the focus button
     on the mobile tile correctly spotlights it full-width with the
     other participant demoted to the filmstrip below, `.video-tiles.
     focused` applied. Noted, but left as-is (pre-existing, not part of
     this ask): the always-on-touch remote-volume slider renders a bit
     cramped inside the small filmstrip thumbnail at this width — cosmetic,
     not broken, same control that already appears on every tile.

173. [x] **UX ask**: "...and make the option to rotate which video is
     where in the grid." New feature — a "shuffle" icon button in the
     channel header, alongside the other video-grid controls, visible
     only once 2+ video tiles are actually on screen (wired into the
     same `ensureVideoTilesVisible` pass that already shows/hides
     "Hide chat" on tile-count changes). Clicking it moves the first
     tile in DOM order to the end (a plain re-parent via `appendChild`,
     never recreating any `<video>` element or interrupting playback)
     and re-runs the existing tile-layout pass, which always re-derives
     the grid/filmstrip positions fresh from current DOM order — so
     this works identically whether the grid is flat or a tile is
     currently focused/spotlighted.
     **Verified live**: with a 2-participant call, confirmed the button
     is hidden with 0-1 tiles and appears once a second participant's
     tile exists; clicking it swapped the on-screen order (the local
     "You" tile and the remote "Bob" tile visibly traded places);
     re-confirmed it also re-orders correctly with a tile focused
     (filmstrip order changes to match).

Full pipeline: `cargo build/clippy --workspace` clean (no backend
changes). `npx tsc --noEmit`, `npx vite build`, both clean. Redeployed
via `docker compose -f docker/docker-compose.yml up -d --build`;
confirmed `chatly-chatly-1` up, HTTP port still `127.0.0.1`-only, clean
startup logs (no migration), and `https://chatty.ebbemonster.dk/`
serving the new bundle. Cleaned up the scratch instance, both test
accounts, and the Playwright script used to verify all three checks —
also found and removed two stale scratch Playwright scripts
(`web/livetest-8135-scratch{,2}.mjs`) left over from an earlier batch's
cleanup that had missed them.

### Batch 52 — 2026-09-17 (push/pull the camera between overlay and grid live, right on the video; mobile calls auto-fill the screen instead of a tiny strip)

170. [x] **UX ask**: "On PC there is still no way to [push/pull] the
     webcam to jump back into the grid e.g. if also sharing my
     screen." The "camera overlays the screen share vs. its own tile"
     choice still only lived in Settings — even after drag-to-move and
     drag-to-resize made *positioning* the overlay a direct, in-place
     action, switching *which mode* it was in at all still meant
     leaving the call view entirely. Added the same direct-manipulation
     treatment to this last remaining piece:
     - A small always-visible button on the pip bubble's *top-left*
       corner (the resize handle already owns the bottom-right one) —
       a new "grid" icon, tooltip "Show camera as its own tile" — that
       pushes the camera out of the overlay into its own separate grid
       tile immediately, live, without waiting for the next camera/
       screen toggle to notice the preference changed.
     - The reverse, symmetric action on the *other* side: a "Show
       camera as an overlay on the screen share" button in the split
       camera tile's own hover controls (a new "corner-left-up" icon),
       shown *only* when that person's screen share is actually still
       running somewhere to fold back onto — with nothing to combine
       with, the button stays hidden rather than doing nothing.
     Both reuse the exact same `<video>` elements throughout (never
     recreated, just re-parented between tiles via `updateVideoTile`'s
     existing key-routing), so an already-playing stream is never
     interrupted by switching modes. The Settings toggle still exists
     for picking the *default* going forward; these two buttons are
     for switching a call already in progress, in place, without
     leaving it.
     **Verified live**, the full round trip: pushed a combined tile's
     camera out (confirmed it split into two tiles: the screen share
     alone, and a new "You (camera)" tile); confirmed the merge-back
     button only appears on the split camera tile, not the screen
     tile, and only while a screen share actually exists to merge onto
     (confirmed hidden entirely for a lone camera with no screen
     share at all); pulled it back and confirmed the tiles correctly
     recombined into one overlay again. Also re-ran the plain camera-
     on/off regression check from the last two batches — no stray
     tiles, resize handles, or undock buttons left behind.

171. [x] **UX ask**: "On mobile the video(s) is/are extremely small.
     Maybe we can just not have the chat in call mode and fill the
     screen with all the video in a grid with the option to highlight
     one." Investigated first: the "fill the screen, full video grid"
     view already existed (the "Hide chat" full-screen call mode from
     batch 39), and "highlight one" already existed too (the per-tile
     focus/spotlight control, already made always-visible and properly
     touch-sized on mobile by an earlier, unrelated fix — confirmed
     both were real and working, just not what a phone actually lands
     on when joining a call). The actual gap was exactly what was
     asked: nothing *automatically* got you there — the default,
     un-touched mobile call view stacks a video strip capped to `45vh`
     above the chat, which for more than one participant divides an
     already-shallow strip into individually tiny tiles.
     Made joining a call on mobile (viewport ≤768px, the same
     breakpoint everything else in the app already switches on)
     automatically trigger the same "Hide chat" full-screen view,
     instead of leaving it as a button to discover. Guarded against
     re-triggering on every *internal* rejoin a camera/screen toggle
     causes (`join()` fires the same "connected" transition then too —
     see `renegotiateVideo` in voice.ts) via a one-shot flag scoped to
     the current call, reset on actual disconnect: toggling your
     camera mid-call won't fight a manual "Show chat" you'd already
     chosen by re-hiding it again. Symmetrically restores chat on
     hanging up, since there's no video left to justify staying
     hidden.
     **Verified live** with two real participants (one desktop, one at
     a 390×844 mobile viewport): joining the call auto-filled the
     screen with video (the panel grew to 780px of an 844px-tall
     screen, versus roughly 380px under the old fixed strip);
     confirmed toggling the mobile participant's own camera mid-call
     (an internal rejoin) left chat correctly still hidden rather than
     re-triggering; confirmed that after manually showing chat again,
     toggling the camera again respected that choice and did *not*
     re-hide it; reconfirmed the focus button is visible and tappable
     without hover; confirmed leaving the call auto-restored chat.

Full pipeline: `cargo build/clippy --workspace` clean (no backend
changes). `npx tsc --noEmit`, `npx vite build`, both clean. Redeployed
via `docker compose -f docker/docker-compose.yml up -d --build`;
confirmed `chatly-chatly-1` up, HTTP port still `127.0.0.1`-only, clean
startup logs (no migration), and `https://chatty.ebbemonster.dk/`
serving the new bundle. Cleaned up the scratch instances and every
Playwright script used to verify both fixes.

### Batch 51 — 2026-09-17 (a remembered wide video/sidebar width no longer overflows a narrower window)

169. [x] **UX ask**: "In full screen the interface now seems to work
     as expected, but when making the browser smaller, instead of
     resizing the videos they just move out the screen. I don't like
     that design, please resize instead."
     A different bug from the last two batches' pip-overlay fixes —
     this one's about the video *panel itself* (and, found during the
     same investigation, the sidebar has the identical latent issue).
     Root cause: dragging the video/chat divider (or the sidebar
     resize handle) remembers the result as a *fixed pixel* width in
     `localStorage`, reapplied on the next load or resize via
     `--video-pane-width`/`--sidebar-width`. Both `.video-tiles-panel`
     and `.sidebar` also have `flex-shrink: 0` — which stops them
     shrinking *below* their specified width, but does nothing to cap
     what that width can legitimately demand in the first place. A
     width remembered from a wide window, reapplied on (or the window
     later resized down to) a much narrower one, simply doesn't fit —
     with `.chat-column` already squeezed to its own `min-width: 0`,
     the excess had nowhere to go but past the visible edge, reading
     exactly as tiles "moving off screen" instead of shrinking.
     Fixed with a plain CSS `max-width` on each — `calc(100% - 240px)`
     on the video panel (240px matches `VIDEO_PANE_MIN_WIDTH`, the same
     floor the divider drag itself already won't cross) and
     `calc(100% - 300px)` on the sidebar (reserving enough for
     `.main-column` to stay usable). Unlike the pip overlay's own
     resize bug two batches ago (which needed a `ResizeObserver`
     because its position/size were literal pixel values computed once
     in JS), a `max-width` constraint is inherently live — the browser
     re-evaluates it on every layout pass with no JS involved at all,
     so this fix works for *any* cause of a size change, not just a
     window resize specifically.
     **Verified live**: seeded `localStorage` with a video pane
     remembered at 900px and a sidebar at 480px (simulating a user who
     dragged both wide open on a large screen), then measured the
     actual video tile's on-screen position across four window sizes
     from 1400×900 down to 400×400 — the tile stayed fully within the
     visible viewport at every size, resizing down instead of
     extending past the edge, at every step.
     **Found, but deliberately left unfixed** (a different, narrower,
     pre-existing issue, not what was reported): at the specific
     combination of a very wide remembered sidebar *and* video pane
     together with a narrower window, the chat column can get squeezed
     down to roughly 235px, and the composer's "Send" button (icon +
     text label) doesn't shrink or drop its label at that width,
     causing a separate ~67px horizontal overflow of its own —
     confirmed via direct measurement that this is unrelated to (and
     not worsened by) this fix: it reproduces identically with no
     video call involved at all, purely from chat being squeezed this
     narrow, and this fix if anything makes chat *more* likely to keep
     a comfortable width than before, not less. Flagging it here rather
     than silently leaving it undocumented, since it's a real,
     reproducible edge case — just not the one that was actually asked
     about this time.
     Full pipeline: `cargo build/clippy --workspace` clean (no backend
     changes; this was CSS-only). `npx tsc --noEmit`, `npx vite build`,
     both clean. Redeployed via `docker compose -f
     docker/docker-compose.yml up -d --build`; confirmed
     `chatly-chatly-1` up, HTTP port still `127.0.0.1`-only, clean
     startup logs (no migration), and `https://chatty.ebbemonster.dk/`
     serving the new bundle. Cleaned up the scratch instance and every
     Playwright script used to reproduce and then verify the fix.

### Batch 50 — 2026-09-17 (camera overlay actually tracks window/tile resizing now; a toggle to collapse the server list and channel list too)

167. [x] **UX ask**: "It seems that if your browser window gets small
     enough it only shows one window. E.g. if a person shares their
     screen and webcam, the other user only sees the webcam if their
     browser window gets too small instead of resizing to keep showing
     all." Reproduced live before fixing: shrank the browser window
     with a real combined screen+camera tile open and measured both
     videos' actual on-screen positions at each size. Root cause:
     `applyPipPosition`/`applyPipSize` (added the last two batches, for
     drag-to-move and drag-to-resize) only ever ran *once* — at the
     moment a combined tile was created or its streams changed — and
     computed the camera overlay's `left`/`top`/`width`/`height` as
     fixed pixel values against whatever size the tile happened to be
     *right then*. Nothing ever re-ran that computation afterward, so
     those pixel values stayed frozen while the *main* video (plain
     `width: 100%; height: 100%`) and any multi-person grid (already
     `fr`-unit based, inherently responsive) kept adapting normally.
     Confirmed live: shrinking the window was enough for the overlay's
     stale, now-oversized position to end up well outside the tile's
     new, smaller bounds — silently clipped away entirely by the
     tile's own `overflow: hidden`.
     Fixed with a `ResizeObserver` on each combined tile's media
     wrapper (`wirePipResizeObserver`) that re-runs the exact same
     position/size logic on *any* actual size change to that specific
     element — a window resize, yes, but also toggling "hide chat,"
     dragging the video/chat divider, dragging a multi-tile grid
     boundary, or the new sidebar-collapse toggle (item 168 below) —
     one mechanism instead of trying to separately hook every action
     that can resize a tile.
     **Verified live**: re-ran the same shrink-the-window measurement
     that reproduced the bug, now at five window sizes from 1400×900
     down to 300×300 — the overlay's edge stayed flush with the tile's
     own edge (its saved anchor point) at every single size, instead of
     drifting off outside it. Also confirmed a manually dragged-and-
     positioned overlay keeps behaving sensibly across a subsequent
     window resize (a real, deliberately-placed position stays in
     roughly the same relative spot; its size still legitimately
     reshapes with the tile's new aspect ratio when no *custom* size
     was set — expected, not a regression, since the original default
     size was always a percentage of the container to begin with).
     Confirmed the "separate tile" display mode (`cameraPipEnabled:
     false`) never had this bug in the first place — its `fr`-based
     grid tracks were already correctly responsive — narrowing exactly
     which mode needed the fix.

168. [x] **UX ask**: "in the top right, we need a button to
     minimize/maximize the 'channel-list' and the 'guild-rail' TOO" —
     mirroring the existing "hide chat" button, but for the *other*
     side of the layout. Added `toggleSidebarBtn` to the channel
     header, right where "hide chat"/"end call"/"show webcam
     separately" already live. Toggles a new `sidebar-collapsed` class
     on the app shell that hides the guild rail, the channel/DM list,
     and its resize handle outright; `.main-column`'s existing `flex:
     1` picks up the freed width automatically, the same way it
     already does whenever the video panel shrinks or disappears — no
     new layout math needed. Desktop-only (hidden in the same mobile
     media query as the other desktop-only resize handles): the rail
     and sidebar are already off-canvas by default on a phone, behind
     the hamburger drawer, so there'd be nothing for this button to do
     there. Added a proper "sidebar" icon (a boxed rectangle with a
     vertical divider — Feather's own glyph for exactly this) to the
     small icon set rather than reusing an unrelated one.
     **Verified live**: confirmed clicking the button hides both the
     guild rail and the sidebar and the main column visibly grows to
     fill the freed width (measured directly, not just visually);
     confirmed clicking it again restores both; confirmed the button
     itself is hidden at a mobile viewport width.
     Full pipeline: `cargo build/clippy --workspace` clean (no backend
     changes). `npx tsc --noEmit`, `npx vite build`, both clean.
     Redeployed via `docker compose -f docker/docker-compose.yml up -d
     --build`; confirmed `chatly-chatly-1` up, HTTP port still
     `127.0.0.1`-only, clean startup logs (no migration), and
     `https://chatty.ebbemonster.dk/` serving the new bundle. Cleaned
     up the scratch instance and every Playwright script used to
     reproduce and then verify both fixes.

### Batch 49 — 2026-09-17 (real bug: popping out the camera hid the screen share too; the camera overlay can now be resized, not just moved)

166. [x] **UX ask**: "I share cam and screen, and my cam is on the
     screen shared and I can move it around, BUT I cannot resize the
     webcam. If I in the top right chose 'Show camera in seperate
     window' it stops showing the shared screen, and places me in in a
     popout. This is wrong, it should show two windows in the browser,
     that you can resize, and for each of them you can pick to pop out
     or not pop out."
     Reproduced live before writing any fix, since the described
     failure (popping out the *camera* also hiding the *screen share*)
     didn't match my first read of the code. Root cause, found by
     actually triggering it: `wirePipCollapse` (batch 47, the original
     Picture-in-Picture cleanup fix) wires its
     `enterpictureinpicture`/`leavepictureinpicture` listeners onto
     whichever `<video>` element is `.video-tile-main` *at the moment
     it's called* — but a person's camera can legitimately **start
     out** as a tile's main video (before any screen share exists) and
     get **demoted** to the small pip overlay once a screen share
     begins. The listener wired back when the camera was still main
     doesn't get removed on that demotion — it's still attached, still
     firing, and its closure still says "hide the whole tile" — so
     popping the camera out later (now just the pip) fired that stale
     "was main" handler and hid the entire tile, screen share included.
     Fixed by moving the actual *hiding* to pure CSS —
     `.video-tile-main:picture-in-picture, .video-tile-pip:picture-in-picture
     { display: none; }` — which has no staleness possible at all,
     since it's evaluated fresh against whichever element the browser
     currently considers the real PiP source, regardless of which
     class it wears now or wore before. The remaining JS
     (`updateTilePipState`) only decides whether to hide the *whole*
     tile, and only does so once *every* video in it is popped out —
     structurally impossible for a combined tile's two videos to both
     be true at once (only one thing anywhere can be
     `document.pictureInPictureElement`), so a combined tile now simply
     can't have this bug: whichever one pops out, the other keeps
     showing, exactly as asked.
     Separately added actual **resizing** for the camera overlay (drag
     to move already existed, from an earlier batch): a small grip
     rendered on the pip bubble's bottom-right corner
     (`.video-tile-pip-resize-handle`, a sibling element rather than a
     child of the `<video>` — a `<video>` can't reliably host visible
     child UI once a real frame is playing) that resizes it by
     dragging, the same direct-manipulation idea as the existing
     drag-to-move. Two real bugs found and fixed *during* this specific
     work, not shipped and found later:
     - The handle was first centered exactly on the pip's corner (half
       in, half out) — `.video-tile`'s own `overflow: hidden` clipped
       away the outside half whenever the pip sat flush against an
       edge (the default position), which made clicks meant for the
       handle land on the grid behind it instead. Fixed by keeping the
       handle fully inside the pip's own box instead of straddling its
       edge.
     - Growing the bubble from its default (bottom-right-flush)
       position was completely blocked at the *starting* size — the
       first clamp formula computed "room to grow" as the distance
       from the pip's current left edge to the container's edge, which
       at a flush-right position is exactly zero. Fixed by capping
       growth against a flat percentage of the container instead, and
       having the box's *opposite* edge (left/top) pull inward as
       needed to stay on screen — reads as "growing away from the
       corner it's anchored to," the same way real corner-anchored
       resizable UI elements behave. A related, separate cap (the
       original fixed pip's own `max-width: 180px`/`max-height: 135px`
       in `style.css`) also still silently capped growth past that
       *specific* size regardless of the fix above — inline
       `width`/`height` never overrides `max-width`/`max-height` from
       any source — so a custom size now also sets `max-width/height:
       none` inline to actually be able to exceed the original default.
     Position and size are both one shared value across every pip
     bubble on screen (unchanged design from when this was drag-to-
     move-only), not remembered per person.
     **Verified live**, thoroughly, given how many subtle failure modes
     this area has already had: confirmed popping the camera out of a
     combined tile now leaves the screen share fully visible and the
     panel open (previously both went dark); confirmed the pip
     reappears correctly on exiting PiP; confirmed dragging the resize
     handle actually grows the bubble in both dimensions (not just one,
     and not capped at the old 116×135-ish starting size); confirmed
     the resized size and its (possibly re-anchored) position both
     persist to `localStorage` and correctly re-apply the next time a
     combined tile is created; re-ran the two regression cases most at
     risk from this change — a *solo* camera (no screen share) popped
     out still correctly hides the *whole* tile (nothing else left to
     show), and the plain camera-on/off cycle from batch 47 still
     leaves no stale tiles or orphaned resize handles behind.
     Full pipeline: `cargo build/clippy --workspace` clean (no backend
     changes). `npx tsc --noEmit`, `npx vite build`, both clean.
     Redeployed via `docker compose -f docker/docker-compose.yml up -d
     --build`; confirmed `chatly-chatly-1` up, HTTP port still
     `127.0.0.1`-only, clean startup logs (no migration), and
     `https://chatty.ebbemonster.dk/` serving the new bundle. Cleaned
     up the scratch instance and every Playwright script used to
     reproduce and then verify the fix.

### Batch 48 — 2026-09-17 (Sessions settings simplified to just Log out / Log out everywhere)

165. [x] **UX ask**: "How about we just have log out and log out
     everywhere? Sessions / Log out / Log out everywhere / Remove all
     other devices (2) / Specify removal" — proposing to drop the
     "Remove all other devices" and "Specify removal" (per-session
     list with individual revoke) controls, keeping only the two
     top-level buttons. Confirmed with the user first that "Log out
     everywhere" ends *your own* current session too (unlike "Remove
     all other devices," which kept you logged in here) — they
     explicitly accepted losing the "kick every other device but stay
     logged in myself" capability in exchange for the simpler menu.
     Simplified `renderLogoutSection`/`loadSessions` (`settings.ts`)
     down to exactly two buttons — "Log out" (`POST /api/logout`) and
     "Log out everywhere" (`POST /api/logout-all`) — with no
     `/api/sessions` fetch, per-session list, or revoke-others call
     left in the UI at all. The whole thing collapsed from an async
     function that fetched sessions and conditionally built up to 3
     rows into a single synchronous function building exactly one row.
     Removed the now-fully-dead `sessionRow` helper, the `Session`
     type (now unused anywhere in the frontend), and the now-orphaned
     `.session-revoke`/`.session-other-list` CSS rules — kept
     `.session-row`/`.session-badge` since those class names are
     separately reused by the (unrelated) member-list rows in
     `guild-settings.ts`/admin panel. Left the backend untouched
     (`/api/sessions` list, `/api/sessions/revoke-others`,
     `/api/sessions/:id` revoke) — same "remove the UI entry point,
     not the working backend" precedent as the Bots section removal
     (batch 45), in case this is wanted again later.
     **Verified live**: confirmed the Sessions section now shows
     exactly two buttons ("Log out", "Log out everywhere") with none
     of "Remove all other devices"/"Specify removal" present, and
     confirmed clicking "Log out" actually logs out and returns to the
     login screen.
     Full pipeline: `cargo build/clippy --workspace` clean (no backend
     changes). `npx tsc --noEmit`, `npx vite build`, both clean.
     Redeployed via `docker compose -f docker/docker-compose.yml up -d
     --build`; confirmed `chatly-chatly-1` up, HTTP port still
     `127.0.0.1`-only, clean startup logs (no migration), and
     `https://chatty.ebbemonster.dk/` serving the new bundle. Also
     found and killed three stale scratch test instances (ports
     8133-8135) left running from earlier batches that a prior
     cleanup step missed — removed their data dirs too.

### Batch 47 — 2026-09-17 (PC: call controls moved into the channel header, a real camera-toggle bug fixed, sidebar-header right-aligned, Picture-in-Picture no longer leaves a dead tile behind)

161. [x] **UX ask**: "On PC we don't need this 'voice-status-bar', we
     can instead in the top right of the screen next to the network
     status place: 1) End call 2) Maximize/minimize chat 3) Webcam in
     separate window on/off (only appears if webcam is on). This way
     the 'video-tiles-toolbar' is also not needed." Removed both
     entirely — the sidebar's `voice-status-bar` (label + 5 buttons,
     already stripped down to just label + leave in batch 45) and the
     video panel's own `video-tiles-toolbar` (just "hide chat" by
     then). All three requested controls now live in
     `channel-header-right`, right next to the existing connection-
     status button, in a bar that's always on screen regardless of
     what else is showing — unlike the old sidebar bar (off-canvas on
     mobile, easy to miss even on desktop tucked at the very bottom)
     or the video toolbar (only ever visible when the video panel
     itself was).
     - **End call** (`endCallBtn`): shown whenever connected to any
       call, regardless of which channel/DM the header happens to be
       showing right now (matching the old status bar's behavior) —
       calls `voiceClient.leave()`. Also picked up the "reconnecting"
       pulse cue the old status bar's label used to give (a new
       generic `.icon-button.reconnecting` rule, reusing the existing
       `reconnecting-pulse` keyframe) rather than losing that signal
       entirely.
     - **Maximize/minimize chat** (`hideChatBtn`): the same button,
       just relocated — still only shown while there's an actual video
       panel to expand into (tied to `ensureVideoTilesVisible`, same
       scoping it always had).
     - **Webcam in a separate window** (`separateWebcamBtn`, new):
       shown only while your own camera is on. One click pops your
       camera specifically into the browser's native Picture-in-Picture
       window — the same thing the "pop out" control on your own video
       tile already did, just reachable without hunting for your own
       tile first (it might not even be visible — a focused/filmstrip
       layout, or several tiles in the grid). Tracks a direct reference
       to your own camera's `<video>` element (`selfCameraVideoEl`,
       set in `onLocalVideo`) so it can target *specifically* the
       camera regardless of whether it's currently rendered as a
       tile's main video, a pip overlay, or its own separate tile.
     - Also caught and fixed a real duplication this move would
       otherwise have created: the small `dmCallBtn` phone icon in a
       DM's header used to double as a second "leave call" button
       (turning into a red hang-up icon once connected) — exactly the
       kind of repeat control the earlier batches were already
       cleaning up. It's now "start a call" only, hiding itself once
       you're already in this one; `endCallBtn` is the one universal
       way to hang up. Left the separate DM incoming/ongoing-call
       *banner* (`dmCallBannerBtn`) alone — that one's bundled with
       real additional context (who else is in the call) `endCallBtn`
       doesn't provide, not pure duplication.
     **Verified live**: confirmed `.voice-status-bar` and
     `.video-tiles-toolbar` no longer exist anywhere in the DOM;
     confirmed all three new buttons are hidden before joining a call;
     confirmed "Disconnect" appears the moment a call is joined;
     confirmed "Show webcam in a separate window" stays hidden with the
     camera off and appears the moment it's turned on; confirmed "Hide
     chat" appears only once a video tile actually exists and
     disappears again once it doesn't.

162. [x] **UX ask**: "When turning webcam on then off, you get this
     weird issue where it leaves behind an empty black square that
     says 'You (camera)' in the corner. It forgets to remove the old
     one when turning a webcam off." Root cause: the "camera as its own
     separate tile" feature (batch 44) keys that tile as
     `` `${personKey} camera-tile` `` — a **raw NUL character**
     embedded in the key, which then ends up both in a `data-*`
     attribute value *and* inside a dynamically-built
     `querySelector` attribute-selector string
     (`` `[data-video-key="${tileKey}"]` ``, in `removeVideoTile`).
     That round trip isn't reliable: the selector built from the exact
     same string the attribute was set with can end up not matching
     the element it just set, so turning the camera off silently found
     nothing to remove — the stale tile (still labeled "You (camera)"
     from when it was created) was left sitting in the DOM forever.
     Fixed by using a plain, printable separator (`-camera-tile`, a
     hyphen — matching the SFU's own choice of `-` over `:` for
     exactly this class of "some characters don't survive round trips
     through browser/network string handling" reasons) instead of a
     NUL byte.
     **Verified live**: joined a call, turned the camera on (confirmed
     exactly 1 video tile), then off (confirmed the tile count drops to
     0 with zero stale tiles remaining, and no leftover "(camera)"-
     labeled element anywhere) — the exact repro from the bug report,
     now clean.

163. [x] **UX ask**: "In the 'sidebar-header' the icons should just be
     right aligned like every else in the app (currently evenly spread
     out), while the channel name remains left aligned." Root cause:
     `.sidebar-header` used `justify-content: space-between` directly
     on itself with *six* flex children (the name plus five icon
     buttons) — `space-between` spaces every adjacent pair evenly,
     which for more than two children spreads the buttons apart from
     *each other* too, not just the whole group away from the name.
     Fixed the same way `.channel-header-right` already solves this
     for the channel header: wrapped the icon buttons in a new
     `.sidebar-header-right` div with `margin-left: auto`, matching the
     app's existing pattern exactly rather than inventing a new one.
     **Verified live**: confirmed via bounding-box measurement that the
     icon group sits flush against the header's right edge and the
     channel/DM name stays flush against the left edge.

164. [x] **UX ask**: "If you 'pop out' a chat window, then it leaves
     behind a black square saying 'Playing in picture-in-picture'. This
     seems wasteful. Why not just have the black box disappear and
     then have only the pop out? Also is it possible to have multiple
     pop outs? E.g. one with me, one with my friend and one with the
     window/screen share?"
     - **The black square**: that text is the browser's *own* native
       Picture-in-Picture indicator, painted directly over the
       original `<video>` element — not something this app renders or
       can restyle away. The tile it belongs to was otherwise still
       sitting in the grid the whole time, showing that native overlay
       over what's now a dead, dark rectangle duplicating the floating
       window's own content. Fixed by hiding the *entire tile* (new
       `.tile-in-pip` class, toggled by new `enterpictureinpicture`/
       `leavepictureinpicture` listeners in `wirePipCollapse`) for as
       long as its video is genuinely the one popped out, and having
       it reflow back into the grid the moment the window closes.
       `layoutVideoTiles`'s tile count and `ensureVideoTilesVisible`'s
       panel-visibility check both explicitly exclude a tile in this
       state, so the grid math doesn't reserve dead space for it (a
       naive `display: none` alone wouldn't have fixed that part) and
       popping out your *only* video doesn't leave the whole panel
       sitting there empty either.
     - **Multiple simultaneous pop-outs**: this one's a real browser
       platform limit, not something fixable from this app's code —
       `HTMLVideoElement.requestPictureInPicture()` is specified (and
       implemented, in every current browser) to allow only *one*
       Picture-in-Picture window per tab; calling it again while one's
       already open moves the floating window to the new video instead
       of opening a second one alongside it. The newer Document
       Picture-in-Picture API has the same one-window-per-tab limit in
       its current Chrome implementation. There's no standard web API
       today that would let three tiles (you, a friend, a screen
       share) each float in their own simultaneous window — flagging
       this honestly rather than half-implementing something that
       can't actually deliver what was asked.
     **Verified live** with real Picture-in-Picture (this headless
     sandbox's Chromium build does support it, which wasn't a given):
     confirmed the tile is visible before popping out, confirmed
     `document.pictureInPictureElement` is genuinely set and the tile
     hides itself the moment PiP engages, and confirmed exiting PiP
     (`document.exitPictureInPicture()`) brings the tile — and the
     whole panel, when it was the only one — back.

Full pipeline: `cargo build/clippy --workspace` clean (no backend
changes this batch). `npx tsc --noEmit`, `npx vite build`, both clean.
Redeployed via `docker compose -f docker/docker-compose.yml up -d
--build`; confirmed `chatly-chatly-1` up, HTTP port still
`127.0.0.1`-only, `chatly-coturn-1` still up, clean startup logs (no
migration, frontend-only change), and
`https://chatty.ebbemonster.dk/` serving the new bundle. Cleaned up the
scratch instance, cookie jar, and Playwright scripts used for testing.

### Batch 46 — 2026-09-17 (PC control-bar polish: profile chip opens Settings, no more icon crowding, drag the camera overlay instead of picking a corner from a menu)

158. [x] **UX ask**: "We don't need the settings button, as we can just
     instead make the profil icon open those settings. This leaves
     more room." Removed the standalone gear button from the sidebar-
     footer entirely. `.user-chip` (the avatar + name/username block)
     is now itself a real `<button>` with `title="Settings"`, wired to
     the same `openSettings()` the gear button used to call (extracted
     into its own named function so the command palette's "Open
     settings" action still works too, now calling `openSettings`
     directly instead of `settingsBtn.click()`). `.user-chip` picked up
     button-reset CSS (no default border/background/font) plus a
     `:hover` background, since it needed to actually read as clickable
     once it stopped being an inert `<div>`.
     **Verified live**: confirmed the footer now has exactly 4
     `.icon-button`s (mic/deafen/camera/screen, no gear), confirmed
     `.user-chip` is a `<button>` element, and confirmed clicking it
     opens the Settings modal.

159. [x] **UX ask**: "Current icons slightly overlap when hovering over
     them. I don't want overlapping icons." Root cause: `.footer-
     buttons`'s `gap` was `0.1rem` (~1.6px) — fine back when it only
     held 2-3 buttons, but with the round 30px hover backgrounds now
     representing 4 controls (mic/deafen/camera/screen, see batch 45),
     that sliver of a gap meant hovering one button's circular
     highlight visually touched its neighbor's. Bumped the gap to
     `0.3rem`.
     **Verified live**: confirmed via `getComputedStyle` that the
     footer's gap is now 4.8px (0.3rem), not the previous ~1.6px.

160. [x] **UX ask**: "It is nonsense that you have to go to the Devices
     menu and pick these items: 'Video / Camera overlays the screen
     share / Camera overlay position' Why not just make it possible to
     drag the position of the webcam around yourself? That puts the
     controls where you need them." Removed the "Camera overlay
     position" corner picker (a `<select>` with 4 fixed choices) from
     Settings > Devices > Video entirely, and replaced it with actually
     dragging the camera-overlay bubble around with the mouse, directly
     on the video tile itself.
     - `video-prefs.ts`: `cameraPipCorner: PipCorner` (one of 4 fixed
       values) replaced with `cameraPipPosition: { xPct, yPct } | null`
       — `xPct`/`yPct` are where the bubble's own top-left corner sits
       between the container's edges (0 = flush left/top, 100 = flush
       right/bottom), not raw percentages of the container — that
       keeps the whole bubble inside the container at *every* value
       and at *every* container/bubble size, with no clamping needed
       wherever this gets read back.
     - New `applyPipPosition`/`wirePipDrag` in `chat.ts`: a standard
       mousedown/mousemove/mouseup drag (the same shape as the
       existing grid-resize-handle and filmstrip-resize-handle drags
       already in this file), live-updating the bubble's `left`/`top`
       while dragging, then converting the final pixel position back
       to a percentage and saving it. A few pixels of movement is
       required before it counts as a drag (rather than an ordinary,
       slightly-jittery click) so an accidental tap can't overwrite a
       deliberately-placed position. One shared position for every pip
       bubble on screen, matching how the single corner setting it
       replaces already worked — dragging any one of them (if several
       people happen to be screen+camera sharing at once) moves all of
       them together, read as "where I like this kind of overlay,"
       not a per-person layout choice.
     - `style.css`: the four `.corner-*` classes (each hardcoding a
       `left`/`right`/`top`/`bottom` combination) are gone — position
       is set directly via inline styles from JS now. Added
       `cursor: grab` (the only visual hint the bubble moves at all)
       and a `.dragging` state with a stronger shadow while actively
       held, the same "picked up" cue a dragged card/window gets.
     - Left the "camera overlays the screen share vs. its own tile"
       toggle in place in Settings > Devices > Video (now the section's
       only control) — that's a structural either/or choice dragging
       doesn't replace, not a position.
     **Verified live**: confirmed the old corner `<select>` no longer
     exists anywhere in Settings; confirmed (by copying the exact
     `applyPipPosition` formula into a DOM+CSS injection test against
     the real served stylesheet, since the real function is a private
     closure not reachable from outside the module) that no saved
     position defaults to the original bottom-right corner, that a
     saved `{xPct:0, yPct:0}` lands the bubble flush against the
     top-left edge, and that `{xPct:50, yPct:50}` lands it exactly
     halfway — the underlying position math is correct at both
     extremes and the midpoint. Actually watching a live mouse-drag
     end-to-end wasn't feasible here (the pip only ever appears when a
     real screen share *and* camera are both active for the same
     person, and headless Chromium has no real display for
     `getDisplayMedia` to capture) — flagging that the drag
     *interaction* itself rides on the same event-listener pattern this
     app's other working drag handles already use, verified correct by
     that resemblance and by the position math above, rather than by
     watching this exact gesture happen live.

Full pipeline: `cargo build/clippy --workspace` clean (no backend
changes this batch). `npx tsc --noEmit`, `npx vite build`, both clean.
Redeployed via `docker compose -f docker/docker-compose.yml up -d
--build`; confirmed `chatly-chatly-1` up, HTTP port still
`127.0.0.1`-only, `chatly-coturn-1` still up, clean startup logs (no
migration, as expected for a frontend-only change), and
`https://chatty.ebbemonster.dk/` serving the new bundle. Cleaned up the
scratch instance, cookie jar, and Playwright scripts used for testing.

### Batch 45 — 2026-09-17 (one set of call controls instead of four, reply quotes actually render markdown and jump to the original, orphaned 1:1 DMs cleaned up for real, Bots section removed)

154. [x] **UX ask**: "I think there are too many repeat controls when
     in a chat, we need just one for mute/unmute sound and microphone.
     How about we place all four in the same sidebar-footer (mic,
     sound, webcam, screenshare)? Then we have the controls for
     maximize/minimize chat and leave call together somewhere else."
     Before touching anything, asked whether mobile (where the
     sidebar-footer lives behind the off-canvas hamburger drawer)
     should keep its own separately-reachable copy or fully consolidate
     too — mobile-specific control bars existed in the first place
     specifically to avoid opening that drawer mid-call. Answer: fully
     consolidate, mobile included, and make the drawer itself quicker
     to reach via a swipe gesture instead.
     There were genuinely **four** separate copies of mic/deafen/
     camera/screen controls before this: the sidebar-footer (mic +
     deafen only), a sidebar `voice-status-bar` (all five, shown while
     connected), a docked `mobile-voice-bar` above the composer
     (mobile-only mirror of the same five), and a floating
     `mobile-call-overlay-controls` bar over the "hide chat" fullscreen
     mobile call view (a 3-button subset) — all four kept in sync with
     `voiceClient` state via parallel arrays of buttons. Consolidated
     to exactly one instance of each control anywhere in the app:
     - **Sidebar-footer** (`web/src/views/chat.ts`): now mic, deafen,
       camera, screen share, then Settings — the standing device
       toggles, reachable the same way whether or not you're even in a
       call. Deleted `mobileMuteBtn`/`mobileDeafenBtn`/
       `mobileCameraBtn`/`mobileScreenBtn`/`overlayCameraBtn`/
       `overlayMuteBtn` and every array that kept them in sync
       (`syncMuteIcons`/`syncVideoIcons`/the click-handler loops) —
       each now just sets the one remaining button directly.
     - **`voice-status-bar`** (sidebar, shown only while connected):
       reduced to the channel-name label plus a single "Disconnect"
       button — the one thing that's actually about *being in this
       specific call*, not a standing device toggle.
     - **`hideChatBtn`** (video-tiles-toolbar): unchanged location —
       already "somewhere else" from the footer, and it only ever
       makes sense once video's on, so it stays tied to the video
       panel rather than moving to the always-present sidebar.
     - Deleted `mobile-voice-bar` and `mobile-call-overlay-controls`
       entirely — both the JS (including the collapsed-pill-that-
       expands-to-controls mechanism) and their CSS. Their removal also
       happens to delete the only `backdrop-filter` rule anywhere in
       the stylesheet (it was on the overlay's buttons) — worth noting
       against the still-open mobile black-video investigation (batch
       42 item 145), since that was the leading theory for its cause;
       not claiming it's fixed without the user's own real-device
       retest, but flagging the coincidence honestly.
     - **New**: swipe-to-close for the mobile hamburger drawer (a
       touchstart/touchmove/touchend handler on `.sidebar`, live-
       following the finger via an inline `transform` while dragging,
       closing past a quarter-drawer-width threshold) — added because
       consolidating everything into the sidebar-footer makes that
       drawer mobile's *only* path to any call control now, so getting
       in and out of it quickly matters more than before.
     **Verified live** on an isolated instance (port 8132): confirmed
     via DOM query the sidebar-footer has exactly 5 `.icon-button`s
     titled "Mute microphone", "Deafen", "Turn on camera", "Share your
     screen", "Settings" in that order; confirmed zero
     `.mobile-voice-bar` or `.mobile-call-overlay-controls` elements
     exist anywhere in the DOM; confirmed the hamburger drawer still
     opens on tap (no regression); confirmed a simulated touch drag
     (touchstart/touchmove/touchend dispatched at a mobile viewport,
     dragging left past the threshold) actually closes the drawer.

155. [x] **UX ask**: "The replies still don't render the markdown. In
     general the quotes stuff in replies don't work so well. It should
     be linkable back to the original massage, and it should render the
     preview properly e.g. in this response in the screenshot the
     markdown latex does not render." (Screenshot showed a reply quote
     literally displaying the raw ` ```latex e^{i\pi} + 1 = 0 ``` `
     source instead of typeset math.)
     Root cause: both places a reply's original content gets previewed
     — the quote shown above a message that's a reply
     (`renderReplyPreview`) and the "Replying to X — ..." banner shown
     while composing a reply (`setReplyingTo`) — ran the content
     through `renderInline`, which only handles single-line inline
     formatting (bold/italic/inline code/links/mentions). Neither ever
     called the full block-aware renderer that actually knows about
     fenced code blocks or `$$.../```latex` math blocks
     (`renderMarkdown`), so a reply quoting anything block-level always
     showed the raw, unrendered source instead. Fixed by switching both
     to `renderMarkdown`. `.reply-quote-text`/`.reply-banner-preview`
     changed from a hard `white-space: nowrap` single-line clamp to a
     `max-height` cap instead — ordinary short text still reads as one
     compact line exactly as before, but a quote whose original message
     was a whole code/math block now degrades gracefully to a clipped
     preview of the real rendered content instead of either breaking
     the one-line layout or (as before) just showing markdown syntax
     as plain text.
     Also added the other half of the ask — "it should be linkable back
     to the original message": a reply quote is now clickable
     (`.reply-quote-link`, only when `reply_to` is present) and calls a
     new `jumpToMessage(messageId)` that scrolls the original message
     into view and briefly flashes its background
     (`.message-jump-highlight`, a 1.2s CSS animation) so it's
     unambiguous which message is the one just jumped to. A no-op (not
     an error) if the original message isn't currently loaded in this
     channel's scrollback — there's no "jump to any message ever sent,
     however old" navigation to fall back to yet, just the same
     history already fetched.
     **Verified live**: posted a real message containing `$$e^{i\pi} +
     1 = 0$$`, replied to it, and confirmed via DOM query that
     `.reply-quote-text` contains a real rendered `.katex` element (not
     the literal `$$` source) and that clicking the quote applies
     `.message-jump-highlight` to the original message. `npx tsc
     --noEmit` clean (also caught and removed the now-fully-unused
     `renderInline` import).

156. [x] **UX ask**: "Also these 'Former Members' keep lingering in my
     direct messages though I asked them to be completely removed."
     (Screenshot showed two DM entries literally labeled "Former
     member" in the sidebar.) Investigated against a read-only copy of
     the actual production database (never the live file) before
     writing any fix, per standing rule for anything touching real
     data. Found the real cause: two of admin's DM channels had exactly
     one `dm_participants` row (admin) left, `is_self_dm = 0`, and zero
     messages ever sent in either — a 1:1 DM whose other side's account
     was hard-deleted by an *earlier* version of `delete_account`,
     before the "also delete the whole 1:1 DM channel outright, not
     just cascade away the departed user's own rows" fix existed
     (added the same day, but as a later deploy). Migration 0018's
     `is_self_dm` backfill — which runs once, and whose own comment
     explicitly assumed "no 1:1 DM has lost a participant to a hard
     delete yet on any existing database" — had already run by the
     time these two accounts were deleted, so it never got a second
     chance to reclassify them; they were left in exactly the
     structural shape the client's `dmLabel`/`dmAvatarEl` fall back to
     rendering as "Former member" for.
     Two-part fix:
     - New migration (`0020_cleanup_orphaned_1on1_dms.sql`): deletes
       any non-guild, non-self-DM channel currently down to fewer than
       2 real participants (nulling `reply_to` on anything pointing
       into it first, the same FK-safe order `delete_account` already
       uses) — a one-time catch-up for exactly this residue, wherever
       and whenever it happened. `delete_account` itself already
       prevents any *new* channel from ending up in this state; this
       only clears out what already exists.
     - Defense in depth on the client (`web/src/views/chat.ts`): both
       places `dms` gets fetched now filter through a new
       `isRenderableDm` (`participants.length > 0` — a self-DM always
       has itself pushed into `participants` server-side, so this can't
       misfire on one), so a conversation in this state is filtered out
       and never rendered at all going forward, regardless of how it
       came to exist — not shown with any placeholder text. Removed the
       now-dead "Former member" fallback strings from `dmLabel`/
       `dmAvatarEl` and a matching dead branch in the composer
       placeholder, rather than leaving an incorrect code path sitting
       there unreachable.
     **Verified against real data, twice** — before *and* after
     deploying, both times via a fresh copy, never the live file: (1)
     confirmed via read-only query that exactly these two specific
     orphaned channels existed and had zero messages; (2) applied the
     new migration to that copy and confirmed both were gone with zero
     side effects (all 4 real users, every legitimate 2-participant DM,
     and every self-DM untouched); (3) after deploying to production,
     re-checked the *live* database and confirmed the same result —
     including catching my own mistake mid-check: a first read copied
     only `chat.db` without its `-wal`/`-shm` files, which (SQLite's
     WAL mode) showed a stale pre-migration snapshot and briefly looked
     like the fix hadn't applied; copying all three files together
     showed the real, correctly-migrated state. `cargo build/clippy/
     test --workspace` clean (40 + 9 passed) both before and after.

157. [x] **UX ask**: "For now just remove the whole 'Bot' section, we
     will get to that later when all core functionality is
     implemented." Removed the "Bots" tab from the Manage Server modal
     (`web/src/views/guild-settings.ts`) — the tab entry, the
     now-unused `renderBotsSection` function, `"bots"` from the `Tab`
     type, and the now-unused `CreateBotResponse` import. Scoped to the
     UI entry point only, per "we'll get to that later" — the backend
     routes (`/api/guilds/:id/bots`, token creation/revocation),
     `bot_tokens` table, and everything else bot-related are untouched
     and still fully functional via the API directly; there's just no
     button to reach them from right now.
     **Verified live**: confirmed via DOM query that no "Bots" entry
     appears anywhere in the Manage Server modal's nav. `npx tsc
     --noEmit` clean.

Full pipeline for all four items: `cargo build --workspace`, `cargo
clippy --workspace --all-targets`, `cargo test --workspace` (40 + 9
passed) — run twice, once before the live production-data migration
test and once after, both clean. `npx tsc --noEmit`, `npx vite build`,
both clean. Redeployed via `docker compose -f docker/docker-compose.yml
up -d --build`; confirmed `chatly-chatly-1` up, HTTP port still
`127.0.0.1`-only, `chatly-coturn-1` still up, clean startup logs
(`applying migration version=20`, no errors), and
`https://chatty.ebbemonster.dk/` serving the new bundle. Cleaned up
every scratch instance, database copy, and Playwright script used
during testing.

### Batch 44 — 2026-09-17 (screen-share camera overlay controls, prompt voice-timeout cleanup, self-healing renegotiation, "Invite to Voice" actually lands in voice, echo investigation)

149. [x] **UX ask**: screen-share camera overlay — "a) Choose the
     position of your own webcam if shared (right now it is always in
     the bottom right). b) In full screen mode your own webcam (if on)
     disappears, which it shouldn't. c) If your webcam is on you can
     choose if it should even appear on top, or if it should just
     appear in a separate window like everything else."
     - **(a) Corner position**: new `web/src/video-prefs.ts`
       (localStorage, same pattern as `audio-prefs.ts`) adds
       `cameraPipCorner`, a per-viewer preference with 4 values, picked
       from a new "Video" section in Settings > Devices (a `<select>`,
       consistent with the existing device pickers there rather than a
       bespoke corner-picker widget). `web/src/style.css` gained
       `.video-tile-pip.corner-{top,bottom}-{left,right}` rules;
       `renderVideoTile` (`chat.ts`) re-syncs the pip's corner class on
       every render (not just when first created), so changing it in
       Settings mid-call takes effect on the next render, not just the
       next call.
     - **(b) Camera vanishing in fullscreen**: root cause — the
       fullscreen button targeted the bare main `<video>` element
       (deliberately, per batch history: fullscreening the whole tile
       used to visibly corrupt the decoded frame, since the tile is a
       CSS grid item with inline `grid-column`/`grid-row` placement
       from `layoutResizableGrid` that fights the browser's own
       fullscreen sizing). But the camera pip is a *sibling* of that
       bare video, not a descendant — the Fullscreen API only renders
       the target element and its descendants, so the pip simply never
       appeared once fullscreen engaged. Fixed by introducing a new
       `.video-tile-media` wrapper `<div>` that holds *only* the main
       video and the pip (nothing else from the tile — no grid
       placement, no label, no controls), and fullscreening *that*
       instead. It carries the pip along for the ride like the old
       working real fix, and has no grid/flex placement of its own to
       conflict with the browser's fullscreen sizing, unlike the
       original tile-fullscreen attempt.
     - **(c) Overlay vs. separate tile**: new `cameraPipEnabled`
       preference (same Settings section, a toggle-slider) — when off,
       a person's camera renders as its own independent grid tile
       instead of a pip overlay, exactly like any other participant's
       video. Implemented via `videoTileKeyFor()` in `chat.ts`: camera
       frames route to a distinct internal tile key (the person's key
       plus a NUL-separated "camera-tile" suffix) instead of sharing
       the person's main key, whenever the preference is off — screen
       share always keeps the base key, so only the camera ever splits
       off. This reuses the *entire* existing single-purpose tile
       rendering path unchanged (no new pip-specific branch needed):
       each split key's `streams` object can now only ever hold one of
       {camera, screen}, so `renderVideoTile`'s existing "both present
       -> pip" check simply never fires for either half. `renderVideoTile`
       gained a separate `personKey` parameter (distinct from the
       tile's own key) threaded through to wherever a tile's identity
       must stay tied to the *person* regardless of which tile they're
       in — the mic/screen-audio volume sliders, and the "hide these
       controls entirely on your own tile" check.
     - **Known scope limit, not fixed this batch**: the mobile
       full-screen call view's "exactly 2 tiles -> you're a corner
       bubble, they fill the screen" layout (`pip-pair`, batch 39/41)
       identifies "you" by the literal tile key `"self"` — with
       `cameraPipEnabled` off *and* both a screen share and camera
       active at once on mobile, your camera tile's key is no longer
       exactly `"self"`, so that specific (mobile + screen-share +
       camera + separate-tile-preference, all four at once) combination
       won't get the bubble treatment correctly. Judged acceptable
       given how rare that exact combination is; flagging here rather
       than silently leaving it undocumented.
     **Verified live** on an isolated instance (port 8130, freshly
     built binary — an earlier, *stale* instance from a previous
     testing round was still holding the port and had to be killed
     first, confirmed via `ps`/checking its logs lacked this batch's
     changes before trusting any test result against it): Settings >
     Devices now shows a "Video" section with the corner `<select>`
     and the overlay/separate-tile toggle (confirmed via DOM query, not
     just visually); confirmed a raw DOM+CSS injection of the exact
     markup `renderVideoTile` produces (a tile containing a media
     wrapper containing a main video and a pip video tagged
     `corner-top-left`) resolves to `position:absolute; top:8px;
     left:8px` (0.5rem) against the actual served stylesheet — the
     corner CSS is real and correct, not just present in source;
     confirmed turning on just a camera (no screen share) still renders
     exactly 1 tile regardless of the new preference (no regression to
     the common case). Real screen capture (`getDisplayMedia`) has no
     display to actually share in a headless sandbox, so the
     fullscreen-with-pip fix (b) is verified structurally (the pip is
     now provably inside the exact element that gets fullscreened)
     rather than by watching a real fullscreen transition — flagging
     that distinction rather than glossing over it.

150. [x] **UX ask**: "If a connection is dropped the user still lingers
     in the chat, which shouldn't be the case. They should leave both
     in their own device and in the group device." Root cause: two
     *independent* systems both track "who's in this voice call," and
     only one of them was ever told about an SFU-detected timeout. The
     voice SFU (`crates/server/src/voice/mod.rs`) already declares a
     connection dead after `ICE_DISCONNECT_GRACE` (15s) of no live ICE
     — but that only tore down *media* forwarding. The separate
     presence system other users' sidebars actually read from
     (`GatewayHub::voice_presence`, published as `VOICE_STATE_UPDATE`)
     is normally updated by the *departing client's own* gateway
     connection — either an explicit "I'm leaving" message, or that
     connection closing. If the network dies asymmetrically (WebRTC
     media dies well before the gateway WebSocket notices — its own
     heartbeat timeout is a full 60 seconds, four times longer than the
     SFU's own 15s grace), nothing told the *other* participants' UIs
     anything for up to that whole extra window: their sidebar, their
     video tile, everything kept showing that person as still present
     and connected, media included, well after the SFU itself had
     already given up on them.
     Fixed by giving the SFU a handle to `GatewayHub` (now constructed
     before, and handed into, `voice::spawn` — see `main.rs`) and
     having it publish `VOICE_STATE_UPDATE { connected: false }` (and
     clear presence) itself, immediately, the moment its own
     `ICE_DISCONNECT_GRACE` timeout actually fires — not up to 45
     seconds later when the gateway's own, much coarser heartbeat
     timeout might separately notice. `VoiceCommand::Offer` now also
     carries the channel's broadcast `room_id` (computed once, where
     it's already known, in `gateway::handle_voice_state_update`) so
     the SFU can publish to the right room without needing to resolve
     a channel back to its guild itself — it has no other way to do
     that. A one-shot `timeout_published` flag on `VoiceClient` guards
     against re-publishing the same "left" event on every remaining
     tick before `rtc.is_alive()` actually flips false (str0m's own
     disconnect isn't necessarily instantaneous). The client's existing
     `VOICE_STATE_UPDATE` handler (`chat.ts`) already did the right
     thing on receiving this — clears the sidebar entry, tears down the
     video tile, plays the "someone left" sound — it just needed the
     event to actually arrive promptly; no client-side change was
     needed for this part.
     **Verified**: `cargo build --workspace`, `cargo clippy --workspace
     --all-targets` (clean), `cargo test --workspace` (40 + 9 passed,
     no regressions). Genuinely simulating the exact failure mode this
     fixes — a gateway WebSocket that stays open while only the WebRTC
     media dies — needs selectively killing UDP traffic without
     touching TCP, which isn't something achievable from browser
     automation (Playwright has no network-partition primitive at that
     level) inside this sandbox. Verified instead by code review
     against the existing, already-proven-correct sibling pattern
     (`clients.retain(|_, c| c.rtc.is_alive())` pairing with
     `rtc.disconnect()`, the same shape this reuses) and by confirming
     the ordinary join/leave/presence path still works end-to-end live
     (see item 152's test, which exercises real join/leave and
     confirms the sidebar participant list updates correctly). Flagging
     the untested exact scenario honestly rather than claiming a live
     reproduction that didn't happen.

151. [x] **UX ask**: "There is some issue if one person's connection is
     dropped, then reentering the chat doesn't work. Both users have to
     reenter. This design does not make sense. Only the one with the
     dropped connection should need rejoining." Investigated the SFU's
     renegotiation protocol closely: it deliberately serializes
     renegotiation per client (won't send a second offer until the
     first is answered — `VoiceClient::negotiate_if_needed`'s `pending`
     check). That means if a client's answer to a server-sent offer
     *never arrives* — a stray exception during
     `setRemoteDescription`/`createAnswer`/`setLocalDescription` on the
     client, which `handleServerUpdate` (`voice.ts`) didn't guard
     against at all — that client's negotiation gets stuck forever:
     the server just keeps waiting for an answer that's never coming,
     and *no* further track add/remove for *anyone else* in the call
     can ever reach that client again. Concretely: this is the
     mechanism behind "someone's connection drops, and now the other,
     perfectly fine person also has to leave and rejoin before
     anything works again" — the person who gets stuck in this failure
     mode is whoever's negotiation glitched, which in practice is often
     the person whose connection *didn't* drop (the one whose peer
     connection is left trying to renegotiate around the departure).
     Only a full rejoin (which sends a fresh offer, resetting that
     client's state on the server from scratch — see
     `apply_command`'s `Offer` handling) ever cleared it, and nothing
     told the user that was even the fix needed.
     Fixed by wrapping `handleServerUpdate`'s body in a try/catch: on
     any failure, it now automatically calls `this.join(this.channelId)`
     itself — the same self-healing a manual leave-and-rejoin already
     did, just automatic and scoped to only the side that actually
     broke, with no user action needed.
     **Verified**: `npx tsc --noEmit` clean. Deliberately fault-injecting
     a real SDP negotiation failure to reproduce the exact original bug
     wasn't attempted — that needs corrupting a genuine WebRTC
     negotiation in flight, not something feasible to stage reliably
     from outside the browser's own WebRTC stack. This is a defensive
     fix verified by code review (the failure path now can't leave a
     client's negotiation permanently wedged, whatever specifically
     triggers it) rather than by reproducing the original bug and
     watching it recover — flagging that distinction rather than
     overclaiming.

152. [x] **UX ask**: "The 'Invite to Voice' takes people to the wrong
     channel. They instead end in the text channel, though they should
     land in the voice channel." Root cause: landing on an invite's
     destination channel (`chat.ts`'s post-login routing) explicitly
     special-cased voice channels to *not* select them — "joining a
     voice channel automatically on landing would be surprising," per
     the comment there, written before this specific feature (a link
     whose *entire point*, and own on-screen promise ("Recipients will
     land in" the voice channel), is to bring someone straight into a
     call) existed. That comment's premise no longer holds for this
     specific entry point: the invite modal already told the recipient
     exactly where they'd land before they ever clicked it, so landing
     anywhere else (silently, on some unrelated first text channel,
     with no indication the voice channel even existed) broke a
     promise the app itself made, not "surprised" anyone. Fixed by
     joining the voice call directly when an invite's destination
     channel is a voice channel, matching the DM-invite flow which
     already does the equivalent thing.
     **Verified live**, end-to-end, via the real UI (not curl/API
     shortcuts): on the isolated instance from item 149, created a
     real "Invite to Voice" link as one user, followed it cold as a
     brand new second user (logged out, registering fresh through the
     actual invite-redemption flow), and confirmed via DOM query that
     the new user lands with `.channel-item.voice.voice-connected`
     already present — genuinely joined the call, not just viewing the
     channel — and that the *inviting* user's sidebar shows exactly one
     voice participant row for them moments later. Cleaned up: killed
     the port-8130 instance and its scratch data dir, removed the
     Playwright scratch scripts.

153. [ ] **UX ask**: "There are some serious issues with echo when two
     devices are close by. Even if I mute one microphone, it explodes
     the sound. There is some mic sound still coming through, which
     should NEVER be the case if muted!" Investigated thoroughly before
     writing any code, since this is a strong, specific correctness
     claim: traced the actual outgoing audio path in `voice.ts`
     end-to-end. Muting sets `track.enabled = false` on the *raw*
     microphone track; that raw track feeds a `MediaStreamAudioSourceNode`
     which feeds the gain node whose output (`processedStream`) is what
     actually rides the peer connection — and per the Web Audio spec, a
     disabled `MediaStreamTrack` feeding a `MediaStreamAudioSourceNode`
     produces true silence into the graph, not "the track stops" or
     "the last frame repeats." Confirmed every path that (re)creates the
     raw track (`join()`, `switchInputDevice()`) correctly re-applies
     the current mute state to the *new* track every time, so a mute
     surviving a rejoin/device-switch isn't the gap either. Found no
     code path where muting fails to silence the actual outgoing audio.
     Leading theory instead: acoustic feedback between two nearby
     *physical* devices — a well-known limitation of any video-call
     app (Zoom/Meet/Discord included), not specific to this one. Each
     device's echo cancellation (`echoCancellation: true`, already on)
     can only cancel *that device's own* speaker output from *that
     device's own* mic; it has no reference signal for a *different*
     physical device's speaker sitting a few feet away, so that sound
     still gets picked up and re-transmitted, potentially looping
     through whichever devices in the room are still unmuted or still
     have their own imperfect echo cancellation — genuinely capable of
     escalating ("exploding") the way a PA system howls, independent of
     whether any *one* specific mic is muted, if the loop has another
     path through a different unmuted or imperfectly-cancelling device.
     **Left open, not fixed** — did not want to ship a guess at a
     physical-acoustics problem without confirming it's not something
     else first. Need from the user before proceeding: did an alert/
     error popup ever appear when this happened; was it specifically
     *after* pressing mute (not before); and does the same thing happen
     wearing headphones (which would rule out the acoustic-feedback
     theory entirely, since headphones remove the device-to-device
     speaker/mic coupling that theory depends on).

### Batch 43 — 2026-09-17 (drop the "Add a server" boilerplate copy; a "Members" header in Manage Server)

147. [x] **UX ask**: "Remove this text: 'Your server is where you and
     your friends hang out. Make yours and start talking.'" Removed
     the `<p class="muted-text">` intro entirely from the "Add a
     server" modal's choice step (`web/src/views/servers.ts`,
     `renderAddServerModal`) — just the two buttons ("Create a
     server" / "Join a server") now, no boilerplate copy above them.
     **Verified**: confirmed via `curl` against the live production
     JS bundle that the string no longer appears anywhere in it.

148. [x] **UX ask**: "In a Server menu, we need to add an extra header
     here: Members / Invites / Anyone can create invites / Admin /
     Admin / Owner. We already have 'INVITES', and we after the
     toggle also need 'MEMBERS'." The Manage Server modal's Members
     tab (`renderMembersSection`, `web/src/views/guild-settings.ts`)
     already wrapped the invite-policy toggle in a `section("Invites",
     ...)` (giving it the "INVITES" heading, styled uppercase via
     CSS), but the member list right below it was appended as a bare
     `<div>` with no heading of its own — so the list ran on directly
     under the invites toggle with nothing marking where "Invites"
     ends and the member list begins. Wrapped that same list in
     `section("Members", list)`, matching the existing heading style
     exactly (same `<h3>`/`.settings-section` markup the "Invites" and
     every other Manage Server section already use).
     **Verified**: confirmed via `curl` against the live production JS
     bundle that the `"Members"` heading string is now present.
     Full pipeline for both items (frontend-only, no migration): `npx
     tsc --noEmit` (clean), `npx vite build` (clean). Redeployed via
     `docker compose -f docker/docker-compose.yml up -d --build`;
     confirmed `chatly-chatly-1` up, HTTP port still `127.0.0.1`-only,
     `chatly-coturn-1` still up, `https://chatty.ebbemonster.dk/`
     serving the new JS bundle, clean startup logs.

### Batch 42 — 2026-09-17 (real per-participant volume sliders; the mobile black-video regression is still open)

145. [ ] **UX ask**: "I just tested on mobile and it still doesnt show
     the video!" — a direct contradiction of batch 41 item 143's fix,
     which was real (it did fix a genuine `.self`-key bug) but
     evidently not the only thing wrong, since the user's real device
     still failed after that fix shipped. Confirmed the batch 41 build
     was actually live in production (bundle hash matched the local
     `dist/` output byte-for-byte) before looking for a second cause,
     to rule out a bad deploy first.
     Asked the user targeted diagnostic questions rather than guessing
     a third time blind, since headless Chromium simulation had
     already been shown once not to reproduce this real-device-only
     bug. Their answers narrowed it down significantly:
     - Tapping the camera button shows a correctly positioned,
       correctly labeled tile ("You", and remote participants' real
       names) — meaning the batch 41 layout/positioning fix **is**
       working correctly. The tile itself is just solid black instead
       of showing a picture.
     - This happens for **both** the local self-preview and every
       remote participant's video uniformly, which rules out a
       per-stream getUserMedia or WebRTC-negotiation problem for any
       one person specifically (a purely local camera-preview
       black-out wouldn't need the network at all, and it's failing
       identically to the remote tracks too).
     - Not yet confirmed whether it also happens with chat visible
       (not just the new "hide chat" full-screen call view), or
       whether Brave's Shields (fingerprinting/WebRTC protections) are
       a factor — the user hadn't checked Shields yet when this batch
       ended.
     Working theory going in: a GPU-compositing black-video bug on
     Android Chromium-based browsers, possibly triggered by the
     `backdrop-filter: blur()` added in batch 39 for the new floating
     mobile call controls (`.mobile-call-overlay-controls
     .icon-button`) — a documented class of bug where `backdrop-filter`
     on a nearby/overlapping element forces a compositing layer that
     can make an adjacent `<video>` render black on some Android GPU
     drivers, which would explain why this is new (batch 39 introduced
     the only `backdrop-filter` use in the whole stylesheet), why it
     hits every stream at once (page-wide compositing effect, not a
     per-stream data issue), and why headless/software-rendered
     Playwright wouldn't reproduce it. **Not yet applied or verified**
     — this is a hypothesis to test next, not a fix. Leaving this item
     open rather than claiming a fix again without real-device
     confirmation, per the standing rule.

146. [x] **UX ask**: "The 'voice-participant-volume' slider does not
     go all the way to the left or right, it can only be moved a
     little back and forth in the center of the slider." Root cause:
     the global `input, textarea, select { padding: 0.7rem 0.85rem;
     border: 1px solid var(--border); }` rule (`web/src/style.css`,
     meant for text fields) was also applying to every
     `<input type="range">`, with no exception carved out. Combined
     with the site-wide `* { box-sizing: border-box; }` reset, that
     padding+border is counted *inside* a range input's declared
     width rather than added outside it — so for
     `.voice-participant-volume` (`width: 3.5rem` = 56px, in the voice
     channel sidebar's per-participant list), the real content box
     (where the track actually lives) was squeezed down to roughly
     27px after subtracting ~27px of padding and 2px of border. The
     default browser thumb (~16-20px wide) barely fit inside that
     shrunken track, so its usable travel distance was only a few
     pixels, positioned near the middle of the visibly-56px-wide
     element — exactly the "only moves a little in the center, can't
     reach either end" symptom reported. The same rule affects every
     other range slider in the app to some degree (cropper zoom,
     modal volume rows, per-tile volume in the video grid), just less
     visibly on wider ones where the padding is a smaller fraction of
     the total width.
     Fixed by adding a dedicated `input[type="range"] { padding: 0;
     border: 0; background: none; }` override right after the
     text-field rule, since a range input renders its own native
     track/thumb and never needed textbox-style chrome in the first
     place.
     **Verified**: confirmed the built CSS (`dist/assets/index-*.css`)
     contains the new `input[type=range]{padding:0;border:0;
     background:none}` rule and no longer inherits the text-field
     padding/border; confirmed via `npx tsc --noEmit` (no TS touched,
     clean) and `npx vite build` (clean) before deploying. A live
     Playwright box-model/drag check was attempted but blocked by a
     missing system library (`libnss3.so`) for headless Chromium in
     this sandbox — not worked around by installing OS packages
     without being asked first; verification instead rests on the
     deterministic CSS box-model arithmetic above (removing the
     padding/border that was eating the content box directly removes
     the cause) plus confirming the exact fixed rule is present in the
     bundle actually being served in production.
     Redeployed via `docker compose -f docker/docker-compose.yml up -d
     --build` (frontend-only change, no migration — confirmed clean
     startup logs); confirmed `chatly-chatly-1` up, HTTP port still
     `127.0.0.1`-only, `https://chatty.ebbemonster.dk/` serving the new
     `index-UJlgW5ve.css` bundle, and `curl`-fetched that live file to
     confirm the fixed rule is exactly what's being served (not just
     what was built locally).

### Batch 41 — 2026-09-16 (a real mobile-video regression fixed, and adjustable borders between video tiles on PC)

143. [x] **UX ask**: "We cannot see our own video / We cannot see
     other peoples video [on mobile], but on the computer we can see
     the video from both." Root-caused to a real regression in the
     immediately preceding batch's mobile call redesign (batch 39):
     `layoutVideoTiles` (`web/src/views/chat.ts`) tagged which grid
     tile was "self" for the new self-camera-PiP layout by comparing
     `tile.dataset.videoKey === user.id` — but the local camera/
     screen tile is always keyed by the literal string `"self"` (see
     `voiceClient.onLocalVideo`), never by the user's actual numeric
     id, so that comparison never matched anything. Neither tile ever
     got the `.self` class, so on a phone with chat hidden and exactly
     two people in the call, `.pip-pair`'s CSS (both tiles get
     `width:100%; height:100%`, with `.self` supposed to be the one
     that switches to an absolutely-positioned corner bubble instead)
     applied to *both* tiles identically — two 100%-height blocks
     stacking vertically instead of one filling the screen and the
     other floating over a corner of it, pushing the second tile
     below the viewport entirely. Fixed by comparing against the
     literal `"self"` key instead of `user.id`.
     **Verified live** on an isolated instance (port 8127) with two
     real WebRTC peers (fake camera devices) at a mobile viewport:
     before the fix, direct DOM inspection showed one tile's bounding
     rect positioned below the viewport's bottom edge (y ≈ viewport
     height, both tiles at 100% height stacked); after the fix, both
     the normal "chat visible" grid and the new "chat hidden" pip-pair
     layout show both tiles' `<video>` elements with correct
     positions, real dimensions, and `readyState: 4` (actual frame
     data flowing, not just present in the DOM).

144. [x] **UX ask**: "for PC, the borders between the videos should be
     adjustable, just like they are between video and chat, as well
     as between video and the server bar." A new feature:
     `layoutResizableGrid` (`web/src/views/chat.ts`) inserts thin
     draggable resize handles between every adjacent pair of columns
     and rows in the video grid (2+ people, not focused/spotlighted),
     each handle spanning the grid's opposite axis so dragging one
     boundary moves it for every row/column at once — the same
     spreadsheet-style interaction the existing video/chat and
     filmstrip resize handles already use, just generalized from one
     fixed split to a full grid. Sizes are tracked as CSS `fr` units
     (`videoColFractions`/`videoRowFractions`), reset to an equal
     split whenever the grid's shape changes (someone joins/leaves and
     the column or row count changes). Desktop-only, hidden via CSS at
     the existing mobile breakpoint like the other resize handles — a
     phone call uses the fixed self-camera-PiP layout or a full-bleed
     grid instead, neither of which has a boundary to drag.
     - **A real bug caught and fixed *during* this work, not shipped
       and found later**: a naive first version gave each column
       handle `grid-row: 1 / -1` (full height) and each row handle
       `grid-column: 1 / -1` (full width) — which cross paths exactly
       at every interior grid intersection, and whichever one is later
       in the DOM silently wins the pointer there. Confirmed live:
       grabbing a column handle at exactly the row boundary dragged
       the row instead, doing nothing to the column at all. Fixed by
       splitting each boundary into one segment per row/column it
       crosses (every segment for the same boundary shares the same
       drag index, so grabbing *any* segment resizes the same
       boundary) — column-handle segments only ever occupy data-row
       tracks, row-handle segments only ever occupy data-column
       tracks, so they no longer share a cell at all. This removes the
       ambiguity structurally instead of just picking a winner.
     **Verified live** on the same isolated instance with three real
     peers: confirmed a 3-person call renders a 2x2 grid with 2
     column-handle segments and 2 row-handle segments (up from 1 + 1
     full-span handles before the intersection fix); confirmed
     dragging a single column-handle segment resizes that whole column
     proportionally across *both* rows at once (the top-left and
     bottom-left tiles — same column — grew together while the
     top-right tile shrank, exactly like a spreadsheet column resize);
     confirmed the same for a row drag; confirmed via screenshots that
     the visual result matches on both drags; confirmed the new handle
     elements are correctly `display: none` and invisible in both the
     normal mobile grid and the new mobile pip-pair/chat-hidden view
     (a real risk worth checking specifically, since `.pip-pair`
     switches the container from `display: grid` to `display: block`,
     which would otherwise turn the handle divs into stray visible
     bars rather than harmlessly do nothing).

     Cleaned up after testing: killed the port-8127 instance, removed
     `/tmp/chatly-mobilevid-data`, `/tmp/chatly-mobilevid.log`, three
     scratch cookie jars, and the Playwright test scripts/screenshots.
     Full pipeline clean before deploy (frontend-only change): `cargo
     build --workspace`, `cargo clippy --workspace --all-targets`,
     `cargo test --workspace` (40 + 9 passed), `npx tsc --noEmit`,
     `npx vite build`. Redeployed via `docker compose -f
     docker/docker-compose.yml up -d --build`; confirmed
     `chatly-chatly-1` up with the HTTP port still bound to
     `127.0.0.1:8090` only, `chatly-coturn-1` still up,
     `https://chatty.ebbemonster.dk/` returns 200, and startup logs
     are clean (no migration this batch, as expected for a
     frontend-only change).

### Batch 40 — 2026-09-16 (deleted accounts leave no trace in DMs; a real "leave a server" with a choice)

140. [x] **UX ask**: "when deleting a user, they should not stay around
     as 'Deleted User'. Actually lets not have this anonymous messages
     staying around. Lets remove them entirely everywhere" — a direct
     follow-up to batch 38, refining it with four specific rules once
     that batch's "Former member" placeholder for a departed 1:1 DM
     turned out to still read as exactly the leftover-identity problem
     the whole feature was meant to solve.
     - **"All direct chats should disappear (it should not say 'Former
       Member')"**: `Storage::delete_account`
       (`crates/server/src/storage/sqlite.rs`) now finds every 1:1 DM
       (not a self-DM, not a group — exactly 2 `dm_participants` rows)
       the departing account was part of and deletes the whole channel
       outright — messages, attachments, participants, gone for both
       sides — instead of leaving a nameless conversation behind. A
       group DM (3+ participants) is untouched by this: it continues
       for whoever's left, with only the departing account's own
       messages in it gone (unconditionally, same as everywhere else).
     - Confirmed (no new code needed, just verified rather than
       assumed) that group-DM and guild-channel messages/reactions by
       a hard-deleted account already vanish entirely under batch 38's
       unconditional erase.
     - **A genuine "leave a server" feature** — there was none before
       (`remove_member`'s own code literally said "not yet built").
       `POST /api/guilds/:id/leave` with `{mode: "erase" |
       "anonymize"}`: the account holder's own choice, distinct from
       being kicked and from deleting their whole account (which has
       no choice to make anymore — always erases everything,
       everywhere). "erase" deletes their messages and reactions in
       that one guild only. "anonymize" leaves messages in place but
       renders them under a generic "Former member" identity for that
       guild only — a new migration
       (`0019_guild_departed_members.sql`: `guild_id, user_id,
       left_at`) and a rewritten `SELECT_MESSAGE`
       (`crates/server/src/storage/queries/messages.rs`) that LEFT
       JOINs it on `(channels.guild_id, author_id)` — and separately
       on a *reply's* author, so a reply preview also shows "Former
       member" correctly when it quotes an anonymized departed
       member — to override the displayed name/avatar at query time
       without ever touching the real `users` row. The join key is
       `channels.guild_id`, so it's a no-op for DM channels: this
       choice only ever exists per-guild, never leaks anywhere else.
       Reactions have no visible per-reactor identity anywhere in this
       app, so there's nothing to anonymize there — they just stay
       under "anonymize," or go with the messages under "erase." The
       owner can't leave at all (transfer ownership first — same
       precondition every other destructive guild action already
       has).
     - **Frontend**: a new "Leave Server" tab in the Manage Server
       modal (`web/src/views/guild-settings.ts`) — red/caution-styled
       exactly like Danger Zone, but the two are mutually exclusive by
       role: owners get Danger Zone, everyone else gets Leave Server.
       Click-to-reveal with the two-option radio choice and the same
       `confirmDialog` pattern used everywhere else in this app, wired
       to the same `removeActiveGuildFromList` handler `chat.ts`
       already used for guild *deletion* (identical client-side
       effect either way — this guild is gone from your list, move on
       — just two different server calls behind it).
     **Verified live**, extensively, on an isolated instance (port
     8125) with a 5-account fixture (owner, alice, bob, carol, dave)
     covering every combination: alice left anonymized — confirmed her
     guild message renders as "Former member," confirmed the reply
     preview on another message quoting hers *also* correctly shows
     "Former member," and confirmed her messages in a separate 1:1 DM
     and a separate group DM both still showed her real name
     untouched (proving the scoping is genuinely per-guild, not
     global); carol left with erase — confirmed her message and her
     own reaction on it were both completely gone, everyone else's
     untouched; the owner was confirmed blocked from leaving with
     exactly the "transfer ownership to someone else first" error; bob
     was then hard-deleted entirely, and his 1:1 DM with the owner
     vanished completely (not present at all — not a placeholder)
     while a separate group DM he was also in continued to exist with
     just his message removed; confirmed alice could still log in
     normally afterward, her real account completely unaffected by
     her own guild-anonymize choice. Frontend verified via Playwright:
     the Leave Server tab only appears for non-owners, the reveal
     panel shows exactly the two radio options with the literal
     wording above, the confirmation dialog's message text changes
     based on which mode is selected, and completing the flow
     correctly navigates away from the now-departed server.

     Since this deploy carries a real schema migration (0019, the
     second one this session to touch live production data shape), it
     was separately validated against a read-only copy of the actual
     production database (copied into scratch, the live file never
     touched) — confirmed it applies cleanly (schema version 18→19)
     and the new table exists afterward; that scratch copy was then
     deleted and the real data directory's file timestamps were
     confirmed unchanged throughout.

     Cleaned up after testing: killed the port-8125 instance, removed
     `/tmp/chatly-leavetest-data`, `/tmp/chatly-leavetest.log`, five
     scratch cookie jars, and the Playwright test scripts/screenshots.
     Full pipeline clean before deploy: `cargo build --workspace`,
     `cargo clippy --workspace --all-targets`, `cargo test --workspace`
     (40 + 9 passed), `npx tsc --noEmit`, `npx vite build`. Redeployed
     via `docker compose -f docker/docker-compose.yml up -d --build`;
     confirmed the startup log shows `applying migration version=19`
     with no errors, `chatly-chatly-1` up with the HTTP port still
     bound to `127.0.0.1:8090` only, `chatly-coturn-1` still up,
     `https://chatty.ebbemonster.dk/` returns 200.

### Batch 39 — 2026-09-16 (mobile call view: full-bleed, floating controls, self-camera PiP)

139. [x] **UX ask**: four reference screenshots (TikTok's Live grid, and
     three Google Duo call screens — 1:1 with a small self-camera
     bubble, a 2x2 group grid, and a reversed 1:1 with the bubble in a
     different corner) with "When implementing how the group chat
     should look on mobile, I would like something like this."
     Interpreted as: the existing "Hide chat" mobile state (an inline
     video panel that already exists — see earlier batches) should be
     redesigned to read as a real phone call screen instead of a
     video-conferencing panel that happens to fill the space: edge-to-
     edge video with no gaps/padding, floating semi-transparent
     circular controls instead of a docked bar, and — the detail that
     actually makes a 1:1 call look like a phone call instead of two
     video-conferencing tiles — the other person filling the whole
     screen with your own camera as a small floating bubble in a
     corner, the same shape every native phone call app uses.
     - **Full-bleed layout**: inside `.content-split.chat-hidden` at
       mobile widths, `.video-tiles` and `.video-tile` lose their
       gap/padding/border-radius, and `.video-tiles-toolbar` (the
       "show chat" toggle) moves from a docked strip to a small
       floating button, top-left.
     - **1:1 self-camera PiP** (`web/src/style.css`'s
       `.video-tiles.pip-pair`): when a call has exactly two people,
       `layoutVideoTiles` in `web/src/views/chat.ts` now tags the
       grid with a `pip-pair` class and marks which tile is your own
       (`.video-tile.self`, compared against the logged-in user's own
       id). At mobile widths with chat hidden, CSS turns that into the
       reference layout: the other person's tile fills the whole
       screen, yours becomes a ~140px rounded floating bubble in the
       top-right corner. Harmless everywhere else — the classes are
       always set (cheap, just two comparisons), but only do anything
       inside that specific CSS scope, so desktop and the normal
       chat-visible mobile view are completely unaffected.
     - **Floating call controls** (`.mobile-call-overlay-controls`): a
       new third set of camera/hang-up/mic buttons — camera and mic on
       the sides, a larger red hang-up centered between them, all
       semi-transparent dark circles with a blur backdrop, floating
       over the bottom of the video — added specifically because
       hiding chat on mobile hides `.mobile-voice-bar` with it (that
       bar lives inside `.chat-column`, which "Hide chat" hides
       entirely), leaving *no* reachable call controls at all in that
       state before this batch — a real functional gap the reference
       images incidentally exposed, not just a cosmetic one. Wired
       into the exact same button-array pattern the existing
       sidebar/mobile/global control sets already use in `chat.ts`
       (e.g. `for (const btn of [voiceMuteBtn, globalMuteBtn,
       mobileMuteBtn, overlayMuteBtn])`) rather than a new mechanism,
       so state (muted, camera-on) and click handling stay in sync
       across all four sets for free. Deliberately only 3 controls
       (camera/hang-up/mic), not the full 5 (also deafen/screen-share)
       — matches the reference's own minimal set, and this is the one
       surface in the app modeled after a phone call rather than a
       conferencing tool; deafen/screen-share stay reachable by
       showing chat again.
     **Verified live** on an isolated instance (port 8124) at a phone
     viewport (390×844): joined a voice channel, then — since getting
     two real WebRTC peers into the same call from a single headless
     browser adds nondeterminism this specific check doesn't need —
     injected synthetic tile elements directly into the live `.video-
     tiles` DOM to exercise the actual shipped CSS/classes against
     known tile counts. Confirmed the 2-participant case renders
     exactly like the reference once chat is hidden (other person
     full-screen, self as a rounded corner bubble, floating camera/
     red-hangup/mic controls at the bottom, show-chat toggle floating
     top-left with no collision against the self bubble); confirmed
     the 3-participant case renders as a full-bleed edge-to-edge grid
     with the same floating controls, matching the Duo group-call
     reference; confirmed the normal chat-visible mobile view (video
     panel above chat, docked `.mobile-voice-bar`) is unchanged when
     chat isn't hidden.

     Cleaned up after testing: killed the port-8124 instance, removed
     `/tmp/chatly-mobilecall-data`, `/tmp/chatly-mobilecall.log`, the
     scratch cookie jar, and the Playwright test scripts/screenshots.
     Full pipeline clean before deploy (frontend-only change): `cargo
     build --workspace`, `cargo clippy --workspace --all-targets`,
     `cargo test --workspace` (40 + 9 passed, confirms nothing
     regressed), `npx tsc --noEmit`, `npx vite build`. Redeployed via
     `docker compose -f docker/docker-compose.yml up -d --build`;
     confirmed `chatly-chatly-1` up with the HTTP port still bound to
     `127.0.0.1:8090` only, `chatly-coturn-1` still up,
     `https://chatty.ebbemonster.dk/` returns 200.

### Batch 38 — 2026-09-16 (a toggle for Invites, and real account deletion — no more "Deleted User")

137. [x] **UX ask**: "For this option: Invites / Anyone can create
     invites / Only the server owner can create invites — Can we make
     it a button of this type instead: toggle-slider." The Manage
     Server → Members tab's invite policy was a 2-option radio group;
     one on/off setting reads more naturally as a toggle, and the app
     already has a toggle-slider component (`.toggle-row`/
     `.toggle-slider` in `web/src/style.css`) used for the Friend
     Requests and MFA settings in the user's own Settings menu.
     Replaced the radio group in `renderMembersSection`
     (`web/src/views/guild-settings.ts`) with the exact same
     checkbox+slider+status-text pattern those two already use — same
     markup, same green-when-on styling, same live status-text update
     on flip, same inline error handling on failure. No new CSS needed.
     **Verified live**: toggle renders correctly in both states (green/
     right when on, gray/left when off), status text updates
     immediately ("Anyone can create invites" ↔ "Only the server owner
     can create invites"), and the underlying `PATCH
     /api/guilds/:id/invite-policy` call still fires exactly as before.

138. [x] **UX ask**: "add that when deleting a user, they should not
     stay around as 'Deleted User'. Actually lets not have this
     anonymous messages staying around. Lets remove them entirely
     everywhere." A deliberate reversal of a considered decision from
     several batches ago (see migration 0015's own comment, which
     explained at the time *why* deletion never removed the `users`
     row outright — several non-cascading foreign keys would need
     resolving first "for no real privacy benefit over the
     alternative"). The user decided there is a real benefit: no
     tombstone account, no messages left behind under an anonymous
     name, anywhere.
     - **`AccountDeletionMode` (Anonymize/Erase) is gone entirely** —
       removed from `models.rs`, `storage/mod.rs`,
       `storage/sqlite.rs`, `api/auth.rs`, `api/admin.rs`,
       `api/current_user.rs`. There's no longer a choice to make:
       deletion always erases every message the account ever sent and
       removes the `users` row itself outright
       (`DELETE FROM users WHERE id = ?1`) instead of the old
       `UPDATE ... SET display_name = 'Deleted User', deleted_at = ...`
       tombstone update.
     - **Five non-cascading foreign keys had to be resolved by hand**
       before that `DELETE` can succeed (SQLite runs with
       `PRAGMA foreign_keys = ON`, so it refuses rather than silently
       corrupting anything if these aren't handled first):
       `files.uploader_id` (avatar, any guild icon set, leftover
       message attachments — deleted, including the actual on-disk
       blob at `data_dir/files/<id>`, a first for this app, which
       never had any file-deletion code path before this), `invites.
       created_by` (their registration invites — deleted),
       `bot_tokens.created_by` (any bot they created — revoked, same
       effect as the existing manual "Revoke token" button; the bot's
       own account survives, just unable to authenticate), `channels.
       created_by` (nullable, audit-only — cleared, the channel
       obviously survives), and `guilds.owner_id` (already resolved by
       the pre-existing `force_guilds` guild-ownership logic from
       batch 32). Everything else referencing the account — guild/
       channel membership, reactions, mentions, DM participancy, pins/
       hides, friendships/requests, sessions, MFA — is `ON DELETE
       CASCADE` and goes with the row for free.
     - **A genuinely serious latent bug turned up while implementing
       this**, not just an edge case to shrug off: `list_dms_for_user`
       identified a self-DM ("note to self") purely by "this channel
       has exactly one `dm_participants` row." That was a safe
       assumption right up until account deletion started actually
       removing the `users` row — because a *real* 1:1 DM can now
       degrade to that exact same shape once the other person is
       hard-deleted. Without a fix, opening what used to be your
       conversation with someone who deleted their account would have
       silently shown it as *your own* self-DM instead — not a crash,
       something worse: quietly wrong data. Fixed with a new migration
       (`0018_self_dm_flag.sql`): `channels.is_self_dm`, set only by
       `create_self` (the one function that ever creates a genuine
       self-DM) and backfilled once for every channel that currently
       has exactly one participant (safe specifically because this
       ships in the same release as hard-deletion — no 1:1 has ever
       lost a participant to a hard delete before now, so "exactly one
       today" still reliably means "always was a self-DM," one last
       time). `find_existing_self` and `list_for_user`
       (`storage/queries/dms.rs`) now check that flag instead of the
       participant count.
     - **Frontend**: a DM whose other participant is gone now renders
       as "Former member" with a neutral person icon
       (`web/src/views/chat.ts`'s `dmLabel`/`dmAvatarEl`/composer
       placeholder) instead of crashing (the old code unconditionally
       indexed `participants[0]`, which is now sometimes genuinely
       empty) — a transient, client-only label, never persisted,
       never shown in the Admin list, nothing like the old tombstone.
       The Admin tab's `deleted: boolean` concept is gone too
       (`AdminUserView` type deleted from `web/src/api.ts`,
       `list_all_users_for_admin` now returns plain `User[]`) since a
       hard-deleted account simply isn't in the list anymore — there's
       nothing left to flag. The Danger tab's Delete Account panel
       shrank from a 4-way radio choice to a plain password field for
       a regular member (nothing left to choose) and a 2-way choice
       for the owner (delete now vs. transfer ownership first, then
       delete).
     **Verified live**, more thoroughly than usual given the risk
     (real hard-deletion, a first-ever file-deletion code path, a live
     schema migration) — on an isolated instance (port 8122): full
     account lifecycle (avatar upload, a message, a reply to it, an
     invite created) followed by admin-deleting the account and
     confirming the avatar file vanished from disk, the account list
     showed zero trace of it, login failed cleanly, the surviving
     reply's `reply_to` was correctly nulled rather than left dangling
     or blocking the delete, and the invite was invalidated. The
     self-DM/departed-DM disambiguation was verified two ways: via
     direct API inspection showing the genuine self-DM kept
     `participants: ["hdowner"]` while the degraded ex-DM correctly
     came back as `participants: []` (not merged or mislabeled), and
     via Playwright confirming the sidebar shows "You" and "Former
     member" as two distinct, correctly-labeled rows with zero page
     errors on click-through. The full owner self-deletion flow
     (delete-without-transferring, which also force-deletes their own
     guild) was run end-to-end through the UI and confirmed via curl
     afterward — login fails, files directory empty. Since this was
     the first change all session to touch live production data
     shape, migration 0018's backfill was separately validated against
     a read-only copy of the actual production database (copied into
     scratch, the live file never touched) — it correctly flagged
     exactly the 4 genuine single-participant self-DM channels among
     12 total DM channels and left every real 2-person DM alone; that
     scratch copy was then deleted and the real data directory's file
     timestamps were confirmed unchanged throughout.

     Full pipeline clean before deploy: `cargo build --workspace`,
     `cargo clippy --workspace --all-targets`, `cargo test --workspace`
     (40 + 9 passed, including the migration-application tests), `npx
     tsc --noEmit`, `npx vite build`. Redeployed via `docker compose -f
     docker/docker-compose.yml up -d --build`; confirmed the startup
     log shows `applying migration version=18` with no errors anywhere
     in it, `chatly-chatly-1` up with the HTTP port still bound to
     `127.0.0.1:8090` only, `chatly-coturn-1` still up,
     `https://chatty.ebbemonster.dk/` returns 200.

     **This is a real, permanent behavior change, not a UI tweak**:
     from now on, deleting any account on this instance — self-service
     or admin-triggered — is genuinely irreversible and leaves no
     trace of that account or its messages anywhere in the database,
     not even an anonymized placeholder.

### Batch 37 — 2026-09-16 (Manage Server / Manage Channel: the real fix, not just the nav color)

136. [x] **UX ask**: "Did you deploy because the 'Manage Server' menu
     still looks horrible" — a direct pushback on batch 36, which only
     fixed the Danger Zone tab's *color* and divider, not the actual
     "looks primitive" complaint. Confirmed the deploy genuinely was
     live (production's served JS hash matched the local build), so
     this meant the fix itself was insufficient, not undeployed.
     - Took real screenshots of "Manage server" side by side with the
       already-redesigned Settings modal to find the actual gap, rather
       than guessing again. Found it was structural: `guild-settings.ts`
       and `servers.ts`'s "Manage Channel" modal both still built their
       shell with a permanent floating `<h2>` title ("Manage server" /
       "Manage #general") sitting above the nav+content split —
       exactly what `settings.ts`'s own shell deliberately removed a
       while ago (see the CSS comment on `.settings-modal`: "No shared
       'Settings' title bar above the nav/content split... is what
       makes the nav a single continuous surface"). Neither modal had
       a nav identity block (icon + name + count) the way Settings has
       one for the user; tab labels were duplicated as redundant
       in-content headings (a "General" tab containing another
       "General" heading); the server-name field was a stacked
       input-then-button instead of Settings' inline editable-field-row
       with a "Saved" flash; Members/Bots crammed unrelated settings
       under one heading instead of separate labeled sections; and,
       most visibly, both modals' Danger Zone tabs were still
       always-open forms driven by the browser's own bare
       `confirm()`/`alert()` — the exact pattern this whole multi-batch
       effort (30 through 36) replaced everywhere else in the app.
     - Rewrote both modals' shells and content from scratch to match
       `settings.ts` structurally, not just color-match one tab: no
       floating title; `.settings-close`/`.settings-nav-identity`
       reused verbatim (guild icon+name+member-count; channel icon+
       name+admin-count); a new `pageTitle()` helper giving every tab
       its own real heading instead of a repeated section h3; the
       server name uses the same inline editable-field-row as Profile's
       display name/username; Members split into "Invites" + the member
       list; Bots split into the roster + a properly-capitalized "Add a
       bot" section; and full click-to-reveal + `confirmDialog`
       treatment for every destructive action — guild transfer-
       ownership, guild delete (still type-the-name-to-confirm, since
       that's already real friction proportionate to deleting an
       entire server), channel delete, and member/bot removal (which
       previously had either zero confirmation or a bare `confirm()`).
     - Found and fixed two real bugs while rewriting, not just
       cosmetics: both files built their nav buttons with
       `nav.replaceChildren(...navButtons)`, which would have wiped out
       the newly-added nav identity block on every single tab switch
       (identity block added once, then erased the moment you clicked
       a tab) — changed to `nav.append(...)`. Separately,
       `servers.ts`'s Manage Channel modal had a leftover duplicate
       `void load()` call at the very end of the function, fetching the
       channel roster twice on every open for no reason — removed.
     **Verified live** on an isolated instance (port 8121): confirmed
     via Playwright/screenshots that both modals now show a nav
     identity block that survives switching tabs, correct per-tab page
     titles with no duplicated headings, an inline Save button next to
     the server name, split Invites/Members sections, a real "ADD A
     BOT" section heading, and click-to-reveal panels for every
     destructive action in both Danger Zones. Ran the actual delete-
     server flow end-to-end: typed the guild's name into the reveal
     panel, clicked "Delete Server," and confirmed the guild was
     genuinely deleted and the client routed to DMs — not just a UI
     state change. Ran the channel-delete flow too: clicked "Delete
     Channel," confirmed the styled `confirmDialog` appears (title
     "Delete this channel?") instead of a native browser popup.

     Cleaned up after testing: killed the port-8121 instance, removed
     `/tmp/chatly-inspect-data`, `/tmp/chatly-inspect.log`, the two
     scratch cookie jars, the Playwright test scripts, and every
     screenshot. Full pipeline re-run clean before deploy: `cargo
     build --workspace`, `cargo clippy --workspace --all-targets`,
     `cargo test --workspace` (40 + 9 passed — frontend-only change,
     confirms nothing regressed), `npx tsc --noEmit`, `npx vite
     build`. Redeployed via `docker compose -f docker/docker-compose.yml
     up -d --build`; confirmed `chatly-chatly-1` up with the HTTP port
     still bound to `127.0.0.1:8090` only, `chatly-coturn-1` still up,
     `https://chatty.ebbemonster.dk/` returns 200, and startup logs are
     clean.

### Batch 36 — 2026-09-16 (the Danger Zone caution styling, applied everywhere it's missing)

135. [x] **UX ask**: "Now fix the 'Manage Server' menu to align with
     the just fixed menu. Actually fix all other menues." A follow-up
     to batch 35's hover-box fix — but this wasn't the same bug
     recurring, it was a *different* gap in the same area: both the
     "Manage Server" modal (`renderManageServerModal`,
     `web/src/views/guild-settings.ts`) and the "Manage Channel" modal
     (`renderManageChannelModal`, `web/src/views/servers.ts`) reuse the
     exact same `.settings-nav`/`.settings-nav-item` nav pattern
     Settings itself uses, but their "Danger Zone" tab had never been
     given the `.caution`/`.caution-first` treatment (red text, a
     divider separating it from the tabs above) that Settings applies
     to Logout/Danger — it just rendered as a plain nav item, visually
     identical to General/Members/Admins, with no signal it's the one
     tab that deletes something outright.
     - Both tabs arrays gained an optional `caution` field, and both
       nav-button builders now replicate the exact same logic
       `renderSettings` already uses: `tab.caution ? "settings-nav-item
       caution" : "settings-nav-item"`, plus `caution-first` on
       whichever caution tab comes first (`tabs.find((t) =>
       t.caution)?.id`). No new CSS was needed — `.settings-nav-item.
       caution`/`.caution-first` (`web/src/style.css`) were already
       generic, unscoped rules; they just weren't being applied outside
       the Settings modal. This also means both modals automatically
       inherit batch 35's fix for free — the divider lives in a
       `::before` there too, so there's no oversized-hover-box bug to
       repeat here.
     - Checked for other menus with the same gap: grepped every
       `settings-nav-item` user in the codebase. Only these three
       modals exist (Settings, Manage Server, Manage Channel) — no
       other left-nav menu was missed.
     **Verified live** on an isolated instance (port 8120): confirmed
     via Playwright that in both the Manage Server and Manage Channel
     modals, the Danger Zone nav item's bounding-box height now exactly
     matches its sibling tabs' (35.265625px — the same figure confirmed
     for Settings' own Logout tab in batch 35, i.e. genuinely
     consistent across all three menus, not just visually similar);
     confirmed Danger Zone's text renders in the same danger red
     (`rgb(242, 73, 87)`) in both modals; confirmed via screenshots
     that both modals show the same thin divider above Danger Zone,
     separating it from the tabs above exactly like Logout is separated
     from Profile/Devices/Security/Account/Admin in Settings.

     Cleaned up after testing: killed the port-8120 instance, removed
     `/tmp/chatly-menualign-data`, `/tmp/chatly-menualign.log`, the
     scratch cookie jar, the Playwright test script, and the
     screenshots. Full pipeline re-run clean before deploy: `cargo
     build --workspace`, `cargo clippy --workspace --all-targets`,
     `cargo test --workspace` (40 + 9 passed — frontend-only change,
     confirms nothing regressed), `npx tsc --noEmit`, `npx vite
     build`. Redeployed via `docker compose -f docker/docker-compose.yml
     up -d --build`; confirmed `chatly-chatly-1` up with the HTTP port
     still bound to `127.0.0.1:8090` only, `chatly-coturn-1` still up,
     `https://chatty.ebbemonster.dk/` returns 200, and startup logs are
     clean.

### Batch 35 — 2026-09-16 (Logout's oversized hover box)

134. [x] **UX ask**: "In the profile menu the hover over box on 'Log
     Out' is too big compared to on the other buttons. It goes all the
     way up to the divider." Root cause: `.settings-nav-item.caution-
     first` (`web/src/style.css`, added in batch 29 to draw a thin
     divider above Logout, the first "caution" item after the regular
     tabs) grew the button's own box to make room for that divider —
     `margin-top`, `padding-top`, and `border-top` were all set
     directly on the `<button>` itself. Since the button's `:hover`
     background paints its whole box, that extra padding became extra
     hover area too: Logout's hover rectangle was visibly taller than
     every other nav item's, stretching up to touch the divider line
     instead of stopping at the same height as Profile/Devices/etc.
     - Fixed by moving the divider onto a `::before` pseudo-element,
       absolutely positioned above the button, instead of growing the
       button's own padding. The button's padding is now identical to
       every other `.settings-nav-item` (`0.55rem 0.7rem`, no extra
       top padding), so its hover background is the same height as
       the rest; the divider line still renders in the same visual
       spot, just outside the element that actually gets the hover
       background.
     **Verified live** on an isolated instance (port 8119): confirmed
     via Playwright that Profile's and Logout's nav-item bounding-box
     heights are now numerically identical (both 35.265625px — before
     this fix Logout's would have measured taller by the old extra
     padding-top); confirmed via screenshots comparing Admin's hover
     state against Logout's hover state that the two hover boxes now
     match in size and shape, with the thin divider still visible
     directly above Logout exactly as before.

     Cleaned up after testing: killed the port-8119 instance, removed
     `/tmp/chatly-navhover-data`, `/tmp/chatly-navhover.log`, the
     scratch cookie jar, the Playwright test script, and the
     screenshots. Full pipeline re-run clean before deploy: `cargo
     build --workspace`, `cargo clippy --workspace --all-targets`,
     `cargo test --workspace` (40 + 9 passed — CSS-only change,
     confirms nothing regressed), `npx tsc --noEmit`, `npx vite
     build`. Redeployed via `docker compose -f docker/docker-compose.yml
     up -d --build`; confirmed `chatly-chatly-1` up with the HTTP port
     still bound to `127.0.0.1:8090` only, `chatly-coturn-1` still up,
     `https://chatty.ebbemonster.dk/` returns 200, and startup logs are
     clean.

### Batch 34 — 2026-09-16 (Discord-style "Invite to Voice" on voice channels)

133. [x] **UX ask**: "When you have a voice channel, you should be able
     to invite any friend to it like you can in Discord," with two
     screenshots — Discord's hover-revealed "Invite to Voice" icon next
     to a voice channel's name, and the panel it opens (a search box, a
     list of people each with their own "Invite" button, and a
     shareable link at the bottom as a fallback).
     - **The hover icon**: a new person-plus icon-button
       (`channelInviteBtn` in `web/src/views/chat.ts`) sits in a voice
       channel row's top line, titled "Invite to Voice", using the
       exact same hover-reveal CSS treatment the channel's own
       "Manage channel" gear icon already used (`.channel-invite-btn`
       added alongside `.channel-manage-btn` in `web/src/style.css` —
       both share the same opacity-on-hover rule now instead of it
       being gear-only). Text channels don't get this icon — the ask
       was specifically about voice channels, and a text channel's
       existing "Invite" flow (top bar, or the guild-level "Invite"
       button) already covers it.
     - **The panel** (`renderInviteToVoiceModal`, new in
       `web/src/views/servers.ts`): a "Recipients will land in 🔊
       {channel}" subheading, a "Search for friends" box that filters
       the list client-side as you type, a "Friends" list (avatar,
       display name, @username, an "Invite" button per row), and the
       same link-and-copy-button fallback `renderInviteModal` already
       has, generated once and shared by every send rather than
       minting a new invite per click. Clicking "Invite" on a friend
       posts a message straight into the DM that already exists with
       them ("Join me in {channel}: {link}") and the button flips to a
       disabled "Invited" state — no copy-paste required for the
       common case, matching Discord's own one-click behavior.
     - **Where "Friends" comes from**: this app already guarantees a DM
       channel exists between two accounts the moment they become
       friends (`api::friends::accept_request` creates one right then,
       see batch 16's "Friends folded into Direct Messages" note) — so
       `GET /api/dms` filtered down to real 1:1 DMs (excluding the
       always-present self-DM) *is* the friends list, complete with
       the DM channel id to send into. No `GET /api/friends` call and
       no separate "which DM belongs to which friend" lookup needed.
     - **No backend changes at all** — every piece this modal needed
       (`GET /api/dms`, `POST /api/invites`, `POST
       /api/channels/:id/messages`) already existed from earlier
       batches; this was a frontend-only feature.
     **Verified live** on an isolated instance (port 8118): three
     accounts — `vowner`, `vfriend` (an accepted friend of vowner's),
     and `vstranger` (registered but never friended). Confirmed via
     Playwright that hovering the voice channel reveals the invite
     icon exactly like the pre-existing manage-channel gear icon;
     confirmed the opened modal's Friends list shows only `VFriend`,
     never `VStranger`; confirmed typing "stranger" into the search box
     correctly returns zero rows (they're not a friend, so they were
     never in the list to filter down to); confirmed clicking "Invite"
     on `VFriend` disables the button and relabels it "Invited";
     confirmed via `curl` that the real DM channel between `vowner` and
     `vfriend` received an actual new message ("Join me in General:
     http://127.0.0.1:8118/invite/S4FAR57F") with a working invite
     code — not just a UI-only state change. Screenshots confirm the
     panel's layout (title, subheading with the channel icon, search
     box, friend row, link box) reads as a close match to the Discord
     reference screenshots the user provided.

     Cleaned up after testing: killed the port-8118 instance, removed
     `/tmp/chatly-voiceinv-data`, `/tmp/chatly-voiceinv.log`, the three
     scratch cookie jars, the Playwright test script, and the
     screenshots. Full pipeline re-run clean before deploy: `cargo
     build --workspace`, `cargo clippy --workspace --all-targets`,
     `cargo test --workspace` (40 + 9 passed — no backend changes this
     batch, confirms nothing regressed), `npx tsc --noEmit`, `npx vite
     build`. Redeployed via `docker compose -f docker/docker-compose.yml
     up -d --build`; confirmed `chatly-chatly-1` up with the HTTP port
     still bound to `127.0.0.1:8090` only, `chatly-coturn-1` still up,
     `https://chatty.ebbemonster.dk/` returns 200, and startup logs are
     clean.

### Batch 33 — 2026-09-16 (Profile tab redesign: click-to-reveal password change, an eye toggle on every password field)

132. [x] **UX ask**: "Much better, now to the Profile part of the menu.
     It also looks primitive compared e.g. to discord. E.g. why not
     have a button for change password, instead of having it all open?
     Also the password boxes need that eye for when you want to see
     wha tyou write." A follow-up to batches 32/31 applying the same
     "click-to-reveal instead of always-open" principle to the Profile
     tab's Password section (previously two always-visible password
     fields plus a "Change password" button sitting right there,
     regardless of whether you came here to change it), plus a
     genuinely new ask: a show/hide toggle on password inputs, which
     didn't exist anywhere in the app before this.
     - **Click-to-reveal Password section**: `renderProfileSection`
       (`web/src/views/settings.ts`) now shows a single "Change
       Password" button under the "PASSWORD" heading. Clicking it
       replaces the button with the same `.reveal-panel` card style
       batch 32 established for the Danger tab — Current/New password
       fields, right-aligned Cancel/Change Password actions. On
       success, the panel collapses back to the button and the button
       briefly reads "Password changed" (reusing the same transient-
       label-swap idiom `editableField`'s own Save button already
       used elsewhere on this same tab) before reverting; on failure,
       the panel stays open with an inline error so the fields aren't
       lost. Cancel discards whatever was typed and collapses back
       with no request made, same as every other reveal panel.
     - **Eye toggle, everywhere a password field exists in Settings**:
       new shared `passwordBox()` helper wraps a password `<input>`
       with an overlaid icon-button (positioned inside the input's own
       padding, not beside it as a separate element) that flips the
       input between `type="password"`/`"text"` and swaps a new
       `eye`/`eye-off` icon pair (`web/src/icons.ts` — `eye` already
       existed but was unused anywhere; `eye-off` is new) to match.
       Applied to *every* password field in Settings, not just
       Profile's: Profile's current/new password, Transfer Ownership's
       confirm-password field, and the Delete Account panel's confirm-
       password field all use the same helper now — "the password
       boxes need that eye" reads as a general statement about the app,
       not one specific field, so the fix went in once at the shared
       call site rather than four times separately. New CSS:
       `.password-input-row` (the positioning context) and
       `.password-toggle` (absolutely centered on the input's right
       edge) in `web/src/style.css`.
     **Verified live** on an isolated instance (port 8117): registered
     a fresh owner account and confirmed via Playwright that the
     Password section shows exactly one button and zero password
     inputs until clicked; confirmed clicking it reveals exactly 2
     password fields, each with a visible eye icon; confirmed clicking
     the eye toggle flips that field's `type` from `password` to
     `text` and correctly reveals a value typed into it beforehand
     (typed "hello123" while masked, toggled, read back "hello123" as
     plain text — not just a visual check but confirming the same
     input element genuinely holds and displays that value); ran the
     real change-password flow end-to-end through the UI and confirmed
     via `curl` that logging in with the *new* password afterward
     succeeds; separately confirmed the eye toggle is also present and
     working in the Transfer Ownership panel's password field, proving
     the shared helper is actually wired into all three call sites and
     not just Profile's.

     Cleaned up after testing: killed the port-8117 instance, removed
     `/tmp/chatly-profile-data`, `/tmp/chatly-profile.log`, the two
     scratch cookie jars, the Playwright test scripts, and the
     screenshots. Full pipeline re-run clean before deploy: `cargo
     build --workspace`, `cargo clippy --workspace --all-targets`,
     `cargo test --workspace` (40 + 9 passed — no backend changes this
     batch, confirms nothing regressed), `npx tsc --noEmit`, `npx vite
     build`. Redeployed via `docker compose -f docker/docker-compose.yml
     up -d --build`; confirmed `chatly-chatly-1` up with the HTTP port
     still bound to `127.0.0.1:8090` only, `chatly-coturn-1` still up,
     `https://chatty.ebbemonster.dk/` returns 200, and startup logs are
     clean.

### Batch 32 — 2026-09-16 (Danger tab redesign: two clean buttons, a modernized Transfer Ownership panel, four precise delete options)

131. [x] **UX ask**: "Let me be precise about the 'Danger': 1) We need
     two buttons: 'Transfer Ownership' and 'Delete Account'. No need
     for guiding text other than the two headlines 'TRANSFER OWNERSHIP'
     and 'DELETE MY ACCOUNT'. 2) Pressing 'Transfer Ownership' opens up
     for the correct information, but the visuals look HORRIBLE and
     don't aligne at all with the rest of the menu. Make it look
     consistent and modern like other modern apps. 3) Pressing 'Delete
     Account' should then give the options: a) Delete Account and All
     Messages b) Delete Account and Anonymize Messages IF Admin c)
     Transfer Ownership and Delete Account and All Messages d) Transfer
     Ownership and Delete Account and Anonymize Messages." A direct
     follow-up to batch 31, which had just built a "Delete everything"
     bypass for the owner but bolted it on as a second button plus an
     explanatory sentence pointing at Transfer Ownership — exactly the
     kind of clutter this ask says to remove, and asked for the reveal
     panels themselves to actually look designed rather than like bare
     form fields.
     - **No guiding text**: every `<p class="muted-text">` explanatory
       sentence in the Danger tab (the anonymize/erase tradeoff note,
       the "prefer to keep this server running" pointer, the "there's
       no anonymize option" warning) was removed outright. Each section
       is now just its heading (still rendered uppercase for free by
       the existing `.modal h3` rule — no new CSS needed for that part)
       followed by exactly one button: "Transfer Ownership" (owner
       only) and "Delete Account" (everyone).
     - **Modernized reveal panel**: `.reveal-panel` (`web/src/style.css`)
       went from a bare flex column with fields floating loose under
       the heading to an actual card — `background: var(--bg-elevated)`,
       a `var(--border)` outline, and `var(--radius)` corners, matching
       how the rest of the app groups related controls (modals, message
       groups) instead of reading as unstyled leftovers. The "New
       owner" `<select>` is now wrapped in a labeled `field()` like
       every other input in Settings, instead of sitting bare with no
       label; the old `max-width: 320px` cap on the select (which made
       it visually disagree with the full-width password field right
       below it) is gone. Confirm/Cancel now sit `justify-content:
       flex-end` (right-aligned, Cancel-then-Confirm) matching
       `.modal-actions`'s own convention exactly, rather than left-
       aligned with Confirm in a plain `.secondary` gray — Confirm is
       now `.danger` (red) like every other irreversible-action button
       in this tab.
     - **Backend**: `AccountDeletionMode` (`crates/server/src/models.rs`)
       is back down to two variants, `Anonymize`/`Erase` — the
       `EraseEverything` variant added one batch ago is gone.
       `Storage::delete_account` (`storage/mod.rs`/`storage/sqlite.rs`)
       gained a separate `force_guilds: bool` parameter instead: it's
       an orthogonal axis (mode × force), not a third mode, which is
       exactly what four independent delete options need. `force_guilds:
       true` bypasses the "you own a guild with other members" block
       and deletes every guild the account owns outright — used by
       `api::admin::delete_user` always (unchanged behavior from batch
       31, just re-expressed as `Erase` + `force_guilds: true`), and by
       self-service deletion (`api::auth::delete_account`) whenever the
       owner deletes without transferring first. `DeleteAccountRequest`
       gained a `force_guilds` field (`#[serde(default)]`, so existing
       non-owner callers sending nothing still default to `false`,
       preserving the guard rail for regular users who personally own a
       guild with other members).
     - **Four options, exactly as asked**: the Delete Account panel is
       now a `radio-group` (reusing the same pattern batch 30 already
       used for anonymize/erase) with two options for everyone —
       "Delete account and erase all messages" / "Delete account and
       anonymize messages" — plus two more shown only for the instance
       owner — "Transfer ownership, then delete account and erase
       messages" / "…and anonymize messages". Selecting either
       "Transfer ownership, then…" choice reveals a "New owner" field
       inline (same account picker Transfer Ownership itself uses, now
       shared via a `loadOwnerCandidates` helper) — hidden otherwise, so
       it only appears once it's actually needed. On confirm, if a
       transfer choice is selected the client calls
       `POST /api/me/transfer-ownership` first, then `DELETE /api/me`
       with `force_guilds: true` either way (the owner's four options
       all pass `force_guilds: user.is_owner`, which is `true`, since
       instance ownership and *guild* ownership are different things —
       transferring the former doesn't relinquish the latter, so even
       the "transfer first" options still need to force-delete any
       guild the departing account personally owns to guarantee they
       actually succeed in one action rather than dead-ending on a
       leftover guild membership).
     **Verified live** on an isolated instance (port 8116): built a
     3-account fixture — `downer` (instance owner, owns the default
     "Chatly" guild), `dmember` (a member of it), `dregular` (joins a
     separate guild later, plain member, never owner). Confirmed via
     Playwright that the Danger tab shows exactly two buttons
     ("Transfer Ownership", "Delete Account") with zero
     `.muted-text` paragraphs anywhere in the tab; confirmed the
     Transfer Ownership panel renders as a bordered card with a
     labeled "New owner" dropdown and password field, right-aligned
     Cancel/red Confirm; confirmed the Delete Account panel shows
     exactly the 4 expected radio options for the owner, in the exact
     wording above; confirmed selecting a "Transfer ownership, then…"
     option reveals the "New owner" select inline and hides it again
     for the other two; confirmed via `curl` that running the full
     "transfer, then erase" flow end-to-end actually: (a) moved
     `is_owner` to `dmember`, (b) invalidated `downer`'s session
     entirely (account deleted), and (c) force-deleted the "Chatly"
     guild despite `dmember` still being a member of it at the moment
     of deletion — proving `force_guilds` correctly bypasses the
     owned-guild-with-members block even for a guild the deleting
     account still owned *after* instance ownership had already moved
     to someone else. Separately confirmed, as `dregular` (a plain
     non-owner), that the Transfer Ownership button/section is entirely
     absent and the Delete Account panel shows only the 2 base options
     with no owner picker ever appearing — the existing guard-rail
     behavior for regular users is untouched.

     Cleaned up after testing: killed the port-8116 instance, removed
     `/tmp/chatly-danger2-data`, `/tmp/chatly-danger2.log`, the three
     scratch cookie jars, the Playwright test scripts, and the
     screenshots. Full pipeline re-run clean before deploy: `cargo
     build --workspace`, `cargo clippy --workspace --all-targets`,
     `cargo test --workspace` (40 + 9 passed), `npx tsc --noEmit`,
     `npx vite build`. Redeployed via `docker compose -f
     docker/docker-compose.yml up -d --build`; confirmed
     `chatly-chatly-1` up with the HTTP port still bound to
     `127.0.0.1:8090` only, `chatly-coturn-1` still up,
     `https://chatty.ebbemonster.dk/` returns 200, and startup logs are
     clean.

### Batch 31 — 2026-09-16 (admin delete force-erases everything, a real "delete everything" for the owner, prettier confirm dialogs)

128. [x] **UX ask**: "Deleting a user as admin, should delete everything
     by that user including servers owned and messages. In the Admin
     profile menu no options are needed for this. The options are only
     for people deleting themselves." Before this batch, admin-deleting
     someone (`POST /api/admin/users/:id/delete`) reused the same
     `AccountDeletionMode` (`Anonymize`/`Erase`) as self-service
     deletion, picked via a `<select>` in the Admin tab's delete panel —
     and, more importantly, it inherited the same guild-ownership guard
     rail as self-deletion: if the target owned a guild that still had
     other members in it, the whole delete was rejected outright
     (`DeleteAccountOutcome::OwnsGuildsWithMembers`), forcing the admin
     to first strip the guild down to just that one member by hand. For
     an admin forcibly removing someone else's account, that's exactly
     backwards — there's no reason to leave a removed user's servers
     half-abandoned, and no reason to ask the admin to make an
     anonymize-vs-erase call about someone else's messages.
     - Added a third `AccountDeletionMode` variant, `EraseEverything`:
       same message-erasure as `Erase`, but the guild-ownership guard is
       bypassed entirely — every guild the target owns is deleted
       outright in `Storage::delete_account`
       (`crates/server/src/storage/sqlite.rs`), even ones with other
       members still in them, instead of blocking with
       `OwnsGuildsWithMembers`.
     - `api::admin::delete_user` (`crates/server/src/api/admin.rs`) was
       rewritten to always use `EraseEverything` and to take no request
       body at all — the `DeleteUserRequest` struct and its
       mode-parsing function were deleted outright, not just unused.
     - `web/src/views/settings.ts`'s Admin tab `deletePanel(u)` had its
       mode `<select>` removed entirely; the panel is now just
       Confirm/Cancel, and the API call sends no body.
     **Verified live** on an isolated instance (port 8115): built a
     3-account fixture — `purgeowner` (instance owner), `purgea` (owns
     a second guild, "A Owned Guild"), `purgeb` (a member of both the
     main guild and "A Owned Guild"). Confirmed via Playwright that the
     Admin tab's delete panel for `purgea` shows zero `<select>`
     elements; clicked Confirm, then confirmed via `curl` that
     "A Owned Guild" now 404s (`{"error":{"code":"not_found",...}}`)
     and `purgea`'s account shows `"deleted": true` in the admin user
     list — despite `purgeb` still being a member of that guild at the
     moment of deletion, which is exactly the case that used to be
     blocked.

129. [x] **UX ask**: "For deleting your account as an Admin, you should
     have two options. Delete everything, or Transfer Ownership and
     then delete. Right no[w] the first option is not there." The
     Transfer-Ownership-then-delete path already existed (batch 28/30):
     an owner can hand off `is_owner` to someone else, after which
     their account is a normal member and can use the regular
     anonymize/erase self-delete flow. What was missing was the other
     option — deleting the owner account *and* everything it owns in
     one step, without transferring first. Self-service deletion for
     the instance owner was previously hard-blocked
     (`is_instance_owner` error, "the instance owner's account can't be
     deleted") with no way around it except transferring ownership
     away.
     - `parse_deletion_mode` in `crates/server/src/api/auth.rs` now
       accepts `"erase_everything"` as a third mode string. The owner
       block in `delete_account` now only fires for the other two
       modes — `EraseEverything` is allowed straight through, deleting
       the owner's account, all their messages, and every guild they
       own (even ones other members are still in), the same as the
       admin-delete path above.
     - Rather than add a second button for "transfer, then delete" (a
       path that's already just "click Transfer Ownership, then come
       back and click the existing Delete button" — nothing new to
       build), `renderDangerSection` in `web/src/views/settings.ts` was
       reworked so the instance owner sees the Transfer Ownership
       section plus a single new **"Delete everything…"** button (the
       old anonymize/erase button is hidden for the owner entirely,
       since the server would just reject it) and a plain sentence
       pointing at Transfer Ownership as the gentler alternative:
       *"Prefer to keep this server running under someone else? Use
       Transfer Ownership above first — you can then delete your
       account the normal way, with the choice to anonymize or erase
       your messages."* A non-owner's Danger tab is unchanged (still
       just the normal anonymize/erase "Delete my account…" flow).
     **Verified live** on the same isolated instance: confirmed the
     owner's Danger tab shows no old-style "Delete my account…" button,
     one "Delete everything…" button, and the transfer note; used it
     (with the account's real password) and confirmed via `curl` that
     the main "Chatly" guild (owned by `purgeowner`, with `purgeb` still
     a member) now 404s, and that `purgeowner`'s session is invalidated
     (`/api/me` returns `not_authenticated`) — i.e. the owner account,
     all its messages, and its guild were actually erased in one step,
     bypassing the block that used to make this impossible without a
     transfer first.

130. [x] **UX ask**: "Also can we make the popups prettier" — referring
     to the native browser `confirm()` dialogs used for the Transfer
     Ownership, Delete My Account, and admin Delete Account
     confirmations, which look like an OS-level popup rather than part
     of the app.
     - Added a reusable `confirmDialog(opts)` helper in
       `web/src/views/settings.ts`: an async, Promise-based modal
       (title + message + Confirm/Cancel) built from the same
       `.modal-backdrop`/`.modal` CSS the rest of the app's modals use,
       so it's visually consistent rather than a one-off. It needed a
       higher explicit `z-index` (40, vs. the standard 30) since it's
       opened from *inside* the already-open Settings modal and has to
       reliably stack above it. `opts.danger` styles the confirm button
       red for destructive actions.
     - Replaced all three native `confirm()` calls — Transfer
       Ownership's confirm, Delete My Account's confirm (both the
       normal and the new "Delete everything" panel), and the Admin
       tab's per-user delete confirm — with `await confirmDialog(...)`.
     - New CSS: `.confirm-dialog-backdrop` (z-index 40),
       `.confirm-dialog` (max-width 420px), plus tight heading/paragraph
       margins so it reads as a compact dialog rather than a full
       settings panel.
     **Verified live** via Playwright screenshots on the isolated
     instance: confirmed all three flows (admin delete, owner "Delete
     everything", and — by triggering a wrong-password error along the
     way — the normal error-display path still works inside the new
     panel) render the app-styled dialog with the correct title
     ("Delete this account?", "Delete everything?") and a red confirm
     button, not a native OS `confirm()` popup.

     Cleaned up after testing: killed the port-8115 instance, removed
     `/tmp/chatly-purge-data`, `/tmp/chatly-purge.log`, the three
     scratch cookie jars, the Playwright test scripts, and the
     screenshots. Full pipeline re-run clean before deploy: `cargo
     build --workspace`, `cargo clippy --workspace --all-targets`,
     `cargo test --workspace` (40 + 9 passed), `npx tsc --noEmit`,
     `npx vite build`. Redeployed via `docker compose -f
     docker/docker-compose.yml up -d --build`; confirmed
     `chatly-chatly-1` up with the HTTP port still bound to
     `127.0.0.1:8090` only, `chatly-coturn-1` still up,
     `https://chatty.ebbemonster.dk/` returns 200, and startup logs are
     clean.

### Batch 30 — 2026-09-16 (click-to-reveal Danger tab)

127. [x] **UX ask**: "For the Danger zone we need the menu cleaned a
     bit: Transfer Ownership only has a button, and then you get to
     pick the person and confirm with your password. It is much
     cleaner, and no 'Hand platform ....' sentence is needed. It is
     obvious what it means. Delete my account needs the same - you
     delete and then get prompted for the details." A direct follow-up
     to batch 29 (which had just split Transfer Ownership and Delete
     My Account into their own "Danger" tab), asking for a
     click-to-reveal interaction instead of every field being visible
     at once. Both sections in `renderDangerSection`/
     `renderTransferOwnershipSection` were rewritten to start as a
     single button and reveal the actual controls only on click —
     mirroring a pattern that already existed elsewhere in this same
     file (the Admin tab's own per-user "Delete…" button, which already
     replaces itself with a `deletePanel` on click), so this isn't a
     new interaction pattern for the app, just a second, consistent
     application of an existing one.
     - **Transfer Ownership**: now just a "Transfer ownership…" button
       with no explanatory sentence (the "Hand platform administration
       to someone else..." note was removed entirely, per "It is
       obvious what it means"). Clicking it replaces the button with a
       panel (user `<select>` populated on demand from
       `/api/admin/users`, a password field, Confirm + Cancel, an error
       line) via `button.replaceWith(panel)`; Cancel replaces the panel
       back with the original button. The confirm dialog, the actual
       transfer call, and the success/reload behavior are all unchanged
       — just living inside the revealed panel instead of always-
       visible fields now.
     - **Delete My Account**: same shape — now just a "Delete my
       account…" button. Its explanatory note ("Messages you've sent
       are never entirely private...") was *not* removed like
       Transfer's was, since the anonymize/erase choice genuinely isn't
       self-evident the way "transfer ownership" is — it moved *into*
       the revealed panel alongside the mode radio group, password
       field, and Confirm/Cancel, so it only appears once someone's
       actually decided to proceed. The owner-account intercept (the
       "you're the instance owner, transfer first?" dialog) still fires
       at the very first click, *before* the panel is ever revealed —
       revealing a whole panel to an owner only to have it dead-end at
       Confirm would be worse than intercepting immediately.
     - New shared CSS: `.reveal-panel` (flex column, consistent gap,
       stacks the select/note/radio-group/password-field vertically)
       and `.reveal-panel-actions` (a horizontal row specifically for
       the Confirm+Cancel pair, so they sit side by side instead of
       stacking with everything else).
     **Verified live** with two real accounts (one instance owner, one
     plain member) on an isolated instance: confirmed the Danger tab's
     initial view shows only two buttons with zero always-visible
     fields or explanatory text; confirmed clicking "Transfer
     ownership…" reveals the populated dropdown + password field +
     Confirm/Cancel, and Cancel correctly collapses it back; confirmed,
     as the non-owner account, clicking "Delete my account…" reveals
     the full note + radio choice + password field + Confirm/Cancel,
     and Cancel correctly collapses it back; confirmed, as the owner
     account, clicking "Delete my account…" instead shows the
     transfer-first intercept dialog and leaves the button un-revealed
     (proving the owner-check still runs *before* any panel reveal, not
     after); confirmed the Transfer Ownership section stays correctly
     absent entirely for the non-owner account (a sanity re-check, not
     part of this change).

### Batch 29 — 2026-09-16 (Logout and Danger split into their own red-accented nav items)

126. [x] **UX ask**: "Can we make the danger zone stuff its own menu
     item in the bottom. One for 'Log Out', and then one for 'Danger'.
     You can make some red indicators of these menu items." A direct
     follow-up to batch 28's settings redesign, where "Transfer
     ownership" and "Delete my account" had just landed inside the
     "Account" tab. Split that content out into its own new "Danger"
     nav tab:
     - Extracted `renderAccountSection` into two functions:
       `renderAccountSection` now holds only "Export your data";
       a new `renderDangerSection` holds "Transfer ownership"
       (owner-only) and "Delete my account" (everyone), moved verbatim
       with no behavior changes to either flow — the owner-delete-
       intercept dialog, the transfer confirmation, the anonymize/erase
       radio choice, all identical to before, just living under a
       different tab now.
     - Reordered the tabs array so Admin (owner-only) now comes right
       after Account, with Logout and Danger both moved to the very
       end, in that literal order — matching "one for Log Out, and
       then one for Danger."
     - Added a `caution?: boolean` flag to the tab config, set on both
       `logout` and `danger`, adding a `.caution` class to those two
       nav buttons. New CSS colors them in `var(--danger)` red at rest,
       hover, and active, using `color-mix(in srgb, var(--danger) N%,
       transparent)` for the hover/active background tints so they
       stay visually consistent with the existing danger-red already
       used elsewhere (delete buttons, etc.) rather than introducing a
       new color.
     - Added a `.caution-first` class (applied via a small JS lookup
       for whichever tab is first in the `caution` group, i.e. Logout)
       adding a top border plus extra top margin/padding — a divider
       separating the Logout/Danger pair from the rest of the nav,
       mirroring how the Discord reference screenshot from the previous
       batch visually grouped its own nav sections apart from each
       other. This specifically could **not** be done with a
       `:first-of-type` CSS pseudo-class as first attempted, since
       every nav item is a `<button>` — `:first-of-type` matches by tag
       name, not class, so it would have incorrectly matched Profile
       (the actual first button in the list) instead of Logout (the
       first *caution* button) — caught during implementation and fixed
       with an explicit class instead.
     - Changed the Account tab's icon from "trash" (fit when it held
       the delete flow) to "external-link" (fits its new export-only
       content), since "trash" now belongs to the new Danger tab.
     **Verified live** at 1100px on an isolated instance: confirmed the
     nav renders in order Profile/Devices/Security/Account/Admin/
     Logout/Danger with a visible divider line above Logout; confirmed
     both Logout and Danger render in red (`rgb(242, 73, 87)`) while
     Profile stays the normal muted grey; confirmed the Account tab's
     content no longer contains "Transfer ownership" or "Permanently
     delete" text; confirmed the new Danger tab's content contains
     both, fully functional (transfer-ownership dropdown populated,
     delete-account radio/password/button all present) — a real UI
     reorganization with no functional changes to either flow, both of
     which were already tested end-to-end in the previous batch.

### Batch 28 — 2026-09-16 (a real settings-menu redesign, a genuine instance-ownership-transfer feature)

Context: the user pasted a screenshot of Discord's own Account settings
page as a reference for "a nice design" and asked to clean up "all the
menues as currently they are a mess," with four specific asks about
the Profile/Settings modal.

122. [x] **UX ask**: "The side menu should be the same color all the
     way to the top, and it is not needed to say 'Settings'." Root
     cause: a shared `<h2>Settings</h2>` heading sat above the
     nav/content split, painted on `.modal`'s own background
     (`--bg-alt`), while `.settings-nav` directly below it painted a
     *different* background (`--bg`) — so the nav visibly seamed into
     two colors right at its own top edge instead of reading as one
     continuous panel. Fixed by removing the shared heading entirely,
     zeroing `.settings-modal`'s own padding (with a mobile-specific
     override too, since the generic `.modal { padding: 1.25rem }`
     mobile rule would otherwise win back over it at equal specificity
     later in the cascade), and letting `.settings-nav`/
     `.settings-content` each reach every edge of the modal themselves
     — the nav is now `--bg` from the very top of the modal to the very
     bottom, full stop. The close button moved from a `float: right`
     inside the old shared header to `position: absolute` floating over
     the content pane. Each tab now gets its own page-level `<h2>`
     title ("Profile", "Account", ...) rendered at the top of
     `.settings-content`, replacing one generic modal-wide title with
     one that actually says which pane you're looking at. Also added a
     compact identity card (avatar + display name + @username) at the
     top of the nav, loosely inspired by the reference screenshot's own
     sidebar header — hidden on mobile, where the nav becomes a
     horizontal scrolling tab strip instead of a vertical list and a
     profile card doesn't fit that shape.
123. [x] **UX ask**: remove "Downloads a JSON file with your profile,
     servers, conversations, and every message you've sent." from the
     Account tab's export section. Removed outright — the button's own
     label ("Export my data") and the browser's own save-file behavior
     already make the action self-explanatory.
124. [x] **UX ask (the substantial one)**: remove "As the instance
     owner, your account can't be deleted here — there's no one else to
     hand platform administration to," and replace the dead end with a
     real capability: transfer ownership to another admin, plus a
     confirm-or-transfer prompt if the owner tries to delete anyway.
     This required a genuinely new backend feature — no instance-
     ownership-transfer mechanism existed at all before now (confirmed
     by reading the code: `is_owner` could only ever be set once, on
     the very first account registered, and both `delete_account`'s and
     `admin::delete_user`'s doc comments explicitly said "there's no
     instance-ownership-transfer flow" as the reason deleting the owner
     was hard-blocked).
     - Added `queries::users::set_owner` (a plain single-column UPDATE)
       plus a new `Storage::transfer_instance_ownership(current_owner_id,
       new_owner_id)` trait method, implemented as one transaction
       (clear the flag from the current holder, set it on the new one)
       so exactly one account is ever `is_owner` at a time — no window
       where zero or two accounts hold it.
     - Added `POST /api/me/transfer-ownership` (`auth::transfer_ownership`)
       — self-service only (the current owner initiates handing off
       their own role), requires `require_human()`, requires the
       caller's own password (same bar as self-deletion), validates the
       target isn't the caller themselves, isn't a bot or guest
       account, and isn't already soft-deleted (reusing the same
       `list_all_users_for_admin` data the Admin tab already fetches
       rather than adding a second lookup path), then performs the
       transfer.
     - `delete_account`'s existing block on deleting your own account
       while `is_owner` is **kept** (still correct and necessary — the
       reasoning in its doc comment was already sound) but its error
       message and doc comment now point at the new way out: "transfer
       ownership to someone else first, then you can delete your
       account," instead of a flat, permanent-sounding refusal.
     - Frontend: a new "Transfer ownership" section (owner-only,
       between Export and Delete) with a `<select>` populated from
       `/api/admin/users` (filtered to exclude bots, guests, deleted
       accounts, and the owner themselves), a password field, and a
       confirm dialog before the actual transfer. The Delete section is
       now shown to the owner too (previously replaced entirely by the
       blocking sentence) — but its delete button, clicked while still
       `is_owner`, intercepts *before* ever calling the API (which
       would just fail server-side) with a confirm dialog: "You're the
       instance owner — you'll need to transfer ownership to someone
       else before you can delete your account. Click OK to jump to
       Transfer Ownership, or Cancel to stay here" — satisfying "asked
       if they are sure or if they want to transfer ownership" using
       the same native-confirm pattern the delete flow already used
       elsewhere in this function, rather than a new custom modal.
     **Verified live end-to-end** with two real accounts on an isolated
     instance: confirmed clicking Delete as the owner shows exactly
     that dialog and does not call the delete API; confirmed actually
     transferring ownership through the real UI correctly flips
     `is_owner` on both accounts (checked directly via `GET /api/me`
     for each — old owner now `is_owner: false`, new owner now
     `is_owner: true`); confirmed the old owner can now proceed into
     the delete flow with no `is_instance_owner` block at all — a
     follow-up direct API call hit the next, unrelated, correctly-
     still-enforced check instead (the pre-existing "you still own a
     guild with other members in it" guard), proving the *instance*-
     ownership block specifically was lifted rather than the whole
     endpoint being broken open. Confirmed the Transfer Ownership
     section and Admin tab both correctly stay absent for a non-owner
     account.
125. [x] **UX ask**: "The Profile page looks clunky and not very modern
     or professional. Make it look modern!" Beyond the shell-wide
     redesign in item 122 (which the Profile tab inherits directly —
     full-height single-color nav, its own "Profile" page title, the
     new identity card), fixed one specific redundancy on this tab: its
     first section was itself labeled "Profile" (rendering as "PROFILE"
     in the section's small-caps style), sitting directly under the new
     page title that already said "Profile" — the exact same word
     twice in a row. Renamed that section to "Identity" (grouping the
     avatar picker, display name, and username fields — what it
     actually is), leaving "Password" as the second, already-distinct
     section. No other tab had this same-title-twice issue.
     **Verified live** via screenshots at both desktop (1100px) and
     mobile (390px) widths: confirmed the nav is one continuous color
     from top to bottom with no visible seam, confirmed no instance of
     the literal word "Settings" appears anywhere in the modal,
     confirmed the Profile tab now reads "Profile" / "IDENTITY" (not
     "Profile" / "PROFILE"), confirmed zero horizontal overflow on
     mobile, and confirmed the mobile identity card is correctly hidden
     in the horizontal tab-strip layout there.

### Batch 27 — 2026-09-16 (classical-messenger-style mobile navigation, further camera hardening)

120. [x] **UX ask**: "Can we not make this interface on mobile with
     picking/creating servers and joining channels more easy to work
     with, e.g. aligning more with classical messenger apps. Right now
     it feels wasteful to fill the screen with so little information."
     Root cause: the mobile off-canvas drawer showed the desktop guild
     rail (a permanently-docked 76px column of icon-only server
     buttons, no names) side by side with the channel-list sidebar
     (squeezed into whatever width was left, capped at 320px) —
     cramming two conceptually separate navigation levels (which
     server, vs. which channel) into one simultaneous view, each too
     narrow to show real information, unlike a classical messenger app
     (WhatsApp/Telegram/Messenger, and Discord's own actual mobile app)
     which shows one full-width list at a time and lets you drill down.
     Redesigned as proper stacked navigation **for mobile only** —
     desktop's side-by-side guild-rail + sidebar is completely
     unchanged:
     - The guild rail is hidden entirely on mobile, and `.sidebar` now
       spans the full drawer edge to edge (`width: 100vw !important;
       max-width: none`, replacing the old `left: 76px` + capped
       width).
     - A new chevron button (`mobileServerListBtn`) next to the
       server/DM-list name in the sidebar header opens a new full-
       screen overlay within the drawer (`mobileServerList`,
       `position: absolute; inset: 0` covering the same box the
       header/channel-list/footer occupy) — so switching between
       "which server" and "this server's channels" reads as moving
       between two screens, not two panels sharing space.
     - That overlay lists "Direct Messages" first, then every guild as
       a full-width row with a real icon *and its actual name* (not
       just an unlabeled circle), plus an "Add a server" row and a
       close button — built from the exact same `guilds`/
       `activeGuild`/`onHome` state and the exact same
       `switchGuild`/`switchToHome`/`renderAddServerModal` actions the
       desktop guild rail already used, just presented as legible rows
       instead of icons. Picking any row closes the overlay and returns
       to the (now correctly populated) channel list; the whole drawer
       also always resets back to the channel-list view on every fresh
       open, never leaving the server-switcher screen showing by
       mistake.
     - Found and fixed one real bug during verification: the new hide-
       on-desktop rule for the chevron button/overlay was placed early
       in the stylesheet, before the later `.icon-button { display:
       inline-flex; }` base rule — at equal specificity (both single-
       class selectors), the later rule wins the cascade, so the
       button incorrectly showed on desktop too. Fixed by moving the
       hide rule down next to this file's existing `.hamburger-btn {
       display: none; }` rule, which already lives after
       `.icon-button`'s definition for exactly this reason — matching
       the established pattern for this kind of "hidden on desktop,
       mobile media query turns it on" button.
     **Verified live** in a real two-guild test account at 390px:
     confirmed the guild rail is gone from the mobile drawer and
     `.sidebar` spans the full 390px width; confirmed the switcher
     button opens a full-width "Servers" screen listing Direct
     Messages, both guilds by name with real icons, and "Add a
     server"; confirmed tapping a guild row switches to it, closes the
     overlay, repopulates the channel list, and updates the header
     name; confirmed the active guild is highlighted on reopening the
     switcher; confirmed tapping Direct Messages switches correctly;
     confirmed both the overlay's own close button and reopening the
     whole drawer correctly reset back to the channel list; confirmed
     zero horizontal overflow throughout. Separately confirmed on
     desktop: guild rail still visible, switcher button correctly
     hidden, sidebar still at its normal narrow resizable width (240px)
     — desktop is completely unaffected.
121. [x] **Bug report — further hardening, not a confirmed fix**: "On
     mobile my webcam just shows a black screen, but other people can
     see me" persisted for the user even after the previous fix (batch
     26, item 115, which added an explicit `.play()` call). This
     sandbox has no real mobile Safari/Chrome engine to reproduce the
     *remaining* failure against — Playwright's mobile emulation is
     still desktop Chromium under a mobile user-agent, and the previous
     fix already tested as fully working in that same environment, so
     there is nothing further to observe failing here. Applied
     additional, well-established defensive hardening for this exact
     class of cross-browser video-autoplay flakiness, rather than
     guessing at one silver-bullet cause:
     - Set the HTML *attributes* (`autoplay`, `muted`, `playsinline` via
       `setAttribute`), not just the equivalent DOM properties that
       were already being set — some WebKit/mobile Safari versions have
       historically checked attribute *presence* specifically (not just
       the live property) before permitting muted autoplay of a video
       whose `srcObject` was assigned programmatically rather than via
       a `src` URL. Applied to both the local self-preview
       (`onLocalVideo` in chat.ts) and the remote path
       (`attachRemoteTrack` in voice.ts) for consistency, even though
       only the local path was ever reported broken.
     - Extracted the play-after-insert logic into a shared
       `playVideoResilient(el)` helper that, if the first `play()` call
       rejects, now logs the rejection to the console (previously fully
       swallowed silently, which would have made any *remaining* real
       failure undiagnosable even with remote device debugging
       attached) and retries once more via `requestAnimationFrame` —
       covering the further edge case where the very first `play()`
       call lands before the browser has actually laid the newly-
       inserted element out at all, known to silently no-op on some
       mobile engines rather than queuing.
     **Verified**: re-ran the same live camera-preview check from the
     previous batch (readyState/videoWidth/paused, in a simulated
     two-account mobile-viewport call) to confirm no regression from
     the attribute/logging changes — the simulated path still renders
     correctly, exactly as before. This is **not** proof the real-
     device symptom is resolved, only that the added hardening didn't
     break the already-working simulated path — needs the user's own
     phone to confirm either way.

### Batch 26 — 2026-09-15 (an expandable mobile call bar, a real black-screen camera bug, touch-only tile controls, hide-chat on mobile, a clearer echo fix)

114. [x] **UX ask**: "On mobile when you join a chat the menu bar with
     the mute/unmute, camera and screen share looks horrible. Can you
     please make it look pretty and place it somewhere, or make it
     expandable or whatever is good practice here." Root cause:
     `.mobile-voice-bar` crammed a text label plus five separate 34px
     round icon buttons into one thin flex row with only 0.4rem gap —
     nowhere near enough room on a phone-width screen for either the
     label or comfortable touch targets. Redesigned as a
     collapsed-by-default pill (a small pulsing status dot + label +
     chevron — `mobileVoiceSummary`/`mobileVoiceDot`/
     `mobileVoiceChevron` in `chat.ts`) that's tappable to expand — the
     full control row (`mobileVoiceControls`) then floats in a card
     positioned `bottom: 100%` above the pill (the same
     floating-above-itself mechanic the composer's own "+" menu already
     uses, for visual consistency), with buttons bumped to 44px for
     proper touch targets, collapsing back on a second tap or
     automatically resetting to collapsed on every fresh call join.
     Found and fixed one bug during verification: the summary button's
     plain background was getting overridden by the global
     `button:hover` rule's purple accent (a specificity fight —
     `button:hover` beats a same-level class selector at rest), showing
     up as a lingering solid-purple bar after any tap; fixed with an
     explicit `.mobile-voice-bar-summary:hover` override at matching
     specificity.
     **Verified live** at 390px in a real two-account call: collapsed
     state renders as a clean single-row pill (screenshot), tapping it
     reveals a properly-spaced floating control row (screenshot + a
     bounding-box check), mute toggling from the expanded row correctly
     updates state, tapping again collapses it, zero horizontal
     overflow throughout.
115. [x] **Bug report**: "On mobile my webcam just shows a black
     screen, but other people can see me." Real, confirmed bug: the
     local self-preview `<video>` element in `onLocalVideo` had its
     `srcObject`/`autoplay`/`muted`/`playsInline` all set *before* the
     element ever entered the DOM, then relied entirely on the bare
     `autoplay` attribute with no explicit `.play()` call to actually
     start playback once attached — a well-known unreliable pattern on
     mobile Safari specifically for programmatically-built video
     elements. The remote/other-viewer side worked fine because that's
     a completely different element in a completely different browser
     going through a different code path (`attachRemoteTrack`) — "others
     can see me but I see black" is exactly what that split predicts:
     the encode/send pipeline was never broken, only this device's own
     local preview. Fixed by adding an explicit `void
     mainEl.play().catch(() => {})` (and the same for `pipEl`) in
     `renderVideoTile`'s reconciliation logic, right after each video
     element is actually inserted into the live DOM — applied to both
     local and remote elements uniformly, not just the one reported
     case.
     **Verified live**: confirmed `readyState: 4`, `videoWidth: 640`,
     `paused: false` on the self-preview element after turning the
     camera on in a mobile-viewport test, and confirmed via screenshot
     that real decoded video (Chromium's fake-camera test pattern)
     renders visibly instead of a black rectangle.
116. [x] **Bug report**: "the menu for your cam looks weird on mobile."
     Real, confirmed bug: `.video-tile-controls` (the per-tile
     focus/pop-out/fullscreen/volume overlay) was `opacity: 0` at rest,
     only reaching `opacity: 1` via `.video-tile:hover` — but a
     touchscreen has no reliable hover equivalent (some browsers fake a
     hover state on the first tap of what becomes a two-tap sequence,
     some never trigger it at all), so on a phone this control row was
     either invisible the whole time or only ever worked erratically.
     Fixed with an `@media (hover: none)` rule forcing `opacity: 1`
     unconditionally on any touch-only device — leaving desktop's
     hover-to-reveal behavior completely untouched — and bumped the
     icon buttons from 24px to 34px within that same query, since 24px
     sits under both Apple's and Google's ~44px-minimum touch-target
     guidance (34px as a pragmatic middle ground without redoing the
     whole tile's layout).
     **Verified live**: confirmed `getComputedStyle(...).opacity ===
     "1"` for `.video-tile-controls` in a Playwright context configured
     with `hasTouch: true, isMobile: true` (which correctly makes
     Chromium report `(hover: none)`), and confirmed via screenshot the
     controls render visibly in the tile's corner with zero hover
     interaction.
117. [x] **UX ask**: "The minimize of cam is ugly and makes no sense, so
     consider removing." Removed the "Minimize video" feature entirely
     — the `videoCollapseBtn` button, its `videoCollapsed` state, its
     click handler, and the `.video-tiles.collapsed` /
     `.video-tiles.collapsed .video-tile` /
     `.video-tiles.collapsed .video-tile-controls` /
     `.video-tiles.collapsed .video-tile .video-tile-pip` CSS rules
     that shrank tiles into small rectangular thumbnails. "Hide chat"
     (item 118) is a separate feature and unaffected.
     **Verified live**: `button[title="Minimize video"]` returns zero
     matches after the change.
118. [x] **Bug report**: "the minimizing of the chat does nothing
     sensible with the extra space." Real, confirmed bug specific to
     mobile: "Hide chat" was already coded to let `.video-tiles-panel`
     claim the freed *width* on desktop's side-by-side layout — but on
     mobile, where `.content-split` is already stacked vertically and
     the panel is already full-width regardless, the space "Hide chat"
     actually frees up is *height*, and the panel's own `max-height:
     45vh` mobile cap stayed in effect the whole time regardless of
     chat being hidden — so hiding chat on a phone just left dead empty
     space below a still-45vh-capped video instead of the video
     actually growing into it. Fixed by adding
     `.content-split.chat-hidden .video-tiles-panel { max-height: none;
     flex: 1; }` inside the mobile media query, so the panel now flexes
     to fill whatever's left once chat has nothing left to compete
     with it for space.
     **Verified live**: the video panel's own bounding-box height grew
     from 329.9px to 780px (out of an 844px-tall viewport) immediately
     after tapping "Hide chat," confirmed via screenshot as a real,
     full-height cam-to-cam view with only a small "show chat" toggle
     remaining.
119. [x] **Bug report re-investigated**: continued skepticism from item
     109 — "there is some echo issue when two devices are close by,
     which makes sense. But if one mutes there shouldn't be an echo,
     but there still is, suggesting that the mute of the microphone is
     not working." Re-ran the exact same received-audio-level
     measurement (an `AnalyserNode` tapped onto the real remote
     `<audio>` element of a live two-account call) after every other
     change in this batch, specifically to rule out any regression:
     unmuted baseline read ~86/255, muted read **exactly 0** again —
     mute is conclusively still working correctly at the transport
     level, no regression, same as item 109 already established.
     What changed here is the *explanation*: "if one mutes there
     shouldn't be an echo" turns out to describe a real acoustic
     mechanism that muting genuinely cannot fix, and the previous tip's
     wording didn't make that clear enough. The echo is *your own* mic
     picking up the *other* device's speaker, which is still playing
     *your own* voice back at you after the round trip — muting your
     mic does nothing about that because your mic was never the
     problem, your nearby *speaker* is, and your speaker keeps playing
     normally whether your mic is muted or not (mute and deafen are
     independent). Rewrote the in-context tip (`dmCallBannerTip`, shown
     in the DM call banner whenever connected with another participant)
     to explicitly recommend **Deafen** as the actual no-headphones-
     needed fix instead of just generically mentioning headphones: "🎧
     Echo? Muting only stops your mic — try Deafen instead (or
     headphones): it silences your speaker too, so there's nothing
     nearby left for their mic to pick back up." No code change was
     warranted for "mute isn't working," since it demonstrably is — the
     fix here is giving people the one control that actually solves
     their situation, which the old tip never named at all.

### Batch 24 — 2026-09-15 (mobile scroll/call controls, DM call visibility, an echo investigation)

107. [x] **Bug report**: "On mobile scroll seems not to work, and it is
     not easy to access the menus to share screen, share camera, and
     mute and unmute." Two separate, real bugs:
     - **Scroll**: `.message-list` and `.chat-column` were both missing
       `min-height: 0`. A flex item's default `min-height: auto` lets
       it grow to fit its *content* instead of shrinking to whatever
       space `flex: 1` actually gives it — on a phone's limited height,
       enough messages just pushed the composer off the bottom of the
       viewport instead of the message list clipping and scrolling
       properly within its own space. (This bug technically existed on
       desktop too — bigger screens just rarely had enough messages
       loaded at once to reveal it.) Fixed by adding `min-height: 0` to
       both.
     - **Call controls unreachable**: the entire voice control bar
       (mute, deafen, camera, screen share, leave) lives inside
       `.sidebar`, which is off-canvas on mobile behind the hamburger
       drawer — mid-call, reaching any of them meant opening the drawer
       every single time. Added a second, compact mirror of the same
       five controls (`.mobile-voice-bar`) rendered directly in the
       chat column itself (never off-canvas), shown only at mobile
       widths, kept in sync with the exact same `voiceClient` state via
       `syncMuteIcons`/`syncVideoIcons` (now updating three copies of
       each button: sidebar, global footer, and this new one) — and the
       five click handlers were refactored into shared
       `handleToggleMute`/`handleToggleDeafen`/`handleToggleCamera`/
       `handleToggleScreen`/`handleLeaveVoice` functions reused by every
       copy instead of a fourth round of duplicated logic.
     **Verified live**: posted 40 messages into a channel and loaded it
     at 390×844 — confirmed `.message-list` has a bounded `clientHeight`
     (718px) against a much larger `scrollHeight` (1936px) so it
     actually scrolls, confirmed the composer stays fully within the
     viewport instead of being pushed off the bottom, and confirmed
     manual scrolling reveals earlier messages correctly. Separately,
     joined a real two-account call and confirmed `.mobile-voice-bar`
     is visible and functional on the mobile side with the drawer
     closed the entire time.
108. [x] **Bug report**: "The calling a friend does not work well. It
     is hard to see that you are in a call, if you are even in a
     call." Root cause: a DM call's only visibility anywhere was a
     small icon swap on the header's call button (easy to miss among
     the header's other icons) and the sidebar's own status bar
     (off-canvas on mobile, tucked at the very bottom on desktop) —
     nothing was shown in the conversation itself. Added a full-width
     `.dm-call-banner` directly below the channel header, visible for
     as long as *anyone* is in that DM's call (you, the other person,
     or both) — reading "🔊 In a call with X" (you're connected, with a
     Leave button) or "🔊 X is in a call" (someone else is, with a
     one-tap Join button) — driven by the same `voiceParticipants` map
     that already tracked per-channel call membership for guild voice
     channels, just surfaced for DMs too.
     **Verified live**: real two-account DM call — the caller's banner
     correctly read "In this call" before the callee joined; the
     callee, on a mobile viewport with the drawer closed the whole
     time, saw "MuteA is in a call" with a Join button, tapped it, and
     the banner updated to "In a call with MuteA" on both sides.
109. [x] **Bug report investigated**: "despite muting a microphone
     noise still goes through (so when sitting next to each other it
     turns into echos)." **Conclusion: mute itself has no bug** — this
     was a real investigation, not a blind fix. Measured the *actual
     received audio level* on the far end of a real two-account call
     (an `AnalyserNode` tapped onto the real remote `<audio>` element,
     not just client-side mute state) while toggling mute: unmuted
     baseline read ~110/255, muted read **exactly 0**, re-unmuted read
     ~105 — conclusively proving mute already fully stops outgoing
     audio at the transport level, with no leak. The actual cause of
     "echo when sitting next to each other" is ordinary acoustic
     coupling between two nearby devices' speakers and mics: browser
     echo-cancellation only cancels a device's *own* speaker feeding
     back into its *own* mic — it has no way to cancel a *different*,
     physically nearby device's speaker. Muting the transmit side can't
     fix this by definition, since the echo is the *unmuted* side's mic
     picking up the *other* device's speaker output, nothing to do with
     whether the far end is muted. Rather than a no-op "fix" to
     something that wasn't broken, added a real, honest mitigation: a
     tip in the new DM call banner ("🎧 Hearing an echo? Try headphones
     — muting stops your own mic, not the other device's speaker"),
     shown only while connected to a call with another real
     participant, so people get the correct explanation instead of
     concluding mute itself is unreliable.
     **Verified live**: the measurement above; separately confirmed the
     tip is hidden with only one participant and appears once a second
     one joins.
110. [x] **Bug report**: "On mobile it seem that the menu in the bottom
     in hidden under the mobile browser menu." Root cause: `body` used
     `height: 100vh`. On a mobile browser, `100vh` is calculated
     against the *largest* possible viewport — as if the browser's own
     address bar/bottom toolbar were already collapsed — not the
     actually-visible area while that chrome is on screen. That left a
     strip at the bottom, exactly the toolbar's height, rendered
     *underneath* it: precisely wherever bottom-anchored content
     lived, which is the composer and (since batch 24, item 107) the
     new mobile call bar. Fixed by adding `height: 100dvh` ("dynamic
     viewport height," which tracks the real visible area as the
     browser's chrome shows and hides) right after the existing
     `height: 100vh` — `vh` stays first purely as a fallback for older
     browsers that don't understand `dvh` yet, since CSS ignores a
     single declaration with an unsupported unit rather than the whole
     rule.
     **Verified**: confirmed `CSS.supports("height", "100dvh")` is true
     and that `body`'s computed height correctly resolves to the real
     `window.innerHeight` rather than a stale, inflated value, with the
     composer landing fully inside the visible viewport bounds. Not
     verified as a pixel-for-pixel before/after of a real toolbar
     hiding/showing — a headless browser has no actual dynamic toolbar
     to reproduce that against — but `100dvh` is the standard,
     widely-documented browser mechanism that exists specifically to
     solve this exact class of mobile issue, and the computed-style
     check confirms it's genuinely in effect rather than silently
     falling back to the old broken value.

### Batch 25 — 2026-09-15 (a Planly-inspired mobile composer, the real sideways-scroll bug, camera/screen-share on mobile)

Context: the user asked to get "inspired by the Planly implementation
for mobile" for Chatly's mobile chat. Planly turned out to be a local
sibling project (`/home/ebbemonster/docker_composes/Planly`, a
social-media scheduler with its own real-time chat feature) — its
`ChatComposeBox.tsx` uses a genuinely good, well-tested mobile pattern
worth borrowing directly: below 768px, the whole desktop toolbar (four
separate icon buttons) collapses into one round "+" button that opens
a compact popover grid with the same actions, next to a single-line
pill-shaped textarea and a round icon-only Send button, instead of
cramming every control into one row.

111. [x] **UX ask**: adopted that exact pattern for Chatly's mobile
     composer. Previously (batch 24) all four icon buttons
     (attach/emoji/markdown/preview) stayed visible on mobile with just
     tightened padding, leaving the textarea only ~184px wide. Now on
     mobile the four icon buttons are hidden and replaced with one
     `.composer-more-btn` ("+") that toggles a `.composer-more-menu`
     popover with the same four actions as labeled icon buttons in a
     4-column grid, closing on an outside click. The existing
     emoji-picker and markdown-snippet-popover logic was refactored out
     of the desktop buttons' inline click handlers into reusable
     `openEmojiPicker(anchor)`/`openMarkdownSnippets(anchor)` functions
     so the mobile menu items call the exact same logic, just anchored
     to the persistent "+" button instead of a hidden desktop button —
     necessary because a popover anchored to a `display:none` element
     has no valid bounding rect to position against. Desktop is
     untouched — the four-icon row still shows there.
     **Verified live** at 390px: the four icon buttons are hidden, the
     "+" button is visible, the textarea grew from ~184px to ~281px,
     all four popover items work (attach opens the file picker, emoji
     opens the real emoji popover correctly anchored near the "+"
     button rather than at (0,0), markdown and preview trigger the same
     as desktop), and the popover closes on an outside click. Confirmed
     desktop is unaffected (icon row visible, "+" button hidden there).
112. [x] **Bug report investigated and fixed**: "you have to scroll
     sideways to see all of the chat" — a real, confirmed root cause
     distinct from the composer. `.attachment-image` was hard-capped at
     `max-width: 320px` and `.attachment-video` at `max-width: 420px`,
     neither with a `100%` fallback (unlike `.attachment-audio`, which
     already had both a fixed width and `max-width: 100%`). A real
     image/video's natural size can reach those pixel caps, which are
     wider than a phone's actual available message-list content width
     (well under 390px, and under 420px, once the list's own padding is
     subtracted, on every phone screen) — pushing that one message's
     row wider than the message list's own box. Since `.message-list`
     doesn't set `overflow-x` explicitly (only `overflow-y: auto`),
     CSS's own cross-axis-coercion rule (a browser turns a `visible`
     overflow-x into `auto` whenever overflow-y isn't `visible`) makes
     the *entire* message list horizontally scrollable as one shared
     region the instant that happens — so scrolling right to see the
     rest of one wide attachment drags every other message sideways
     with it, exactly matching "scroll sideways to see all of the
     chat." Fixed by changing both to `max-width: min(320px, 100%)` /
     `min(420px, 100%)`, so an attachment can never exceed its
     container's actual available width on any screen size. Also
     audited every other hardcoded pixel `max-width` in the stylesheet
     (9 other occurrences) and confirmed each is already safe — paired
     with `width: 100%` (the `.modal` base class and its variants),
     already expressed in relative units (`vw`, or a percentage of an
     already-bounded parent), or a `white-space: nowrap; overflow:
     hidden; text-overflow: ellipsis` label that correctly truncates
     rather than expanding its container.
     **Verified live**: confirmed `.message-list`'s `scrollWidth ===
     clientWidth` with a real wide code block present (code blocks
     already self-contain their own overflow via `overflow-x: auto` on
     the `<pre>` itself — confirmed not to leak into the list), and
     confirmed zero page-level horizontal overflow at 390px, 360px, and
     320px viewports with long URLs, code blocks, and long unbroken
     words all present. The `min()` fix itself is a straightforward,
     low-risk correctness fix verified by direct CSS reasoning — not
     reproduced pixel-for-pixel with a synthetic overflowing video,
     since a fake/invalid video file falls back to the browser's
     300×150 default video-element size, which happens to already fit.
113. [x] **Bug report investigated**: "I cannot make neither the webcam
     share or screen share work on mobile" — two different situations,
     handled two different ways:
     - **Screen share**: `voice.ts`'s `toggleScreenShare()` had no
       feature detection at all before calling `getDisplayMedia` — on
       a browser where that function doesn't exist (true of most
       mobile browsers: mobile Safari and Chrome for Android don't
       implement `getDisplayMedia` at all, a real platform limitation
       with no client-side workaround), the resulting synchronous
       `TypeError` landed in a `catch` block written to treat *any*
       failure, including "the user cancelled the picker," as not
       worth surfacing — so tapping the button on an unsupported
       mobile browser did *nothing at all*, with zero feedback. Fixed
       two ways: (a) `chat.ts` now feature-detects `typeof
       navigator.mediaDevices.getDisplayMedia !== "function"` once at
       composer-construction time and hides both the sidebar and
       mobile screen-share buttons outright when it's missing, so
       there's no dead-end tap in the first place; (b) `voice.ts`'s
       `toggleScreenShare()` also checks this itself and calls
       `onError` with an honest, specific message ("Screen sharing
       isn't supported on this browser...") as a second layer, in case
       a browser exposes the function but still can't deliver a
       stream.
       **Verified live**: confirmed the button stays visible and
       functional in a normal browser, and confirmed — using
       `Object.defineProperty(navigator.mediaDevices,
       'getDisplayMedia', { value: undefined })` injected via a
       page-init script to accurately simulate a browser that
       genuinely lacks the API (a plain `delete` doesn't work since
       it's a prototype method, not an own property) — that the button
       correctly disappears in that case, while staying visible in a
       real/normal browser context.
     - **Webcam (camera)**: could **not** reproduce any failure in a
       live two-account mobile-viewport test — `getUserMedia`
       succeeded, the resulting `<video>` element rendered visibly and
       correctly sized (374×280px) within the mobile stacked
       video/chat layout, with real frame data flowing (`readyState:
       4`, `videoWidth: 640`). Since this environment can't reproduce a
       real phone's OS/browser camera-permission state, applied one
       well-established mobile-reliability hardening as a genuine
       improvement rather than a confirmed fix: changed the camera
       request from bare `video: true` to `video: { facingMode: "user"
       }` (an *ideal* preference, not a hard `exact` requirement, so a
       device with no front camera, or a plain webcam with no
       front/back concept at all, still gets a camera rather than
       failing outright) — the standard documented way to request a
       camera on a phone, and known to help with some mobile Safari
       quirks around unconstrained video requests, though **not a
       confirmed fix** for whatever specific failure the user is
       hitting. Needs the user's own report of what actually happens
       when they tap the camera button on their phone (permission
       prompt that fails? nothing visible at all? a specific error
       message?) to pin down further.

### Batch 23 — 2026-09-15 (call reliability, screen-share audio, settings cleanup)

100. [x] **Bug report**: "voice-participant-volume cannot move all the
     way to minimum or maximum for my friend." These sliders are only
     56-72px wide (deliberately unobtrusive — see their CSS), which
     makes landing the mouse on the *exact* pixel for 0% or 100%
     error-prone — a drag that's a couple of percent short of an edge
     reads as "the slider won't go all the way" even though the input
     itself works fine (dragging clearly *past* an edge does correctly
     clamp to 0/100 — confirmed by direct testing before writing the
     fix). Added a shared `wireRemoteVolumeSlider` helper (chat.ts)
     used by both the sidebar and video-tile volume sliders that snaps
     to 0 or 100 once a drag gets within 3% of either edge — the same
     trick Discord's own volume sliders use.
     **Verified live**: programmatically drove a slider to near-zero
     and near-100 values and confirmed it snapped to exactly `0` and
     `100`, in a real two-account voice call.
101. [x] **Feature request**: "share the screen with sound, e.g. if you
     want to cowatch something... this would also involve adjusting the
     volume of that independently of the friend." `voice.ts`'s
     `toggleScreenShare` now requests `audio` in `getDisplayMedia`
     (with mic-oriented echo-cancellation/noise-suppression/auto-gain
     turned off, since those mangle played-back media) and
     `systemAudio: "include"` so the browser's picker offers it where
     supported. `join()` sends the screen stream's audio track tagged
     `"screen"` — reusing the existing `video_purposes` wire field,
     which turned out to already be applied generically server-side
     regardless of media kind (confirmed by reading
     `crates/server/src/voice/mod.rs`'s `TrackIn`/`negotiate_if_needed`
     — the "video" in its name is misleading, not a real restriction),
     so **no server-side changes were needed at all**. A new
     `onRemoteScreenAudioChange` callback lets the UI show a second,
     independent volume slider on that person's video tile
     (`.video-tile-screen-volume`) only while their share actually
     carries audio — keyed via the existing `videoKey(userId, "screen")`
     scheme, reused as-is for `remoteVolumes`/`remoteAudioEls` so no new
     preference storage shape was needed either.
     - **Real, unfixable-from-here platform limitation worth knowing
       about**: full desktop/system-audio capture via `getDisplayMedia`
       only works on Windows/Linux Chrome. macOS Chrome (a browser
       limitation, not this app) only ever captures a *shared tab's*
       audio, never whole-system audio, no matter what's requested.
     **Verified live** with a real two-account voice call: injected a
     synthetic `getDisplayMedia` override (a canvas video track plus an
     oscillator-driven audio track, since headless Chromium can't drive
     a real screen-share picker) on one side, confirmed the independent
     screen-audio slider appeared on the other side once sharing
     started, could be dragged to a value independently of the mic
     slider, and disappeared cleanly the moment the share stopped.
102. [x] **Bug report**: "a bit of lag does not instantly kill the
     connection. That has happened a few times." `voice.ts` used to call
     `leave()` — a full call teardown — the instant
     `RTCPeerConnection.connectionState` reached `"failed"`, which
     ordinary packet loss or a brief wifi drop can trigger well before
     the connection is actually unrecoverable (the ICE agent keeps
     retrying in the background the whole time). Added
     `RECONNECT_GRACE_MS` (15s, matching the server's own existing
     `ICE_DISCONNECT_GRACE` in `crates/server/src/voice/mod.rs` — the
     client shouldn't give up sooner than the server would anyway).
     Entering `"disconnected"`/`"failed"` now starts a grace timer and
     fires a new `onReconnecting` callback — the voice status bar shows
     a pulsing "⚠️ Reconnecting…" label instead of nothing (or, before
     this fix, the call just vanishing) — and recovering to
     `"connected"` before the deadline cancels the timer silently with
     no visible interruption at all.
     **Verified live** by monkey-patching a *real* `RTCPeerConnection`
     instance's `connectionState` getter (captured via a constructor
     proxy installed before `join()`) and dispatching genuine
     `connectionstatechange` events on it — confirmed the call survived
     4+ seconds in a forced `"failed"` state while showing the
     reconnecting cue; confirmed recovering to `"connected"` cleared the
     cue with the call never actually torn down; and separately
     confirmed that waiting out the *full* 15s grace with no recovery
     does correctly end the call.
103. [x] **UX ask**: "have these sound bars, such that people can see if
     sound is registered in mic and output." Added a live level meter
     under the microphone dropdown in Settings → Devices, driven by a
     real `AnalyserNode` on an actual (separate, short-lived)
     `getUserMedia` capture — started when the tab opens (only if mic
     permission is already granted, so opening Settings never triggers
     a surprise permission prompt) or right after granting it, restarted
     on device change, and always stopped via a new cleanup-callback
     lifecycle added to the whole Settings modal (tab switch *and*
     modal close both call it) so a live mic capture never lingers in
     the background. A "Test" button next to the speaker dropdown plays
     a short tone through the selected output device — routed through a
     real `<audio>` element specifically because `setSinkId` (the only
     way to pick *which* device it plays on) lives on `HTMLMediaElement`,
     not portably on `AudioContext` — and pulses a second bar in sync,
     since there is no way for a browser to read back the actual analog
     level coming out of real speakers.
     **Verified live**: the mic meter read a genuine nonzero level from
     Chromium's fake input device (which emits a constant tone) without
     any manual trigger; clicking "Test" applied the pulse animation.
104. [x] **UX ask**: "Maybe this should just have its own menu item
     called 'Logout' instead of being in 'Security'." Split "Sessions /
     Log out / Log out everywhere" out of the Security tab into its own
     top-level "Logout" tab in the Settings nav — signing out isn't a
     security *setting*, it's an action, and nesting it one level under
     an unrelated heading just made it harder to find. Security now
     holds only Two-factor authentication and Friend requests; Account's
     nav icon changed from a stray `log-out` (a leftover from before
     logout moved out of it) to `trash`, matching what it actually holds
     (GDPR export/delete).
     **Verified live**: Settings tabs now read Profile / Devices /
     Security / Account / Logout / Admin; the Logout tab shows "Log out"
     and "Log out everywhere"; Security no longer has a "Sessions"
     heading at all.
105. [x] **UX ask**: "'Anyone can create invites' ... should be in the
     top to avoid it hiding below all the members, and it should
     probably be a radio dial for consistency." Moved it to the top of
     Manage Server → Members (was a checkbox appended after the entire
     member list) and converted it to a two-option radio group ("Anyone
     can create invites" / "Only the server owner can create invites"),
     matching the exact `.radio-group`/`.radio-row` pattern already used
     for the GDPR account-deletion mode choice (batch 21, item 90) — the
     "consistency" the request asked for.
     **Verified live**: screenshot confirms the radio pair renders above
     the member list, and toggling either option round-trips through
     `PATCH /api/guilds/:id/invite-policy` exactly as the old checkbox
     did.
106. [x] **UX ask**: "'Manage Server' is very messy with no clear
     division of things... just buttons all over the place: Danger
     zone." The whole Danger Zone tab was one flat `<section>` with a
     member-transfer dropdown, its button, a delete-confirmation input,
     and its button all run together with nothing distinguishing which
     controls belonged to which action. Split into two `.danger-subsection`
     blocks, each with its own `<h4>` heading and a divider between them
     — "Transfer ownership" (with its explanatory hint) and "Delete
     server" (with its type-to-confirm hint) — same idea as the
     already-categorized channel-manage and guild-settings tab shells
     elsewhere, just applied one level deeper within a single tab.
     **Verified live**: screenshot confirms the two actions now read as
     clearly separate labeled groups instead of one undivided list.

### Batch 22 — 2026-09-15 (paste-to-upload)

99. [x] **UX ask**: "make it work such that you can paste stuff into
    the chat e.g. an image or stuff" — pasting an image (a screenshot,
    one copied from a browser/image editor) or any other file copied
    from the OS file manager directly into the composer (Ctrl+V) now
    uploads it exactly like picking it via the paperclip button,
    instead of doing nothing or dumping raw binary as garbled text.
    - Refactored the file-input `change` handler's body into a shared
      `startUpload(file: File)` used by both the paperclip picker and
      a new `paste` listener on the composer textarea.
    - The paste listener reads `event.clipboardData.items`, collects
      only items with `kind === "file"`, and calls
      `event.preventDefault()` **only when at least one file is
      present** — plain text paste (including pasting text that
      happens to contain an image URL) is left completely untouched,
      and multiple pasted files (rare, but some clipboards carry more
      than one) all upload individually through the same progress-chip
      UI as a normal multi-attachment pick.
    **Verified live**: a real Playwright session against an isolated
    instance dispatched a synthetic `ClipboardEvent` carrying a real
    `File` (a decoded 1×1 PNG) at the composer's `<textarea>` —
    confirmed an attachment chip appeared immediately (same
    upload-in-progress chip as the paperclip path), and after sending,
    the message's rendered HTML contained a real `<img>` element
    (invisibly small only because the test asset itself was a 1×1
    pixel, not because anything was broken).

### Batch 21 — 2026-09-15 (self-DM cleanup, upload feedback, a real network-direction bug)

84. [x] **UX ask**: clean up "Add a friend" — drop the subheading
    sentence duplicating what the search field's own label/placeholder
    already said, remove the "Message yourself" button entirely, and
    make "yourself" (the self-DM/"note to self") always show at the
    top of the DM list instead of needing an explicit button to create
    it in the first place.
    - `renderUserSearchModal`'s `subheading` is now optional (only
      rendered when passed) — the "Add a friend" call site drops it;
      the "Add people to this conversation" one (a DM's own "+")
      still passes one since that context genuinely isn't obvious
      from the search field alone.
    - The self-DM is no longer something a button creates on demand —
      `GET /api/dms` now unconditionally ensures it exists first
      (`get_or_create_dm` is a cheap no-op once it does; no migration
      needed, works retroactively for every existing account too) and
      the DM list's own ordering (`queries::dms::list_for_user`) sorts
      it first *unconditionally*, ahead of pins and recency, not just
      "usually first because it's often pinned."
    **Verified live**: a brand-new account's very first `GET /api/dms`
    already includes the self-DM with zero prior action; pinned a
    *different* conversation and confirmed the self-DM still sorted
    first ahead of it; confirmed in the real UI that the DM list shows
    "You" at the top and the "Add a friend" modal has no "Message
    yourself" button and no redundant subheading text.
85. [x] **UX ask**: better feedback while uploading a file — it
    looked stuck with nothing visible happening until the attachment
    suddenly appeared. `api.upload` used `fetch`, which has no
    portable progress event for the outgoing/request side at all (only
    the response/incoming side exposes one, via a `ReadableStream`,
    which tells you nothing about bytes still going *out*). Added
    `api.uploadWithProgress` using `XMLHttpRequest` instead, whose
    `upload.onprogress` has always supported this. The composer now
    shows a live progress chip (filename, a fill bar, a percentage)
    the moment a file is picked, updates it in place as bytes go out
    (without rebuilding the whole attachment strip's DOM on every
    progress tick), and swaps it for the normal finished-attachment
    chip on success — or an inline error state on failure, instead of
    the previous behavior of the whole attach button just going
    disabled with no other signal. Also stopped disabling the attach
    button during an upload — now that there's real per-file state
    visible, there's no need to block picking a second file while the
    first is still going.
    **Verified live**: attached a 2 MB file in the real UI and
    confirmed a progress chip appears immediately at 0%, watched the
    percentage advance, and confirmed it's replaced by a normal
    attachment chip once the upload completes.
86. [x] **Bug report**: "Network usage" seemed to only reflect
    downloads, never uploads — confirmed as a real, and quite literal,
    mix-up: `sysstats.rs` names its two numbers from the *server's*
    point of view (`net_rx_bytes_per_sec` = bytes the server
    received, `net_tx_bytes_per_sec` = bytes it sent), but the
    frontend had them backwards from the *user's* point of view — it
    labeled server-received (someone's upload) with a "↓" download
    arrow, and server-sent (someone's download) with "↑". Uploading a
    file made the "↓" number move and the "↑" one sit still, exactly
    matching the report. Swapped both the popover's two rows and,
    since the compact pill only ever showed the (mislabeled) rx
    number, changed it to show both directions at once rather than
    just picking the other single number to display instead.
    **Verified live**: confirmed the compact pill now reads
    `↓X ↑Y` with both numbers present and moving independently.
87. [x] **UX ask**: "it should be possible to delete a Server if you
    are admin" — already true, from batch 20 item 82's "Manage
    server" → Danger Zone (type-to-confirm delete, owner-only, same
    trust boundary this single-owner-per-guild app uses for every
    other destructive guild action). No code change needed here;
    re-verified end to end against a fresh instance rather than just
    trusting the earlier note: registered an owner, created a guild,
    and confirmed `DELETE /api/guilds/:id` actually removes it from
    that owner's guild list.
88. [x] **UX ask**: it should be possible to delete a message in a
    direct message the same way you can in a guild channel — turned
    out message deletion for your own messages already worked
    identically in both (`api::messages::delete` never distinguished
    guild from DM). What the report actually meant, confirmed with the
    user, was something else real and missing: a way to get rid of
    stale one-off conversations (ad-hoc group calls especially)
    cluttering the DM list, since there was no way to leave or hide
    one at all before this.
    - **Leaving a group** (3+ participants): a real departure —
      removes your own `dm_participants` row, `POST /api/dms/:id/leave`.
      Only allowed for an actual group; a 1:1 (or the self-DM) rejects
      with `not_a_group`, since removing yourself from a *2*-person
      conversation would leave exactly one participant row behind —
      structurally indistinguishable from a self-DM (see
      `queries::dms::find_existing_self`) — and corrupt the model for
      whoever's left. Remaining participants see the departure live
      via a new `DmParticipantLeave` gateway event.
    - **Hiding a 1:1** (or a group that's shrunk back down to one):
      `POST /api/dms/:id/hide` — new `hidden_dms` table (same shape as
      the existing `pinned_dms`), but deliberately no `unhide` write
      path at all: `queries::dms::list_for_user` excludes a hidden
      channel only while `hidden_at` is at or after that channel's own
      most recent message, so a new message arriving un-hides it
      automatically, purely as a side effect of that comparison — no
      write-side hook needed on message creation, and no risk of
      silently losing a new message just because the conversation used
      to be hidden.
    **Verified live**: created a real 3-person group DM, had one
    person leave it, and confirmed the remaining two still see it
    (participant list correctly down to just each other) while the
    person who left doesn't see it at all anymore; confirmed leaving a
    1:1 is rejected with a clear error; hid a 1:1 conversation and
    confirmed it disappears from the list, then had the other person
    send a new message into it and confirmed it reappeared with no
    further action needed.
89. [x] **Bug report**: after a video call, the chat was left stuck
    shoved to one side with a big empty space where the video panel
    used to be, until a full page refresh. Tried to reproduce solo
    (camera alone, camera+screen together, switching channels mid-call
    then leaving) and the layout collapsed correctly every time — the
    actual trigger, confirmed with the user, was specifically a
    2-person call where *the other person* disconnects (not a graceful
    hangup) while you stay in the channel. Root cause: a remote
    participant's video tile was only ever cleaned up by their
    WebRTC track firing its `ended` event (see `voice.ts`'s
    `attachRemoteTrack`) — reliable for a graceful "camera off" or
    hangup, but not guaranteed on an abrupt disconnect (network drop,
    crashed tab, ICE failure), since that's a transport-level event
    with no cross-browser guarantee of firing just because the
    connection died. Fixed by *also* clearing that person's video tile
    from the already-existing, already-authoritative
    `voice_state_update` gateway event (the same one that already
    drives the peer-join/leave sound and the sidebar participant list)
    instead of relying solely on the WebRTC-level signal — this is the
    server's own "are they still in this call" determination (backed
    by the existing `ICE_DISCONNECT_GRACE` timeout), so tile cleanup
    can no longer depend on an event that isn't guaranteed to fire.
    Harmless if the `ended` event *also* fires moments later (removing
    an already-removed tile is a no-op).
    **Verified live, real 2-account reproduction of the exact
    scenario**: both accounts joined a voice channel with cameras on
    (confirmed 2 tiles visible), then one account's entire browser
    context was closed outright (not a graceful "Disconnect" click) to
    simulate a real crash/network loss. After the server's
    `ICE_DISCONNECT_GRACE` window elapsed, confirmed the remaining
    account's tile count dropped from 2 to 1 (their own tile only) and
    the video panel correctly stayed sized to just that — then, after
    they also left, confirmed the panel fully collapsed
    (`display: none`) and the chat column reclaimed the full width
    (`chat-column` width exactly equal to `content-split` width, no
    leftover gap).
90. [x] **GDPR — self-service export and deletion, and a superadmin
    way to remove any other account.** Three asks folded together
    since they share the same underlying capability: users can export
    all their own data, delete their own account, and the instance
    owner can delete anyone else's.
    - **The account-deletion tradeoff was put to the user rather than
      guessed at**: asked whether a deleted account's messages should
      be anonymized in place or actually erased, and got back "let the
      user choose... because messages are never entirely anonymous
      (like in reddit too) — that would be the most fair." Built
      exactly that: every deletion (self-service or admin-triggered)
      takes an explicit `mode`.
      - **Anonymize**: username/display name overwritten
        (`deleted-user-<id>` / "Deleted User"), login blocked
        (`users.deleted_at`), sessions/MFA/friendships/guild
        memberships all gone — but message content stays exactly
        where it was, now rendering under the anonymized name.
      - **Erase**: everything `Anonymize` does, plus every message
        the account ever sent is actually deleted. Any reply pointing
        at one of those messages has its `reply_to` cleared first
        rather than being silently cascaded away too (`messages.reply_to`
        has no `ON DELETE` clause — deleting a message someone replied
        to would otherwise be flatly rejected by that foreign key).
      - **Neither mode actually drops the `users` row.** Doing so
        would hit several more NO-ACTION foreign keys with no cascade
        (`guilds.owner_id`, `invites.created_by`, `channels.created_by`)
        that would each need individually resolving for no real
        privacy benefit over the alternative — a row with no personal
        data left in it isn't personal data. `deleted_at` blocks login
        and hides it from search; everything else about it (message
        history, guild-membership history) already reads correctly
        through the anonymized name.
      - **The one precondition, shared by both self-service and
        admin-triggered deletion**: no automatic "pick a new owner"
        exists, so an account that still owns a guild *with other
        members in it* can't be deleted until that's resolved by hand
        (transfer ownership, or delete the guild — both already-existing
        flows); a guild they own with no one else in it is just taken
        down with them automatically.
    - **Self-service** (`DELETE /api/me`, Settings → Account): requires
      re-entering your password, like the existing change-password
      flow. The instance owner can't use this on their own account —
      there's no instance-ownership-transfer feature, so deleting the
      one `is_owner` account would brick the platform's own admin
      capability with no way to recover it.
    - **Superadmin** (`POST /api/admin/users/:id/delete`, a new
      owner-only "Admin" settings tab listing every account): `is_owner`
      is already this app's one instance-wide admin flag (set only on
      the very first account ever registered) — that's the "superadmin
      of the whole Chatly platform" the ask was about, not a new role.
      Can't be used to delete the instance owner's own account either.
    - **Export** (`GET /api/me/export`, downloads a JSON file):
      profile, guild memberships, DM channels, and every message
      you've ever sent — deliberately thinner than the app's own
      internal message shape (no per-viewer reaction/mention
      enrichment computed just for this specific request; an export
      is about *this account's own* data, not a full conversation
      replay).
    - **Also cleaned up along the way** (the same settings tabs this
      touched): merged "Log out"/"Log out everywhere" into Security's
      session section instead of a separate "Account" tab section —
      there was never a good reason session controls lived in two
      places, and "Account" is a better fit for the account-level
      actions (export, delete) added here anyway. Also stopped
      unconditionally showing the current device's full user-agent
      string and last-seen time inline in Security — that only appears
      now once "Specify removal" is clicked, matching how the *other*
      sessions already worked; it read as cluttered for what's meant
      to be a quick glance.
    **Verified live end-to-end, real multi-account, isolated instance**:
    anonymized one account after it posted a message — confirmed the
    message survives under "Deleted User", the account can no longer
    log in (401, same generic "invalid credentials" a wrong password
    would give), and its old session is immediately dead. Erased a
    second account after it posted a message — confirmed the message
    is actually gone. Had a *third* account reply to the first
    (anonymized) account's message, then had the instance owner
    erase that first account via the admin endpoint — confirmed the
    reply survives with its quote-reference cleared rather than being
    cascaded away. Confirmed a non-owner guild owner is blocked from
    self-deleting while another member is still in their guild, with
    the guild named in the error. Confirmed the data export returns a
    real account's guilds/DMs/messages, the admin list is 403 for a
    non-owner, and the real Settings UI reflects all of this
    (Security shows just the two logout buttons plus, only when other
    sessions exist, "Remove all"/"Specify removal"; Account shows
    Export + a working delete form for a regular account, and a
    "can't be deleted" note instead for the instance owner; Admin
    lists every account including the already-deleted ones with a
    "Deleted" badge and correctly hides the Delete action for both the
    owner and already-deleted rows).
91. [x] **Bug report**: the composer's own "Math (LaTeX)" formatting
    snippet inserted a ```` ```latex …``` ```` fence with
    `e^{i\pi} + 1 = 0` as its placeholder — and sending that exact,
    unmodified snippet did *not* render as math. Root cause:
    `markdown.ts`'s fence handling checks for a fenced block *before*
    it ever checks for math syntax, and treated every fenced block
    (language tag or not) as a plain, verbatim code block — matching
    `markdown-snippets.ts`'s own top-of-file comment, which flatly
    said so ("Math/LaTeX isn't actually *rendered*... the snippet just
    drops the source into a fenced code block"). That comment was
    stale: real KaTeX rendering was added to `markdown.ts` at some
    point *after* that comment was written (`$$...$$` already worked
    correctly), but the snippet — and the fence handler — were never
    updated to match, so the app's own composer was actively
    generating an example its own renderer couldn't render. Fixed the
    renderer, not just the example: a fenced block tagged ```math or
    ```latex now renders as a KaTeX display-mode block, same as
    `$$...$$` — both are common conventions for "this fence is math"
    (GitHub, Obsidian, and others accept either), so recognizing both
    costs nothing and fixes the exact snippet without needing to
    change what it inserts. Updated the now-inaccurate comment and
    tab label ("Math (LaTeX source)" → "Math (LaTeX)") to match.
    **Verified live**: inserted the real "Math (LaTeX)" snippet from
    the composer's own formatting-snippets popover, sent it unmodified,
    and confirmed it renders as an actual KaTeX display block (not a
    code block) in the message list.
92. [x] **UX ask**: three pieces of redundant/messy text removed —
    the create-channel modal's "Only you can see this channel at
    first…" hint (channel-membership behavior that was never in
    question and added nothing the modal didn't already make obvious),
    and the unified-invite modal's "Anyone with this link can join…"
    explanation (the modal's own heading and content already say
    what it's for).
93. [x] **UX ask**: "Manage #channel" dumped Admins/Members/Danger-zone
    as one flat scrolling list — same complaint and same fix as batch
    20 item 82's "Manage server": rebuilt with the identical
    build-once-toggle-hidden tabbed shell (Admins, Members when the
    channel is restricted, Danger Zone), so adding/removing an
    admin or member updates that panel in place without losing
    whichever tab is open, and a channel with no restricted-members
    concept at all doesn't even show a "Members" tab with nothing
    useful in it.
    **Verified live**: confirmed the tabs render (Admins + Danger Zone
    for a non-restricted channel), exactly one panel visible at a
    time, and the Danger Zone tab's delete button is reachable.
94. [x] **UX ask**: clicking an image attachment just opened it in a
    new browser tab — a dead end with no way back to the conversation
    short of closing the tab, and no way to see any other image nearby.
    New `image-lightbox.ts`: a full-screen in-app overlay with
    previous/next arrows (and Left/Right/Escape keys) stepping through
    every image attachment currently rendered in the message list —
    snapshotted when the lightbox opens, so it's a fixed gallery for
    that viewing session rather than reshuffling if new messages
    arrive while it's open. Click anywhere outside the image closes
    it, same convention every other overlay in the app already uses.
95. [x] **Video call UX overhaul, inspired by Discord's own controls**
    — four real bugs plus one new feature, all in the same area:
    - **Full screen visibly corrupted the picture ("turning green")**:
      the button fullscreened the whole `.video-tile` container
      (label, controls, a possible camera-over-screen-share pip
      overlay, all flex/grid-positioned) instead of the `<video>`
      element itself. Fullscreening that complex nested layout was the
      actual bug — fixed by fullscreening the plain `<video>` directly,
      the same well-tested path any video site's own "watch
      fullscreen" button already relies on. Looked up fresh on every
      click (`.video-tile-main`) rather than the element captured when
      the button was created, since a camera/screen-share toggle swaps
      which element actually holds that class.
    - **"Focus this video" looked like it did something different
      every time**: nothing on the button (or the tile) ever reflected
      *which* tile — if any — currently held focus, so switching
      focus between tiles read as arbitrary rather than a clear
      toggle. Now shows a pressed/active state and swaps its icon
      (maximize ↔ minimize) to match.
    - **"Pop out" wasn't popping out the video — it opened a whole
      second browser window** via the Document Picture-in-Picture API
      (its own chrome, every stylesheet cloned into it), not the
      borderless floating video overlay "pop out" implies, and not
      supported outside Chromium at all. Replaced with a per-tile
      "pop out this video" button using the standard
      `HTMLVideoElement.requestPictureInPicture()` — the same
      universally-supported, chrome-less floating overlay every video
      site's own PiP button already produces. The whole-panel version
      is gone entirely, not just hidden.
    - **"Minimize" turned real video into a 48px circle**: a deliberate
      earlier design choice (mimicking Discord's *voice-only* "talking
      heads" bubbles), but cropping actual video content into a circle
      threw away too much of the picture to be worth keeping open at
      all — which defeated the entire point of minimizing instead of
      just leaving the call. Now shrinks to small (120×68) rectangular
      thumbnails that still letterbox properly, in a horizontal strip.
    - **New: "Hide chat"**, for a cam-to-cam-only view — collapses the
      chat column to nothing and lets the video panel claim the full
      width, next to the existing minimize control in the video
      panel's own toolbar.
    **Verified live**: joined a voice channel with the camera on and
    confirmed — the Focus button shows a pressed/active state after
    clicking and clears after un-focusing; the per-tile pop-out button
    is present and the old whole-panel one is completely gone; clicking
    Full screen actually makes `document.fullscreenElement` the
    `<video>` element itself with zero JS errors; Minimize produces
    120×68 rectangular (not circular) tiles; Hide chat actually hides
    `.chat-column` and the video panel's width grows to fill the
    freed space exactly (`video-tiles-panel` width equals
    `content-split` width), then un-hides correctly on toggling back.
    Did not get a way to visually confirm the *original* "turning
    green" corruption is gone frame-by-frame (that needs a human
    watching a real fullscreen transition, not a headless screenshot)
    — the verification above confirms the fix targets the right
    element via the right, standard API with no errors, which is what
    the fix actually changes.
96. [x] **Feature request — a minimal real "extension point" for
    future plugins** (polls, a chess bot, a chatbot, a music-DJ bot,
    and anything else down the line). Deliberately *not* a new concept
    bolted onto the data model: a bot is an ordinary `users` row
    (`is_bot`) added to a guild exactly like any other member — every
    existing permission check and every existing message/reaction
    endpoint already works for it, completely unchanged. The only new
    thing is *how* it authenticates: a long-lived bearer token
    (`Authorization: Bot <token>`, hashed at rest the same way a
    session token is — never stored or shown again after creation)
    instead of a session cookie, since it never logs in with a
    password in the first place (`by_username_for_login` excludes
    `is_bot` rows defensively even though nothing generates a login
    form for one).
    - **Least-privilege by construction**: `CurrentUser::require_human`
      rejects a bot token outright at every account/session-management
      endpoint (password, MFA, sessions, profile, avatar, invite
      creation, admin actions, bot creation itself) — a leaked bot
      token can only ever post/react in channels the bot's actually a
      member of, exactly like a human member could, nothing more.
    - **Creating one** needs `MANAGE_GUILD` (a standing member, not a
      one-time invite link, so the higher bar than `CREATE_INVITE`)
      via a new "Bots" tab in "Manage server" (categorized the same
      way the rest of that modal is — see batch 20 item 82) — shows
      the token exactly once, and a "Revoke token" per bot that
      disables it immediately without touching the account or its
      guild membership (its past messages stay attributed to it).
    - **Explicitly out of scope**: a bot joining a voice/video call
      (the "DJ" use case) — that needs a real WebRTC client
      implementation on the bot's own side, not just a REST API
      surface, and is a much bigger lift than this first extension
      point. What's here is the foundation every *text*-based bot
      needs before any of those can exist at all; building what a bot
      actually *does* is a separate program entirely, not something
      this app sets up.
    **Verified live, real guild, real bearer-token request**: created a
    bot from the real "Manage server" → Bots UI, then — using nothing
    but `curl` and the returned token, no cookie at all — posted a real
    message through the ordinary `POST /channels/:id/messages`
    endpoint and reacted to it, confirmed `GET /me` resolves the bot's
    own identity, confirmed the bot is flatly rejected (403
    `bot_not_allowed`) from a sensitive endpoint (`/me/export`) and
    from logging in with a password, and confirmed revoking its token
    immediately breaks further requests (401) without touching
    anything else about the account.
97. [x] **Feature request — invite someone to a quick video call, no
    signup required, "but make sure it is secure."** Reused the
    existing DM-participant isolation guarantee this codebase already
    relies on elsewhere (a DM participant sees *nothing* beyond that
    one conversation — no guild list, no other members, nothing) rather
    than building a whole separate parallel auth/permission system for
    "guest" under time pressure on something explicitly flagged as
    security-sensitive: a real, untested new code path would have been
    the riskier choice, not the safer one.
    - A guest is a real account and a real session under the hood —
      just an ephemeral one (`users.is_guest`, `guest_expires_at` 12
      hours out) that inherits every already-verified property of the
      normal session/permission machinery (channel-scoped checks,
      gateway room isolation, rate limits) instead of reimplementing
      any of it.
    - **Only ever works for a DM invite, never a guild one** — a new
      `GET /api/invites/:code/preview` (public, read-only, doesn't
      spend the invite's use count) tells the signed-out visitor's
      client which form to show *before* they type anything: the full
      registration form for a guild-destination invite, or just a
      "Join the call" display-name prompt (`POST /api/register-guest`)
      for a DM-destination one. A guild invite is flatly rejected by
      `register_guest` itself too (`not_a_dm_invite`), not just hidden
      client-side.
    - **`CurrentUser::require_human` also rejects a guest** now, same
      as a bot — no password to change, no MFA, no data to export, no
      bot/invite creation, nothing beyond that one conversation and
      its call.
    - **Auto-expiry with no cron needed**: `CurrentUser`'s own
      session-cookie resolution checks `guest_expires_at` on every
      request and, the first time it notices one has lapsed, treats it
      exactly like an expired session *and* opportunistically cleans
      it up by reusing the GDPR self-deletion erase path (item 90) —
      whatever the guest posted in that call goes with it.
    **Verified live, real multi-account, isolated instance, actual
    WebRTC call**: previewed a DM invite (`is_dm: true`) and a guild
    invite (`is_dm: false`) from the same account; joined as a guest
    with nothing but a display name and confirmed via the API that
    their guild list is completely empty while their DM list holds
    exactly their own self-DM plus the one shared call; confirmed a
    guest is rejected (403) from a sensitive endpoint and that a guild
    invite can't be used for guest join (400 `not_a_dm_invite`); then,
    in a real browser with no cookies at all, followed the invite link
    end to end — landed on "Join the call" (not the registration
    form), joined with just a name, and landed directly in the shared
    conversation next to the real account that sent the invite.
    Finally, with a real account and the guest both actually in the
    call, confirmed **both** sides show a connected voice status bar —
    a genuine two-party call over the app's real WebRTC/gateway
    infrastructure, not just an account/permissions check.
98. [x] **UX ask**: "a beautiful mobile interface... with hamburgers...
    allow background use of the chat and all that good stuff." Built
    an off-canvas navigation drawer (`@media (max-width: 768px)`) that
    combines the guild rail and sidebar behind a new hamburger button
    in the channel header, plus vertical stacking of the video/chat
    split and a horizontally-scrolling settings tab strip in place of
    the desktop side column. **Explicitly out of scope, flagged here
    rather than attempted**: true "background use" (staying connected
    and receiving notifications while the phone's screen is off or
    another app is in front) needs PWA/service-worker/push
    infrastructure — a separate project, not a CSS/layout change — and
    literal FaceTime-style native call chrome (a system-level
    full-screen incoming-call UI outside the browser tab) isn't
    something a web app can produce at all without that same PWA
    wrapper. What's live today is a real mobile *layout*, not an app
    shell; both are worth a dedicated follow-up if wanted.
    - Live testing on a real 390×844 viewport caught three genuine
      layout bugs that would have shipped broken if only reasoned
      about rather than rendered and clicked:
      1. The drawer's closed-state rule used
         `transform: translateX(-100%)`. That only fully clears an
         element anchored at `left: 0`. `.sidebar` sits at `left: 76px`
         (immediately right of the 76px guild rail), so sliding it left
         by *its own* width left its right edge still at `x=76` — a
         76px-wide sliver of it stayed on-screen and intercepted clicks
         meant for the hamburger button underneath, confirmed via
         `document.elementFromPoint()` at the hamburger's exact
         coordinates returning the sidebar's own "Invite people"
         button. Fixed by using `translateX(-100vw)` instead, which
         clears the full viewport regardless of the element's own width
         or `left` offset.
      2. The composer's icon row (attach/emoji/markdown/preview) plus a
         text+icon Send button left the actual message textarea about
         69px wide on a 390px screen — barely enough for four
         characters, with the "Message #general" placeholder truncated
         to "Messa". Fixed by hiding the Send button's text label
         (wrapped it in its own `<span class="send-button-label">` so
         CSS could target just the text, not the icon) and tightening
         the composer's padding/gaps on mobile — the input box grew
         from 69px to 184px and the placeholder now reads in full.
      3. Opening Settings (or any other modal) while the drawer was
         open rendered it *behind* the drawer and unreachable —
         `.modal-backdrop` was `z-index: 10` while the mobile drawer is
         `z-index: 20`. Fixed by raising `.modal-backdrop` to
         `z-index: 30` (above every mobile-only layer, still below the
         image lightbox's 50) so a modal is never hidden regardless of
         which UI it was opened from, and additionally made the
         Settings button close the drawer on click for a cleaner
         transition (matching the channel list's existing
         close-on-select behavior).
    **Verified live**: real Playwright session at a 390×844 viewport
    against an isolated instance — confirmed zero horizontal page
    overflow, the hamburger button visible and clickable, the drawer
    opening to show the full guild rail + channel list, the drawer
    auto-closing on selecting a channel, the composer's input box wide
    enough to read its own placeholder, and — after the three fixes
    above — Settings opening correctly on top of the drawer with its
    tab strip scrolling horizontally and no tab content clipped.

### Batch 19 — 2026-09-14 (real bugs found from the live `chatty.ebbemonster.dk` deployment)

68. [x] **Live bug report**: joining voice with the webcam on showed a
    blank tile labeled "Someone" with no one else actually in the
    call, seen right after the deployment in batch 18 went live. This
    is the same phantom-tile symptom flagged as a live-only unknown in
    batch 18 item 66 — now root-caused for real, from actual server
    logs: the account's own two join attempts both got stuck at ICE
    `Checking` and never reached `Connected` (visible in
    `docker logs`), and — this was the actual bug — **a voice
    connection that never connects in the first place had no timeout
    at all**. `ICE_DISCONNECT_GRACE` only ever covered a connection
    that connected and *then* dropped; one stuck at `Checking` forever
    just sat alive in server memory indefinitely, its video track
    already negotiated into the SDP at offer time (before ICE even
    runs), so it kept getting offered to the next joiner as a real
    track that could never produce a frame — hence a permanent blank
    "Someone" tile. Fixed by starting `VoiceClient::disconnected_since`
    at `Some(now)` instead of `None` (rather than only setting it on
    an actual `Disconnected` event) — so a connection that never
    connects ages out through the exact same, already-tested
    `ICE_DISCONNECT_GRACE` timeout as a connection that drops after
    connecting. Verified via `cargo test`/`clippy` (no behavior change
    for the already-covered case, confirmed by reading through the
    same tests) and by redeploying; could not re-trigger a stuck
    connection live to watch the new timeout fire, since (per item 66)
    this environment can't reliably drive one to "stuck" on demand —
    logged as a real fix reasoned through carefully, not click-tested
    end-to-end.
    Separately noted, **not a code bug but worth understanding**: if
    you test from the same home network the server itself is hosted
    on, your own device reaching the server's own public IP can fail
    outright if your router doesn't support NAT hairpin/loopback (very
    common on consumer routers) — that would explain a *solo* stuck
    connection without saying anything about whether a call with an
    actually-remote peer (different network) will work. Also worth
    flagging honestly: this app has no TURN relay configured, only
    plain host/server-reflexive ICE — real-world NAT combinations
    (especially symmetric NAT, common on mobile networks) can fail to
    connect at all without one. If a genuine two-network call still
    won't connect after this fix, a TURN server is the next thing to
    look at — a separate, bigger piece of infrastructure, not
    something to add speculatively before confirming it's needed.
69. [x] **Live bug report**: registering a new account via an invite
    code "did not work" after inviting a friend. Investigated the
    deployed config first (spotted `TRUSTED_PROXY` was never set when
    batch 18 put the app behind nginx, which — without it — makes
    every real visitor look like the same IP to the server, quietly
    turning the per-person registration rate limiter global across the
    whole site). Fixed that regardless since it's a real bug on its
    own (see `TRUSTED_PROXY` in `docker-compose.yml`), but it turned
    out **not** to be this specific report's cause — see item 70,
    which found and fixed the actual bug once the real error message
    ("Invite code invalid") came back. Leaving this one struck through
    rather than deleted since the `TRUSTED_PROXY` gap was real and is
    now fixed, just not the culprit here.
70. [x] **Live bug report, continued**: the actual error the invitee
    saw was "Invite code invalid" — a specific, different signal from
    item 69's rate-limit theory, and enough to find the real bug:
    **the invite-code check never trimmed whitespace or normalized
    case**. Codes are generated from an uppercase-only alphabet
    (`token::INVITE_ALPHABET`), but nothing enforced that on the way
    *in* — `body.invite_code.as_deref().filter(|c| !c.is_empty())` in
    `auth::register`, then an exact-match SQL lookup (`code = ?1`)
    with no `.trim()`/`.to_uppercase()` anywhere in between. A code
    obtained by voice or text (the realistic way anyone without an
    account yet gets one — there's no in-app way to hand one to a
    non-existing user, see item 65) and retyped by hand has every
    reason to end up lowercase or with a stray leading/trailing space
    from a copy-paste, and either one silently fails the exact match —
    "invalid" for an objectively correct code. Fixed by normalizing
    (`trim` + `to_uppercase`) right before the lookup in both
    `auth::register` and the equivalent guild-invite-join path
    (`guilds::join`, same generator, same latent gap, fixed for
    consistency even though it wasn't reported).
    **Turned out not to be the cause either** — see item 71, which
    found the real one from the actual code the invitee used. The
    trim/uppercase fix is real and stays (a genuine latent gap), just
    wasn't what was breaking this specific link.
71. [x] **Live bug report, actually resolved**: got the exact code
    from the failed attempt (`VA4QQMDQ`) and checked it directly
    against the live database — it existed, but in the `guild_invites`
    table, not `invites`. **App invites (create a brand-new account)
    and guild/server invites (let an existing account join one more
    server) were sharing the exact same URL shape**
    (`/invite/<code>`, from both `invites::create` and
    `guilds::create_invite`) — same 8-character alphabet, so visually
    and functionally indistinguishable, but only one of them can
    create an account. The "Invite people to this server" button
    inside a server (not Settings → Invites) generates the *other*
    kind, and that's what had been used and reshared five times
    running — every single one of those codes was always going to
    fail registration, because a server invite fundamentally can't do
    what registration needs. Confirmed by reproducing the exact same
    "invalid" error myself, directly against the live API, with that
    exact code.
    Fixed for real this time:
    - Guild invites now generate a distinct `/guild-invite/<code>`
      URL (`guilds::create_invite`) instead of colliding with the app
      invite's `/invite/<code>`.
    - The client now actually handles `/guild-invite/<code>` — it
      didn't do *anything* useful with a guild-invite link before this
      (not even for its correct use case): boot() only ever checked
      for the registration-invite path and otherwise dropped straight
      into chat for an already-logged-in user, silently ignoring any
      guild code in the URL entirely. Now: signed out → shows login
      (not registration — a guild invite alone can't create an
      account) and redeems the code right after logging in; already
      signed in → redeems it immediately. Either way it lands the
      user as a member of that server.
    - Added a plain-language note to both invite dialogs (the
      per-server "Invite" modal and Settings → Invites) stating which
      one is for a brand-new person vs. an existing account, so this
      mixup — genuinely easy to make, the two features are named
      almost the same thing — can't happen silently again.
    **Actually verified live**, not just reasoned through: built a
    full scenario on an isolated instance (owner account, a friend
    added via a real app invite, a second server, a real guild invite
    for it) and drove it through an actual browser — confirmed
    `/guild-invite/<code>` correctly shows the login form (not
    registration) for a signed-out visitor, and confirmed via the API
    afterward that logging in actually completed the join: the test
    account ended up a member of both its original server and the new
    one. Also reconfirmed the app-invite path still works end-to-end
    (register → immediate login) as a regression check, and confirmed
    directly against the live production API that the reported code
    still correctly fails registration (expected — it's a server
    invite, not proof of a remaining bug) while `/guild-invite/<code>`
    now resolves instead of colliding with the old path.
72. [x] **Live bug report, the real voice blocker**: with the invite
    mixup sorted, an actual two-person call was tried and: (a) neither
    side could hear or see the other, (b) both got disconnected after
    a few seconds. Checked `docker logs` and found both real accounts'
    connections stuck at ICE `Checking` forever, exactly like this
    session's own earlier sandbox testing — except this was two real
    people on two real home networks, not a testing artifact. This app
    had never had a TURN relay (PLAN.md 4.5 always listed it as a
    later/out-of-scope item) — only plain host + server-reflexive ICE
    candidates, which simply cannot traverse every real NAT
    combination (symmetric NAT, CGNAT — common on mobile networks and
    plenty of home routers). The "disconnected after a few seconds"
    part is actually batch 19 item 68's timeout fix doing exactly what
    it's supposed to (cleaning up a connection that genuinely never
    connects) — not a new bug, just newly *visible* now that it fires
    reliably instead of leaving a zombie forever.
    Added a real TURN server:
    - New `coturn` service in `docker/docker-compose.yml` (port 3478
      UDP+TCP, a `49160-49260` UDP relay range, all reachable from the
      internet the same way the voice SFU's own port already is).
    - `TURN_SECRET` (shared with coturn's `--static-auth-secret`) lets
      the app generate short-lived TURN credentials on demand
      (`GET /api/voice/ice-servers`, `api::voice` — coturn's
      `--use-auth-secret` REST API convention: HMAC-SHA1 over an
      expiry timestamp, so nothing long-lived is ever handed to a
      client) instead of embedding a fixed username/password anywhere.
    - `voice.ts` fetches these fresh on every `join()` (piggybacking on
      the rejoin that already happens for every camera/screen toggle)
      and passes them into `RTCPeerConnection`, which was previously
      constructed with `iceServers: []` — no STUN/TURN at all.
    **Actually verified, not just deployed**: confirmed a real TURN
    allocation against the live coturn container returns the correct
    public relay address (`turnutils_uclient`, both with a hand-built
    credential and with the *exact* credential the app's own endpoint
    issued — proving the shared secret actually matches end to end).
    Then the decisive test: a real browser, `iceTransportPolicy:
    "relay"` (forces it to use *only* TURN — no direct path allowed at
    all, simulating exactly "two NATs that can't reach each other"),
    successfully gathered relay candidates using the app-issued
    credential against the live server. That's the actual mechanism a
    real call falls back to; proving it works end-to-end is as close
    to reproducing the reported failure as this sandbox allows (it
    still can't complete a full two-peer call itself — see batch 18
    item 66's standing note). The user should retry a real call now
    to confirm it actually connects, since that's the one thing that
    can't be verified from here.
    **Not fixed by this — still open, needs separate work**: issue 1
    from the same report, "calling another user does nothing, they
    don't get an incoming call notification." There's genuinely no
    ringing/incoming-call UI anywhere in the app today — a callee only
    finds out if they happen to already be looking at that
    conversation. Not attempted yet.
    **Correction, from item 73**: TURN itself works exactly as verified
    above, but it turned out **not** to be why the two-person call
    failed — see item 73, which found and fixed the real cause (a
    silent, total failure to ever reply to *any* connectivity check at
    all, direct or relayed). TURN is still worth having — real NAT
    incompatibility is a genuine, separate risk this doesn't
    eliminate — but it wasn't what was actually happening here.
73. [x] **The actual root cause of every ICE-stuck-forever symptom
    this entire session** (batch 11's original "webcam stops after 9s"
    investigation, this sandbox's own testing throughout, and now two
    real people's real call): found by finally instrumenting the raw
    socket loop and discovering the server was receiving and correctly
    *accepting* every single STUN connectivity check (right ufrag,
    valid message — confirmed by hex-dumping one and decoding the STUN
    header by hand) yet **never transmitting a single reply, ever** —
    not one, across hundreds of received requests, on any network path
    including the TURN relay from item 72. Traced into str0m's own ICE
    agent source (the `is` crate it depends on) and found the actual
    line: it silently discards any connectivity check whose
    *destination* address doesn't exactly match one of this server's
    own registered local candidates — logged only at `debug`, below
    this app's own default level, so it never showed up anywhere.
    Our voice socket binds `0.0.0.0` (all interfaces), and the
    `destination` we were reporting for every single received packet
    was `socket.local_addr()` — which for a wildcard bind is literally
    `0.0.0.0:<port>`, not a real address. The candidate we'd actually
    registered (`Candidate::host`) was the real guessed/advertised IP
    (`host_ip:<port>`). `0.0.0.0` can never equal a real IP, so *every*
    connectivity check this server has ever received, on any code path,
    silently failed this check and got dropped before a reply was ever
    considered — full stop, regardless of camera/screen/TURN/NAT/
    environment. Every other theory chased this session (sandbox
    limitations, NAT hairpin, symmetric NAT needing TURN) was
    investigating real, legitimate concerns that just happened not to
    be reachable, because connections never got far enough to hit them.
    Fixed with a one-line change: report the real registered candidate
    address (`host_ip:voice_port`) as every packet's destination
    instead of the raw wildcard socket address.
    **Actually verified working, live, end-to-end, immediately**: this
    is the first time in the entire session a voice connection has
    ever reached `Connected` — confirmed via the exact same real-UI
    Playwright flow used to investigate this (two accounts, real DM,
    real "Call" click, real fake-media browser) going from stuck at
    `Checking` forever (before) to `iceConnectionState: connected` /
    `connectionState: connected` within a couple seconds (after),
    server logs going straight from `Checking` to `Completed`, and 209
    real transmitted packets where there had been zero. All diagnostic
    logging removed afterward; the shipped fix is the one-line address
    correction plus its explanatory comment. This should be the actual
    fix for the user's reported "no audio/video, auto-kicked" — please
    retry the real call now.
74. [x] **Live bug report, now that voice actually connects**: sharing
    your own webcam always showed a second tile labeled "Someone",
    supposedly wasting space — and when it was a genuine other person,
    it should show their real name instead. Two separate, now-testable
    (item 73 made real two-peer testing possible for the first time)
    bugs, both found and fixed:
    1. **The label bug** — `stream_id: "<user id>-camera"` (batch 18
       item 66) is filtered by str0m's `add_media` through RFC 8830's
       msid token-char set before being sent, which **silently strips
       the `:` separator** I'd originally used — not an error, just a
       quiet `"12345:camera"` → `"12345camera"`. The client's split on
       `:` then returned the *entire mangled string* as one piece
       (`split` on a separator that never occurs just returns the
       whole string), so every remote video's "userId" was actually
       `"<id>camera"`/`"<id>screen"` — which matches nothing in any
       lookup table, hence always falling back to "Someone". Confirmed
       by literally logging the mangled value. Fixed by switching the
       separator to `-`, which *is* in str0m's allowed token-char set
       (both `voice::negotiate_if_needed` and `voice.ts`'s parsing
       side updated together).
    2. **The lookup bug, independent of the above** — even with a
       correct id, video tile names were resolved from
       `mentionCandidates`, a list scoped to *whichever channel/DM is
       currently being viewed* — not to who's actually in the call.
       Since a call keeps running after you navigate elsewhere in the
       app, that lookup could easily go stale mid-call. Replaced with
       a proper `knownUsers` map (id → user) that accumulates from
       every DM list and guild member list fetched all session, so it
       stays correct regardless of what you're currently looking at.
       Also fixed the same latent staleness in the sidebar's small
       voice-participant-avatar row for consistency.
    **Actually verified together, live, two real peers**: built a
    fresh two-account scenario (not reusing any prior test data),
    joined a real DM call between them, had one turn their camera on
    then off, and watched the *other* browser's actual tile — before
    the fix, labeled "Someone" (id logged as visibly mangled,
    e.g. `"357975992553177088camera"` with the userid and purpose
    glued together); after both fixes, correctly labeled with the
    real account's display name throughout, and correctly disappeared
    entirely within a few seconds of the camera actually being turned
    off (so the "always wastes space" half of the report was likely
    this same mislabeling making a real, legitimate tile look like an
    unexplained ghost — not a separate persistence bug; the tile
    lifecycle itself checked out correctly in this same test).
75. [x] **UX ask**: vertical spacing between people's names in the
    voice-participants list (the small avatar+name rows under a voice
    channel) felt too cramped compared to the channel list right above
    it. `.voice-participants`' row `gap` was `0.15rem` with no padding
    of its own (unlike `.channel-item`, which gets its breathing room
    from `0.45rem` top/bottom padding on each row) — bumped the gap to
    `0.45rem` to match that same rhythm, plus a little top padding so
    the first row isn't flush against the channel item above it.
76. [x] **Feature request**: see who's online from the Direct Messages
    list. There was no concept of "online" at all before this — only
    voice-channel presence existed. Added instance-wide online
    tracking:
    - `GatewayHub` gets a ref-counted `online_counts: Mutex<HashMap<Id, u32>>`
      (`mark_online`/`mark_offline`/`online_user_ids`) — ref-counted
      because one person can have several tabs/devices open at once,
      and they should only flip to offline once the *last* one closes,
      not the first.
    - A connecting client's `READY` frame now includes a snapshot
      (`online_user_ids`) of everyone currently online, instance-wide
      — deliberately not scoped to just this user's own DMs/guilds
      (that'd need extra member-list queries per guild for a self-
      hosted app where everyone already knows everyone else exists via
      the invite flow; not worth the complexity here). A new
      `PresenceUpdate` gateway event carries every change after that,
      published to every guild and DM room the person going
      online/offline is actually part of.
    - The DM list shows a small green dot (reusing the exact
      `.avatar-wrap`/`.status-dot` markup the sidebar footer's own
      always-on status dot already used) on a 1:1 conversation's
      avatar when the other person is online — skipped for group DMs
      (whose "online" would be ambiguous) and the self-DM (always
      you). Updates live via `presence_update`, patched directly onto
      the existing DOM rather than re-fetching/re-rendering the whole
      list — a presence change is common enough that doing that would
      be wasteful, and would fight with whatever the viewer's doing
      there (scrolled position, an open menu) far more often than a
      pin or a new message would.
    **Verified live** with two real accounts across four scenarios,
    not just one: (1) friend not yet connected → no dot, (2) friend
    connects while the DM list is already open → dot appears live,
    no reload, (3) friend disconnects → dot disappears live, (4) a
    *fresh* page load while the friend is already online → dot shows
    immediately from the `READY` snapshot, not just future updates.
    All four behaved exactly as expected.

### Batch 20 — 2026-09-14 (the real phantom-tile bug, and a real incoming-call notification)

77. [x] **Bug report, the actual "Someone" tile — for real this time**:
    every previous "Someone" fix (batches 18, 19) addressed real bugs
    that were real fixes for what they targeted, but none of them was
    *this* one — reported again as "sharing webcam alone still shows
    a phantom tile, two of them with screen share too." Reproduced it
    in total isolation (one account, alone, in a voice channel, no
    second participant anywhere) and proved via server-side logging
    that the SFU correctly does nothing for a solo session — zero
    other clients ever considered, zero tracks ever forwarded to
    anyone. The bug was entirely client-side: `voice.ts` added its own
    outgoing tracks with plain `pc.addTrack()`, which defaults a fresh
    transceiver's direction to `sendrecv` — telling the browser to
    *also* expect to receive media back on that exact m-line. The SFU
    never actually sends anything back on a client's own upload line,
    but `RTCPeerConnection`'s `ontrack` fires off SDP negotiation
    having a "recv" capability, not off real data ever arriving — so
    the browser fired a spurious local `ontrack` for its *own* camera
    and screen tracks, with a synthetic local stream id matching
    nothing in any lookup table (not the SFU's real `<user>-<purpose>`
    naming), hence "Someone" — one for camera, a second for screen,
    exactly matching "two tiles" in the report. Fixed by using
    `addTransceiver(track, { direction: "sendonly", ... })` instead,
    for all three of the audio/camera/screen tracks (audio had the
    same latent issue, just never surfaced as visibly since it doesn't
    produce a tile).
    **Verified two ways**: reproduced the exact bug solo first (1
    account → camera → 2 tiles; + screen → 3 tiles), confirmed the fix
    brings it back to exactly 1 (`"You"`) in both cases; then re-ran
    the two-real-peer combined camera+screen test from batch 18/19 as
    a regression check, confirming the *legitimate* cross-peer combined
    tile (real name, camera-as-pip-on-screen) still works correctly —
    this fix only removes the spurious self-tile, it doesn't touch
    genuine forwarding to someone else.
78. [x] **Bug report**: calling someone in Direct Messages did
    nothing from the callee's side — the caller just entered a voice
    chat alone, and "the one being called experience[d] nothing."
    Traced this to two compounding bugs in the same
    `voice_state_update` gateway handler:
    1. It early-returned unless the channel was in `currentChannels`
       — which is populated *only* for a guild's channel list. A DM's
       voice channel is never in there, so **every DM call's
       voice_state_update was silently discarded**, for everyone,
       always — not just "no notification," literally nothing ran at
       all (not even the existing peer-join sound logic, which does
       work correctly for guild voice channels).
    2. Even with that fixed, there was still no actual concept of "an
       incoming call" anywhere — the UI had never had one built.
    Fixed both: the handler now also recognizes DM channels (checked
    against the already-loaded `dms` list) instead of only guild
    channels, and a real incoming-call banner was added — fixed to
    the top of the screen, a ringtone (new `playIncomingCallSound`,
    repeating every 2s, auto-gives-up after 30s unmanswered like a
    real phone call), the caller's actual name (via the `knownUsers`
    map from batch 19), and Answer/Decline buttons. Answering switches
    to that conversation and joins the same voice channel the caller
    is in — Decline just dismisses it locally (no "declined" signal
    exists or was asked for). Shows regardless of what the callee is
    currently looking at, DM list included — not just when they
    happen to already be viewing that exact conversation.
    **Verified live, two real accounts, worst case**: had the callee
    sitting on the Home/DM list (not viewing the conversation with the
    caller at all) when the call came in — banner appeared correctly
    labeled with the caller's real name, clicking Answer joined voice,
    and server logs confirmed both accounts' ICE reached `Connected`
    within milliseconds of each other on the same call — genuinely
    together, not two separate calls.
79. [x] **Feature request**: edit your profile after signing up —
    display name and username were only ever set once, at
    registration, with no way to change either afterward (avatar
    already had its own picker; password had no change path either).
    Added:
    - `PATCH /api/me` for display name and/or username — send just the
      one being changed, the other is left alone. Username reuses the
      exact same validation as registration and checks uniqueness
      inside the same transaction as the write (so it can't race a
      concurrent registration/rename onto the name you just checked
      was free).
    - `POST /api/me/password`, requiring the *current* password
      correctly re-entered before accepting a new one (standard
      practice for a change that itself doesn't require re-logging
      in — nothing else gates it otherwise).
    - Settings → Profile now has editable Display name / Username
      fields (a shared `editableField` component: input + Save +
      inline error, Save disabled until the value actually changes)
      and a Password section with current/new fields.
    **Verified two ways**: the full API surface directly (display name
    change, username change, re-saving your own current username as a
    no-op success rather than a false "taken", a second real account
    correctly blocked with 409 when trying to take a name already in
    use, wrong-current-password correctly rejected with 401, and a
    real login with the *new* username and *new* password succeeding
    after a correct change) — then the actual UI on top of it (opened
    Settings, edited the display name field, clicked Save, watched the
    button confirm "Saved" and the sidebar update immediately).
80. [x] **UX ask**: simplify "Active sessions" down to just two
    actions — "Remove All" (every other session, keeping the current
    one) and "Specify Removal" (pick individual ones) — instead of an
    expandable list with a per-row Revoke button as the only way in.
    Added `POST /api/sessions/revoke-others`, deliberately distinct
    from the existing "Log out everywhere" (Account tab): that one
    (correctly) also ends the session that asked for it; this one
    (per the ask) keeps the current device signed in and only clears
    every *other* one. The old expandable list still exists — it's
    exactly what "Specify Removal" reveals, individual Revoke buttons
    included — just reframed behind the two named actions instead of
    being the only entry point.
    **Verified live, real multi-session scenario**: registered an
    account, logged in twice more (three real sessions total), called
    "Remove all" from the first session and confirmed via direct API
    checks that the other two were immediately unauthenticated (401)
    while the first kept working and its own session list correctly
    showed just itself afterward. Separately verified "Specify
    removal" in the actual UI: reveals the other-sessions list,
    individual Revoke correctly removes just that one row.
81. [x] **Feature request**: an input (mic) volume control to match
    the existing output volume slider, plus a way to adjust individual
    people's volume in a call. (The original ask said "we have an
    Input volume, but it would be nice with an output volume too" —
    backwards from the actual code: Devices already had an *output*
    volume slider, master mic gain was the thing missing. Built what
    was actually missing rather than what was literally typed.)
    - Mic gain: `VoiceClient` now runs the outgoing mic audio through a
      small Web Audio graph (`MediaStreamAudioSourceNode` ->
      `GainNode` -> `MediaStreamAudioDestinationNode`) built once per
      `join()`; the peer connection's audio transceiver carries the
      *destination's* track, not the raw device track. `setInputVolume`
      just adjusts the existing gain node's value live — no rejoin, no
      renegotiation. `switchInputDevice` was updated to match: since
      the sender's track is now the graph's output (which never
      changes), a device switch rewires the graph's *source* node to
      the new device's stream instead of `replaceTrack`-ing the
      sender. Falls back to sending the raw track unmodified if
      `AudioContext` isn't available at all. Persisted as
      `inputVolume` in the existing per-browser audio-prefs store, with
      a matching "Input volume" slider added next to Devices' existing
      "Output volume" one.
    - Per-person remote volume: a `remoteVolumes: Record<userId,
      number>` map (also in audio-prefs) holds a multiplier applied on
      top of the master output volume for one specific person's voice,
      independent of and remembered across calls. Exposed in two
      places that both write/read the same underlying prefs: a small
      slider next to each remote participant's name in a voice
      channel's sidebar list (works whether or not they have video on;
      stops the click from also triggering the row's "join this
      channel" handler), and a matching slider in each person's video
      tile controls (camera/screen-share view) for when you're
      actively looking at them. Self is excluded from both — you can't
      turn down your own mic this way, that's what mute is for.
    **Verified live, two real accounts, isolated instance**: joined a
    guild voice channel with both — confirmed ICE still reaches
    `Connected` for both (this touches the same `join()` code path as
    item 77's fix, so this was also a regression check) and an
    audio-only call still shows zero video tiles. Confirmed exactly
    one volume slider appears per *other* participant (never for
    yourself) in the sidebar list, dragging it persists
    `remoteVolumes` keyed by the right user id, and the Devices'
    "Input volume" slider live-updates `inputVolume` in the same
    prefs blob. Then had the second account turn its camera on and
    confirmed the first saw exactly one "Bob" tile (no phantom, per
    item 77) with its own volume slider wired to the *same*
    `remoteVolumes` entry as the sidebar one (dragging either one
    updates the shared preference). Did not verify with real
    microphones/speakers that a gain change is audibly perceptible —
    fake media devices in the test don't produce measurable audio
    levels; the verification above confirms the whole pipeline is
    wired correctly end-to-end (graph built, values persisted, no
    connection regression), not that a human ear would perceive the
    exact same percentage as a real slider elsewhere would.
82. [x] **UX ask**: "Manage server" dumped General/Members/Danger-zone
    on the user as one long flat page — asked to categorize it "just
    like we have it for the profile settings" to cut cognitive
    overload. Rebuilt it with the exact same left-nav-tabs shell as
    Settings (`.settings-nav`/`.settings-content`, one tab active at a
    time): General, Members, and (owner-only, matching the pre-existing
    visibility rule — a non-owner never saw Danger zone either) Danger
    Zone. Deliberately *not* a copy of Settings' "recreate the panel
    from scratch on every tab click" mechanic: that only works there
    because the underlying `user` object is mutated in place by the
    caller, so a fresh render always sees current data. Here, saving a
    change (e.g. renaming the server) hands back a *new* `Guild` object
    to the caller instead of mutating the one this modal closed over —
    recreating panels from that stale closure on every switch would
    silently revert to pre-edit values the moment you tabbed away and
    back. Sidestepped it structurally instead: every panel is built
    once, up front, and tab-switching just toggles which one is
    `hidden` — so each section's own existing live-DOM-patch-after-save
    logic (unchanged) simply keeps working no matter how many times you
    switch tabs.
    **Verified live, real owner + non-owner accounts**: owner sees all
    three tabs (General/Members/Danger Zone), non-owner sees only the
    first two — matching the pre-existing owner-only gating, now just
    expressed as tab visibility instead of section visibility. Renamed
    the server from the General tab, switched to Members then Danger
    Zone and back to General, and confirmed the input still showed the
    *new* name rather than reverting — the specific regression the
    "build once, toggle hidden" approach above was chosen to avoid.
83. [x] **Feature request**: replace two separate, confusing invite
    systems with one universal one — remove invite creation from
    Profile Settings entirely; any invite link should ask a
    no-account visitor to create one, take an existing account
    straight to the specific channel it was invited to, and never add
    someone to a server just because they were invited from a DM.
    Before this, there genuinely were two unrelated invite systems
    sharing nothing but a similar-looking code: an app-registration
    invite (`/invite/<code>`, Settings → Invites) that could only
    create a brand-new account and always dropped it into "the" one
    guild with no way to land anywhere more specific, and a
    guild-only invite (`/guild-invite/<code>`, a server's own "Invite"
    button) that could only be used by someone who *already* had an
    account — the guild-invite modal literally said so ("Someone
    brand new needs an app invite instead"), and a signed-out visitor
    following a guild-invite link was sent to *login*, not
    registration, since that system had no way to create an account
    at all. There was also no way at all to invite someone into a DM.
    - **Unified data model**: the app-registration `invites` table
      gained a nullable `channel_id` (migration 0013) — every invite
      now optionally targets a specific channel, guild or DM. The
      old `guild_invites` table was dropped outright; there's one
      invites table and one `/invite/<code>` URL now, not two of
      each. What redeeming an invite actually grants is entirely a
      function of that destination channel: a guild channel grants
      guild membership, a DM channel grants DM participancy and
      *nothing else* — no guild is ever joined from a DM invite. A
      `channel_id`-less invite (every pre-migration row) keeps its
      original behavior (join "the" guild) for backward compatibility
      with links already handed out.
    - **One redemption path for both situations**: `POST /api/register`
      (no account yet) and a new `POST /api/invites/redeem` (already
      signed in) both apply the same destination logic and hand back
      `{ channel_id, guild_id }` so the frontend can navigate straight
      there — `main.ts`'s boot logic now just checks "am I signed in?"
      once and picks the right one, instead of the old two-separate-
      code-paths-carrying-a-pending-code-across-login dance. Redeeming
      a destination you're already in (already a guild member / DM
      participant) is a harmless no-op, not an error — clicking an old
      link again just takes you there.
    - **Group-DM cap enforced on the invite path too**: a DM invite
      whose conversation is already at the existing 10-person group
      cap (`dms::add_participant`'s cap, now a shared
      `MAX_GROUP_DM_PARTICIPANTS` constant) is rejected — checked
      *before* creating an account for a fresh registrant, so a full
      DM can't leave someone half-registered.
    - **Permissions**: creating a unified invite reuses whatever
      access that destination channel already requires
      (`require_channel_permission`) — `CREATE_INVITE` (gated by a
      guild's existing "Anyone can create invites" setting) for a
      guild channel, or just being a participant for a DM, same as
      `dms::add_participant` always allowed.
    - **UI**: Profile Settings' "Invites" tab is gone. A guild's
      sidebar "Invite" button now generates a unified invite targeting
      that guild's first text channel (no channel-picker UI needed —
      it's the same landing spot joining a guild always effectively
      had). A DM's "Conversation options" menu gained a new "Invite by
      link" option alongside the existing "Add people" (which still
      needs both an account and a known username) — this is the only
      way to invite someone into a DM at all, and explicitly warns
      redeeming it "never adds them to any server."
    **Verified live, real multi-account, isolated instance, both API
    and real browser UI**: created a guild-channel invite and a
    DM-channel invite via the actual sidebar/DM-menu UI (not just
    curl); registered two brand-new accounts through each link end to
    end in a real browser (registration form → welcome step →
    landing) and confirmed via the API that the guild-invite
    registrant landed in and became a member of the guild while the
    DM-invite registrant landed in the DM and has **zero** guild
    memberships; had an already-registered account redeem the DM
    invite (joined the DM, guild list unchanged) and redeem the same
    code again (no-op, no error); confirmed a non-member/non-participant
    is correctly forbidden from creating an invite for a channel they
    don't belong to, and that a revoked invite's code stops working;
    confirmed Settings has no Invites tab and both old routes
    (`/guilds/:id/invites`, `/guilds/join`) are gone (404/405). Also
    ran this against the real production database via the normal
    deploy (not a throwaway instance) — migration 13 applied cleanly
    with the server starting up with no errors, confirmed via
    `docker logs`.

### Batch 18 — 2026-09-14 (simultaneous camera + screen share, phantom-tile investigation, first real deployment)

66. [x] **Bug report**: couldn't be on camera and screen-sharing at the
    same time (turning one on turned the other off), and a mysterious
    black video tile labeled "Someone"/"Somebody" showed up with no
    one actually sharing.
    1. **Camera + screen share simultaneously, camera as an overlay on
       the share** (as asked for — "move the cam on top of the
       share"). This needed a signaling change: str0m/WebRTC has no
       concept of "camera" vs "screen", they're both just a video
       `m=` line, so there was no way for the SFU to relay them under
       stream ids a remote peer could tell apart once a user could
       send both at once. Fixed by having the client tag each of its
       own outgoing video mids by purpose (`{ mid: "camera"|"screen" }`,
       read off `RTCPeerConnection.getTransceivers()` after
       `setLocalDescription`) in the op 4 signaling frame; the SFU
       threads that through (`VoiceHub::offer`, `VoiceCommand::Offer`,
       a new `VideoPurpose` tag on each `TrackIn`) into the
       `stream_id` it forwards each track under —
       `"<user id>:camera"` / `"<user id>:screen"` instead of the old
       bare user id. Client-side, camera and screen are now fully
       independent (`VoiceClient.toggleCamera`/`toggleScreenShare`,
       backed by separate `cameraStream`/`screenStream` fields instead
       of one mutually-exclusive `videoStream`), and remote video is
       parsed back into `(userId, purpose)` from that composite stream
       id. The UI groups a person's camera and screen back into **one**
       combined tile per person (not two competing grid cells): screen
       as the tile's main content when both are present, camera
       reparented in as a small corner-overlay `<video>` on top of it
       — reusing the existing `<video>` elements throughout rather
       than recreating them, so an already-playing stream is never
       interrupted by the other one starting/stopping.
    2. **The phantom black "Someone" tile.** Traced the code path and
       found (and reverted) a wrong turn I'd made mid-investigation: I
       had added an explicit `voice.leave()` call to the gateway
       socket's cleanup path on the theory that a dropped connection
       (crash/network loss, as opposed to the explicit "leave voice"
       button) never told the SFU to disconnect — but re-reading
       `VoiceHub::unregister()` (already called unconditionally right
       before that point) showed it already sends the same
       `VoiceCommand::Leave`, making the addition redundant, and the
       comment justifying it factually wrong. Reverted that specific
       addition. The real, still-standing explanation is what's
       already written below under "Known constraints": an unclean
       disconnect (tab closed, crash) only gets cleaned up once the
       gateway's own ~60s heartbeat timeout notices it's gone, and
       until then a stale participant can sit in the room showing
       whatever their last frame was, labeled "Someone"/"Somebody"
       because their user id no longer resolves to a current member
       once they're actually gone. Given the extensive
       Playwright-driven testing this session has done (many
       browser-closes that don't cleanly close the WebSocket), a
       backlog of exactly these zombies accumulating in the dev
       container's long-lived process is the most likely explanation
       — restarting the container (done as part of this batch's
       redeploy anyway) clears it. I did not find a deeper bug beyond
       that; if a fresh container still shows this after a real call
       with no stale participants, it needs a fresh report.
    **Verification honestly caveated**: `cargo build`/`clippy`/`test`,
    `tsc --noEmit`, and `vite build` are all clean, and the container
    redeployed healthy with the right port bindings. But I could not
    watch the actual camera+screen combined tile work live,
    two-browser, end-to-end — this exact sandbox cannot complete a
    real ICE handshake even for the *pre-existing* audio-only voice
    path (confirmed again this batch: built the last commit before
    any of today's changes in an isolated worktree and it hangs at
    ICE "checking" identically, so this is this sandbox's networking,
    not a regression). The purpose-tagging and tile-combination logic
    is reasoned through carefully (str0m's actual source read to
    confirm `MediaAdded` carries no track-purpose info of its own, so
    out-of-band tagging is the only option) and passes every static
    check available here, but it needs a real two-person call to be
    called truly verified — see the deployment below, which exists
    partly to make that possible.
67. [x] **First real (non-`127.0.0.1`) deployment**, at the user's
    request, to test with another real person over the actual
    internet rather than same-host browser tabs. This is a deliberate,
    explicit exception to the standing "local-only" constraint below —
    the user asked for it by name (`chatty.ebbemonster.dk`, with a
    real A record already created) — not a unilateral decision to
    expose the app.
    - `docker/docker-compose.yml`: `PUBLIC_URL` →
      `https://chatty.ebbemonster.dk`; `VOICE_PUBLIC_IP` → the host's
      real public IP (was `127.0.0.1`, only ever correct for same-host
      testing). The HTTP port stays `127.0.0.1`-only, fronted by an
      nginx TLS reverse proxy on the host (same pattern this host
      already uses for its other apps) — **not yet installed**, since
      that lives in `/etc/nginx` which needs root I don't have in this
      session; the config is ready for the user to drop in themselves.
    - The voice UDP port (50000) now binds `0.0.0.0` instead of
      `127.0.0.1` — this one **can't** go through the HTTP reverse
      proxy at all (WebRTC media is a direct UDP flow to each
      browser), so it has to be reachable from the internet directly
      for a remote peer's call/video to work. This is the one real,
      necessary narrowing of the "bind to loopback" rule — everything
      else (the HTTP app port itself) stays loopback-only as before.
    - Confirmed live: container healthy, `127.0.0.1:8090` for HTTP,
      `0.0.0.0:50000/udp` for voice, exactly as intended.
    - **Not yet done** (blocked on things I can't do from here): the
      nginx vhost + Let's Encrypt cert (needs root — command block
      handed to the user), and the DNS record hasn't finished
      propagating publicly yet as of this writing (`chatty.ebbemonster.dk`
      still resolves NXDOMAIN via public resolvers) so the cert step
      can't be run until it does.

### Batch 17 — 2026-09-14 (network popover hardening, video/chat split layout)

63. [x] Two fixes to the "Server resource usage" popover (now "Network
    usage"):
    1. It didn't close on an outside click at all — only re-clicking
       the same button closed it. Added the same close-on-outside-
       click behavior every other popover in the app already has.
    2. Dropped CPU and memory entirely — not just hidden client-side,
       removed from the `/api/system/stats` response and the sampling
       loop altogether. Those were **whole-host** figures (Docker
       doesn't namespace `/proc` by default), visible to any signed-in
       user; real information about the machine Chatly happens to run
       on that a regular user has no need to see and a curious or
       malicious one could use. Network throughput stays (it's just
       Chatly's own traffic on its own virtual interface, not the
       host's), which is what's actually useful here anyway: "is the
       app itself pushing meaningful bandwidth."

    Found and fixed a real, more general bug while wiring up the
    close-on-outside-click: the check used `event.target !== button`,
    but the button has its own child elements (an icon, a label) —
    clicking it again to close very often has `event.target` be one
    of *those*, not the button, so the click looked "outside" and
    closed it, immediately followed by the button's own click handler
    (which fires after, since this runs on the capture phase) seeing
    nothing open and reopening it — net effect, clicking the button
    again to close it silently did nothing. Fixed by checking
    `button.contains(event.target)` instead of `!==`. Found this
    exact same latent bug in two other popovers that had clearly
    copied the same pattern (the emoji picker and the markdown
    formatting-snippets popover) and fixed both the same way — neither
    had been reported, but it's the same defect. Verified live for
    all three: reopening after an outside-click close works, and
    re-clicking the trigger button to close now actually closes it
    instead of instantly reopening.
64. [x] **Bug report**: turning on the camera showed only about half
    the video, on top of the chat. Root cause: video and chat were
    stacked vertically (video panel above the message list), sized by
    the video tile's own `aspect-ratio` — fine for the small fake test
    camera used earlier, but a real webcam/monitor at real resolution
    could compute a tile taller than the space available above the
    chat, which then either clipped it (capped height + scroll no one
    would think to try — "only half shown") or crushed the message
    list down to nothing ("shown over the chat").
    Restructured to a real Twitch/YouTube-style side-by-side split
    instead of a stacked one: video pane on the left, chat column on
    the right, with a **draggable divider** between them (persisted
    width, same pattern as the sidebar's own resize handle) — "moving
    the border between the video and the chat," as asked for. Video's
    height is now simply "the full column," never negotiated against
    chat content, which is what actually fixes the bug: it can't
    overflow into a space it no longer shares.
    Also changed how multiple tiles size themselves: instead of each
    tile being sized by its own stream's aspect ratio (the exact
    mechanism that could overflow), the grid now shapes itself to the
    tile count — as square as possible, like any video-conferencing
    app (1 → 1×1, 2 → 2×1, 3–4 → 2×2, etc.) — and each tile fills its
    cell fully, with the video itself letterboxing via
    `object-fit: contain` to keep its real proportions without
    cropping. In focus/spotlight mode, added a second **draggable
    divider** between the large spotlighted tile and the filmstrip of
    everyone else, so that split is adjustable too.
    **Scope note on "resizable borders between webcams/screen
    shares"**: I did not build fully-manual, drag-any-boundary tiling
    (each individual grid cell resizable against its neighbors, like
    a tiling window manager) — that's a substantially larger feature
    on its own, and no video-conferencing app I know of actually does
    per-cell manual resizing for a symmetric grid of equal
    participants (Zoom/Meet/Discord all auto-arrange it exactly like
    this). What I built covers the two divisions that are genuinely
    adjustable in practice: video-pane-vs-chat, and (in focus mode)
    spotlight-vs-filmstrip. If a full per-tile tiling system is still
    wanted after trying this, that's a distinct, larger ask worth
    scoping separately rather than something I guessed my way into
    building partially.
    Verified live: a real-shaped tile now stays entirely within the
    video pane's bounds at every size (checked its box against the
    pane's box directly, not just visually), the message list is
    never hidden or crushed, both new resize handles work, and
    collapse/focus/pop-out (from the previous batch) all still work
    correctly in the new layout.
65. [ ] **Not started — logged for later, not implemented.** The
    Settings "Invites" tab doesn't really make sense as-is: it's not
    clear what it's inviting someone *to* (a guild? the instance
    itself? a friendship?) unless you already know it's specifically
    instance-wide registration invites. Raised alongside a proposed
    model to replace it with two clearly-separate concepts instead of
    one ambiguous "Invites" tab:
    1. **Invite someone to the app itself** — folded into Direct
       Messages (batch 16), covering both an existing user (the
       friend-request flow already shipped there) and someone not yet
       on the instance at all (this part doesn't exist yet — today,
       getting a brand-new person onto the instance is still the
       separate, owner-only registration-invite system this very
       Settings tab manages).
    2. **Invite someone to a specific server** — guild invites already
       exist (`api::guilds`/`guild_invites`), but per the proposal
       these should default to (or perhaps only offer) single-use
       links, rather than today's reusable-until-revoked/expired ones.
    This needs real design thought before touching it — in particular
    how "invite a not-yet-existing user" from within DMs should
    actually work (an instance-registration invite handed out through
    a DM-shaped UI?), and whether guild invites should stay
    multi-use-capable at all or move to single-use only. Intentionally
    not guessing at an implementation until that's worked out.

### Batch 16 — 2026-09-14 (Friends folded into Direct Messages, real friend requests)

62. [x] Two related asks, both landing in the same redesign:
    1. Drop the standalone "Friends" list — friends now just live in
       the Direct Messages list itself, ordered by most recent
       message (a friend with no conversation yet still shows up,
       ordered by when the friendship started), with the ability to
       pin a conversation to keep it at the top regardless of
       recency.
    2. The "+" button now sends a friend request instead of starting
       an instant conversation — nothing happens until the other
       person accepts it. Added a per-user "accept friend requests"
       setting (Settings → Security) that rejects an incoming request
       outright, with a clear error for the sender, when turned off.

    This replaces the whole previous friend system (item 28: a
    shareable invite link/QR code, redeem = instant friend, no
    request/accept step) with a real request/accept flow: search a
    username, send a request,
    the recipient accepts or declines it (a small "Friend requests"
    button — reusing the old Friends button's spot and icon — shows a
    badge for pending incoming ones, and lists both directions so you
    can also cancel one you sent). Sending someone a request while
    they'd *already* sent you one resolves as an instant mutual
    accept, rather than leaving two redundant pending rows around.
    Starting a *group* conversation still doesn't need a friend
    request (same as before) — it's just no longer how you start a
    1:1 with someone new. Instead, per the discussion when scoping
    this, 1:1 is the default and a conversation grows into a group by
    adding people to it afterward: any existing DM (including a
    self-DM) has an "Add people" option in a new "..." menu in its
    header, which works the same ungated way group creation always
    did. That same menu also has "Remove friend" for a 1:1.

    Backend-wise this is a real amount of new plumbing: a
    `friend_requests` table (replacing `friend_invites`, dropped
    outright — nothing else referenced it), a `pinned_dms` table,
    DM-list ordering that now factors in pin state and each
    conversation's most recent message (`MAX(id)` on `messages`,
    correlated per channel — no denormalized column needed at this
    app's scale), and a way to add a participant to an *existing* DM
    channel (preserving its message history) rather than only being
    able to create new channels from scratch. All of it needed to work
    live: accepting a request or being added to a conversation has to
    make it appear for the other side without a refresh, which the
    gateway previously had no mechanism for at all (events only ever
    fanned out through a shared guild/DM room, and a client's set of
    subscribed rooms was fixed at connect time) — added a per-user
    "personal room" (reusing the existing room-broadcast mechanism,
    keyed by the user's own id instead of a guild/channel id — safe,
    since every id in this app comes from one global snowflake
    generator) for events like this with no existing shared room to
    ride on, and made the gateway loop dynamically subscribe a live
    connection to a brand new DM channel's room the moment it learns
    about it, instead of only computing subscriptions once at connect.

    **Found and fixed a real bug in that dynamic-subscribe mechanism
    before shipping it**: a DM channel from an ended friendship isn't
    deleted (chat history stays, matching how unfriending never
    touched DMs even before this change) — so re-befriending the same
    person hands back that same channel id. A connection already
    subscribed to it from the normal connect-time path would then
    *also* pick up the dynamic subscription, ending up subscribed
    twice and receiving every future message in that conversation
    twice for the rest of that connection's life. Root-caused with
    temporary server-side tracing (logging each room's live
    subscriber count) rather than guessing, then fixed by tracking
    which rooms a connection already covers and skipping the dynamic
    subscribe when it's redundant — all diagnostic logging removed
    again before committing.

    Verified live end-to-end with two real browser sessions (not just
    curl): a request sent via the UI updates the recipient's badge
    with no refresh; accepting updates both sides' DM lists live;
    pinning re-sorts without yanking the viewer away from whatever
    they're currently reading; adding a participant grows a 1:1 into
    a visible group for the added person live; and — the part that
    actually matters most here — a message sent in a conversation that
    was *created during the same live session* (never covered by the
    connection's initial subscription set) arrives for the other
    side with **exactly one** render, confirmed by hunting down the
    double-delivery bug above and re-confirming clean after the fix,
    not just the first time it happened to work.

### Batch 15 — 2026-09-14 (LaTeX rendering, and a reply preview with nothing to preview)

60. [x] LaTeX/math rendering — this was never actually implemented
    before (checked: the from-scratch `markdown.ts` renderer had no
    math handling of any kind), so "$e^{i\pi} + 1 = 0$ renders as
    literal text" wasn't a regression, it was the honest previous
    state. Added real math typesetting via KaTeX — the first runtime
    dependency this project has ever had (previously zero, by design;
    reinventing LaTeX typesetting from scratch the way the rest of the
    markdown renderer is hand-rolled would be a genuinely bad idea,
    this is exactly the kind of thing a mature, narrowly-scoped
    library is worth pulling in for). Syntax: `$...$` for inline math,
    `$$...$$` (one line, or as its own fence wrapping multiple lines,
    the same shape as a ` ``` ` code fence) for a centered display
    equation. KaTeX's own generated markup is the one deliberate,
    documented exception to this codebase's "never innerHTML on
    message content" rule — it's a well-audited library built
    specifically to safely typeset *untrusted* LaTeX, and is left at
    its default `trust: false`, which is what disables the handful of
    commands (`\href`, `\includegraphics`) that could otherwise reach
    outside the page. Cost: KaTeX's fonts add real weight — the
    gzipped bundle grew from ~28KB to ~107KB — a one-time, unavoidable
    price for genuine math typesetting, not something worth chasing
    down further at this app's scale. Verified live: the exact
    reported example renders as a real equation, a multi-line `$$`
    block renders as a centered display equation, and (since message
    content is stored raw and rendered fresh client-side) *existing*
    messages containing `$...$` from before this shipped picked up
    real rendering immediately too, no backfill needed.
61. [x] **Bug report**: "replies to markdown messages don't render the
    markdown." The reply-quote line under an actual *sent* reply
    (fixed for exactly this in batch 9 item 48) was fine — re-tested
    live to be sure, still renders real `<strong>`/`<em>`/math. The
    real gap was one step earlier: the "Replying to X" banner shown
    above the composer *while you're writing* the reply never showed
    any preview of the original message at all, rendered or
    otherwise — just the author's name. Added a truncated, rendered
    (via the same `renderInline` used everywhere else) preview after
    an em-dash, ellipsis-truncated in a flex layout so a long original
    message can't blow out the banner's width. Verified live: the
    banner now shows the rendered preview (confirmed with the exact
    reported LaTeX example rendering as real math there too), and the
    already-working quote-line under the sent reply was reconfirmed
    unaffected.

### Batch 14 — 2026-09-14 (one timestamp too many)

59. [x] Removed the hover-revealed timestamp on grouped messages
    (`.message-hover-timestamp`, added in batch 10 item 52) — with the
    day-divider lines and the always-visible time next to the sender's
    name already covering it, this third hover-only timestamp was
    redundant and, per the report, looked "weird." Deleted the element
    entirely (its creation in `buildMessageItem`, and its CSS) rather
    than just hiding it. `.message-item`'s `position: relative` stays
    — the hover action buttons (reply/edit/more) depend on it
    independently. Verified live: the element no longer exists in the
    DOM at all, day dividers and the per-group sender-line timestamp
    both still render, and hovering a message now only reveals the
    action buttons.

58. [x] Toggling your camera or screen share mid-call — or switching
    voice channels while already in one — played the "someone left"
    sound and hid the voice status bar for an instant, immediately
    followed by "someone joined" again, and (worse) briefly vanished
    your own row from *everyone else's* participant list in that
    channel, playing them a peer-left/peer-joined sound pair too.
    Found this by re-reading the rejoin path while double-checking the
    layout work above, not from a report.

    Root cause: `VoiceClient.join()`'s internal rejoin (any time the
    peer connection gets rebuilt without a real disconnect) calls
    `leave(false)` first to tear down the old connection — but `leave`
    unconditionally sent the gateway an explicit "left voice" signal
    and fired the local `onStateChange(false, ...)` callback, both of
    which are only correct for an *actual* departure. The fresh offer
    `join()` sends immediately after already tells the server (and
    through it, everyone else) about the transition on its own — the
    gateway's offer handler only announces a departure from the old
    channel when the channel id actually changed, and always announces
    arrival at the new one — so the explicit leave signal was pure
    noise at best, and at worst (same-channel rejoin, i.e. every
    camera/screen toggle) a flat-out lie broadcast to the whole room.
    Added a `notifyLeave` parameter to suppress both side effects for
    internal rejoins, with the local UI still correctly told about a
    real drop if the rejoin's own `getUserMedia` call fails (since
    there's no follow-up offer to announce that instead).

    Verified live with two real browser sessions (admin + alice) in
    the same voice channel: polled alice's view of the participant
    list every 40ms through admin's camera toggle — admin's row never
    disappeared even momentarily, and admin's own status bar/connected
    indicator never flickered either. This part of the fix doesn't
    depend on real ICE/media connectivity (it's pure gateway
    WebSocket signaling), so unlike most of this feature, it's
    genuinely confirmed working, not just reasoned through.

### Batch 12 — 2026-09-14 (video tiles forced into the wrong shape)

57. [x] Shared screens and webcams looked "cut off" — every
    `.video-tile` was hard-coded to a 16:9 box with `object-fit: cover`,
    so anything that wasn't exactly 16:9 (most monitors/windows being
    shared, and plenty of webcams) got cropped to fit instead of shown
    whole. Fixed properly rather than just switching to
    `object-fit: contain` (which alone would just add letterbox bars
    around a still-wrong-shaped box): the tile now sets its own
    `aspect-ratio` from the actual track's real dimensions once
    they're known (`loadedmetadata`, and `resize` too, since a shared
    *window* can change size mid-call if the sharer resizes it), so
    the box itself is the right shape and `contain` never has to draw
    a single letterbox pixel in the common case. 16:9 remains only a
    momentary fallback before that's known. Routed through a
    `--video-intrinsic-ratio` CSS variable rather than setting
    `aspect-ratio` directly, so the focused/spotlight tile (fills
    available space, ignores intrinsic ratio) and the collapsed
    circular thumbnails (deliberately still cropped, same as a profile
    picture) — both of which need to override this — keep doing so on
    normal CSS specificity instead of losing to an inline style.
    Verified live (headless Chromium, real fake camera at its actual
    640×480/4:3 default rather than 16:9): tile aspect now matches the
    stream's real ratio essentially exactly, and both the spotlight
    (fills flex space, ignores the ratio) and collapsed (locked to a
    48×48 circle) states still correctly win over it.

### Batch 11 — 2026-09-13 (webcam stopping after ~9s)

56. [x] **Bug report**: webcam share automatically stopped after
    roughly 9 seconds; audio-only calls were unaffected. Confirmed
    fixed by the user after retesting. Two attempts along the way:

    **First attempt (confirmed NOT the cause — reported "still does
    the same" after deploying it)**: `request_keyframe_throttled`
    wasn't checking the track's media kind before requesting a
    keyframe, so ordinary audio packet loss triggered a video-specific
    FIR request against the audio track. Real defect, fixed it
    regardless (implementation didn't match its own doc comment), but
    it turned out not to be what was cutting the camera off — worth
    knowing since str0m's own vendored example has this identical gap,
    so it evidently doesn't destabilize things on its own.

    **Second attempt, the actual likely cause**: found by reading
    `is::agent::IceConnectionState`'s own doc comment (the crate under
    str0m providing ICE state). Our code — copied from str0m's own
    `chat.rs` example, which flags this exact spot with "this impl
    just disconnects directly" as a known simplification — called
    `rtc.disconnect()` the instant ICE reported `Disconnected`. But
    that state's own documentation says it "may trigger intermittently
    and resolve just as spontaneously on less reliable networks...
    may return to the connected state" — it's an expected, often
    self-healing blip, not a failure. Video needs far more bandwidth
    than audio, so a real (imperfect) network is much more likely to
    trip this transient state once video's flowing than it ever is for
    audio alone — matching the report precisely (audio fine, video
    specifically cuts out). Fixed by adding a grace period
    (`ICE_DISCONNECT_GRACE`, 15s): the SFU now only actually
    disconnects if ICE stays in `Disconnected` continuously for that
    long, instead of on the very first blip, and clears the timer the
    moment it's seen recovering back to `Connected`/`Completed`.

    Also added logging to actually catch this if it recurs: server-side
    `tracing::info!` on every ICE state transition (visible in
    `docker compose logs`), and client-side `console.log` for
    `RTCPeerConnection` connection/ICE state changes plus the camera
    track's `ended`/`mute`/`unmute` events (browser DevTools console).

    Not independently verified live by me — this environment's Docker
    networking still can't complete a real ICE handshake at all (see
    item 54), so I reasoned from str0m's own documented state
    semantics and its example's own flagged simplification, not from
    having watched it happen myself — but the user confirmed on a
    real call that the camera now stays on. The added logging (server
    `tracing::info!` on ICE state transitions, client `console.log`
    for connection/track state) stays in place in case a different
    trigger for the same symptom shows up later.

### Batch 10 — 2026-09-13 (video/call layout refinements)

55. [x] Video call layout refinements, following up on item 54:
    - **Resizable channel/DM sidebar**: a drag handle on the sidebar's
      right edge (`.sidebar-resize-handle`) lets you make the
      channel/DM list column wider or narrower (180–480px), persisted
      to `localStorage` so it's remembered next visit. The far-left
      server-icon rail stays fixed width on purpose — narrowing a
      strip of icons down doesn't gain anything, and it's what Discord
      does too.
    - **Auto grid for multiple video tiles**: `.video-tiles` is now a
      real CSS grid (`repeat(auto-fit, minmax(220px, 1fr))`) that
      reflows on its own as people join/leave or turn video on/off,
      instead of the old flex-wrap row.
    - **Focus/spotlight a tile**: hovering any tile reveals a small
      control cluster; the expand icon makes that tile the large
      "spotlight" view with everyone else demoted to a filmstrip
      underneath (click again, or focus a different tile, to change
      it) — this is on top of the grid, not instead of it, so group
      calls default to the grid and focusing is an explicit choice.
    - **True full screen**: a second per-tile control uses the real
      browser Fullscreen API, so a shared screen (or a camera) can
      take over the whole monitor, not just grow within the app.
    - **Minimize**: a toolbar button shrinks the whole video area down
      to a row of small circular previews (Discord's "talking heads"
      idea) without disconnecting — you keep the channel's chat in
      full view and audio keeps flowing either way.
    - **Pop out over other windows**: for the "gaming with friends
      floating in the corner" and "podcasting while browsing another
      tab" cases raised — a pop-out button (hidden entirely in
      browsers that don't support the underlying API, e.g. current
      Firefox/Safari) uses the Document Picture-in-Picture API to
      float the video tiles in their own small window that stays on
      top of *other applications*, not just other browser tabs. This
      is the actual best fit for what was asked: real OS-level overlay
      (like Discord's floating heads) isn't something a web app can do
      at all without a native desktop wrapper, and Document PiP is the
      closest the web platform gets — one caveat is it only exists in
      Chromium-based browsers today.
    - **Screen-share picker defaults**: since the browser's own
      share-a-screen/window dialog can't be restyled, passed it hints
      instead — default to offering whole screens/windows over
      individual browser tabs, let you switch which window/tab is
      being shared without restarting the share, skip offering to
      share the chat tab back at itself, and don't show a system-audio
      checkbox for something that isn't relayed anyway.

    Found and fixed one real bug while building this: the panel-level
    toolbar (minimize/pop-out) was an absolutely-positioned overlay in
    the panel's top-right corner — the exact same corner a tile's own
    per-tile controls sit in once that tile becomes the full-width
    spotlight, so the toolbar sat on top of and blocked clicks to that
    tile's own focus/fullscreen buttons. Fixed by making the toolbar a
    normal, non-overlapping bar above the grid instead of a floating
    overlay. Verified live (headless Chromium, real DOM/class-state
    inspection, not just visual) for: sidebar drag + persistence
    across reload, grid layout with 2 tiles, focus → spotlight →
    unfocus round-trip, collapse to circles, and pop-out → tiles
    render in the floating window with styles intact → closing it
    moves tiles back to the main window cleanly. Fullscreen and the
    screen-share picker-hint hints are not independently verified live
    (fullscreen requires a real display server headless Chromium
    doesn't have; the picker hints only affect the browser's own
    native dialog, which automation can't inspect either) — both are
    standard, spec'd APIs used per their documented contract, but flag
    this the same way item 54 flags its own unverified pieces.

### Batch 9 — 2026-09-13

47. [x] "Add reaction"/system-status popovers opening off-screen —
    both `renderEmojiPopover` and the server-resource-usage popover
    used `anchor.getBoundingClientRect()` plus unclamped
    `top = rect.top - popover.offsetHeight - 8` math, which pushes the
    popover above/off the viewport whenever the anchor button is near
    the top or an edge (exactly what happened after item 46 moved the
    status button into the header's top-right corner). Fixed both by
    switching to true viewport centering
    (`position: fixed; left/top: 50%; transform: translate(-50%,-50%)`)
    instead of trying to clamp anchored coordinates. Verified live via
    headless Chromium for both popovers — each renders centered in a
    1280×720 viewport regardless of which message/button triggered it.
48. [x] Quoted-reply preview (the small "↩ Author: text" line shown
    above a message that's a reply) was rendering the quoted message's
    raw markdown source instead of formatted text. Added
    `markdown.ts`'s `renderInline()` (a thin wrapper exposing the
    existing single-line inline renderer) and used it in
    `renderReplyPreview` instead of `textContent`. Verified live:
    replying to a message containing `**bold** and *italic* and
    \`code\`` now shows a quote line with real `<strong>`/`<em>`/`<code>`
    elements, not literal asterisks/backticks. Block-level markdown
    (e.g. a table) still shows as its raw source in the quote line —
    that's intentional, not a miss: a one-line quote preview has no
    sensible way to render a multi-row table inline.
49. [x] Enable/disable MFA is now a single toggle switch instead of two
    separate buttons that appeared/disappeared based on state. Flipping
    it only *starts* the enroll (off→on) or disable (on→off) flow, both
    of which still need a confirmation code — the checkbox snaps back
    to the last confirmed state until that flow actually completes, so
    it can't silently claim a change that didn't happen.
50. [x] You can now call your friends in Direct Messages — the voice
    "join channel" flow (SFU signaling, mute/deafen, participant
    tracking) was already guild-agnostic under the hood except for one
    hardcoded assumption in the gateway's voice-signaling handler that
    a voice channel always belongs to a guild. Generalized via the
    existing `broadcast_room()` helper (already used elsewhere to mean
    "the guild, or the DM channel itself") so a DM channel can now be
    the target of a voice join exactly like a guild voice channel is.
    No new UI concept was needed — the DM header just gets a phone
    icon that starts/ends the same kind of voice connection a guild's
    voice channel would. There's no separate ringing/accept flow (per
    #6's ask, this is "call", not "video call with a ringtone") —
    joining is instant, same as guild voice.
51. [x] Direct Messages list now shows each conversation's avatar(s),
    not just names — single-participant DMs show that person's real
    avatar, self-DMs show your own, and group DMs (more than one other
    participant) show a generic multi-person icon since there's no
    single face to show.
52. [x] Added a day divider ("SEPTEMBER 13TH, 2026") in the message
    list whenever the date changes between two consecutive messages,
    and a hover-revealed exact timestamp on every message (in addition
    to the always-visible relative/short time next to the author name)
    — both confirmed live in a real channel history. **The
    hover-revealed timestamp was removed again in batch 14** — with
    the day divider and the always-visible per-group timestamp both
    already there, it was one timestamp too many.
53. [x] Added short synthesized join/leave sounds for voice channels —
    a distinct (louder) tone for your own join/leave, a quieter
    variant when someone else joins/leaves a channel you're already
    in. Generated with the Web Audio API (two-tone sine sweeps) rather
    than shipping audio asset files, so there's nothing to fetch, host,
    or license.
54. [ ] Webcam video chat and screen sharing — backend (str0m SFU
    relay generalized from audio-only to any media kind, with real
    PLI/FIR keyframe-request forwarding so a receiver's stuck decoder
    can ask the original sender for a fresh keyframe) and frontend
    (camera/screen-share toggle buttons, video tiles for your own and
    remote participants' streams) are both fully written, and pass
    every check that doesn't require two real browsers actually
    exchanging live media: `cargo build`/`clippy`/`test` (38 tests,
    unchanged pass count), `tsc --noEmit`, and a structural comparison
    against str0m's own vendored `chat.rs` reference example (the
    relay/keyframe pattern here is modeled on it directly, not
    guessed). Deliberate scope cut: only one non-audio source at a
    time per person (camera *or* screen, not both) — telling them
    apart for the *same* sender would need track-kind metadata in
    signaling that doesn't exist yet, and this sidesteps needing it.
    Turning the camera/screen-share on or off triggers a full
    rejoin/renegotiation rather than incremental track add/remove
    (the SFU treats every offer as a fresh join already), which costs
    a brief audio blip — same trade-off channel-switching already has.

    **Not verified end-to-end with real video in this environment**,
    and that's a real gap, not a formality: I built a two-browser
    Playwright harness to actually watch one participant's camera
    frames arrive at another's `<video>` tile, and it never got there.
    Diagnosis (with temporary server-side tracing, since reverted):
    STUN/ICE packets from headless Chromium *do* reach the SFU's UDP
    socket, and `str0m` does start negotiating (`IceConnectionState`
    reaches `Checking`), but the handshake never reaches `Connected` —
    no `Event::MediaAdded` ever fires, for audio *or* video, even for
    the plain voice-join path that predates this feature. That strongly
    points at this sandbox's Docker networking (UDP NAT hairpin
    loopback back to `127.0.0.1`) rather than a code bug: the same
    relay code path is what the existing audio-only voice feature has
    always used, str0m's own example uses the identical pattern, and
    packets *do* arrive at the server — they just never complete a
    round trip back through this environment's specific network setup.
    It also means the earlier "audio still works" regression check
    elsewhere in this project's history was weaker evidence than it
    looked: it only confirmed the client-side "connected" UI flag,
    which flips optimistically right after sending an offer, not that
    audio actually reaches the other party. **Please do a real
    two-browser test on your own machine before relying on voice or
    video/screen-share for anything that matters** — camera/mic
    permission prompts, actual video frames rendering in the remote
    tile, and keyframe recovery after simulated packet loss are all
    still unverified by me.

### Batch 8 — 2026-09-13

38. [x] Per-server management menu — new gear icon in the sidebar
    header (guild view only) opens a "Manage server" modal, visible to
    every member but only editable by the owner:
    - **General**: rename + re-icon (reuses the same crop flow as
      server creation). Read-only, with "Owned by X", for non-owners.
    - **Members**: full member list with an owner badge; owner can
      Remove anyone else; an "Anyone can create invites" checkbox
      flips the `@everyone` role's existing `CREATE_INVITE` permission
      bit on/off — this MVP has no assignable admin role separate from
      the owner, so every owner-only action here is gated on
      `Permissions::MANAGE_GUILD`/`KICK_MEMBERS`, which in practice
      only the owner can ever hold (the `resolve()` owner-bypass) until
      a real multi-role system exists. Turns out `can_invite` (checked
      during earlier investigation) is unrelated — it's an
      instance-level registration-invite flag, not a per-guild one.
    - **Danger zone** (owner-only, not shown to anyone else): transfer
      ownership to another member (confirm dialog spells out that the
      old owner immediately loses all admin control and can't reverse
      it themselves) and delete the server (type-to-confirm the exact
      server name, matching how seriously irreversible it is).
    Verified the whole matrix via curl before writing any UI — kick,
    self-kick and owner-kick both correctly rejected, invite-policy
    toggle actually blocks/allows non-owner invite creation, ownership
    transfer immediately revokes the old owner's admin powers, and
    guild deletion cascades cleanly (checked empirically with a
    standalone script first: `messages.reply_to` has no `ON DELETE`
    action, but deleting the whole guild in one statement — unlike
    deleting a single message — never trips it, since SQLite only
    checks `NO ACTION` foreign keys at the end of the statement, by
    which point both the reply and its target are already gone).
    Then verified the UI matches those same permission boundaries with
    a real headless-Chromium run as both the owner and a regular
    member. Found and fixed one real bug along the way: a "Save name"
    button inside a `.field` was stretching full-width because
    `.field`'s flex-column default `align-items: stretch` applied to
    it same as the text input beside it.
39. [x] `.guild-rail-divider` didn't line up with the bottom of
    `.sidebar-header`/`.channel-header` (both end at 64px) — it sat
    ~1.6px below, a small but real pixel misalignment. Adjusted
    `.guild-rail`'s top padding so the math lands the divider's top
    edge within a hair of exactly 64px (measured 63.98px after the
    fix — a headless-Chromium check confirmed it, not just the CSS
    arithmetic).
40. [x] Added a markdown preview toggle to the composer (eye icon, next
    to the formatting-snippets button) — renders the current draft
    through the same `renderMarkdown()` the message list uses,
    swapping in for the textarea until toggled back or the message is
    sent/channel switched.
41. [x] Message "..." menu items ("Add reaction"/"Copy text"/"Delete
    message") were rendering centered instead of left-aligned — a
    real regression from item 37's global button-flex change: menus
    with `display:flex` but no explicit `justify-content` inherited
    `center` from the base `button` rule instead of the left-alignment
    they need. Audited for the same issue elsewhere and found two more
    real instances (`.settings-nav-item`, `.user-search-row`) with the
    identical bug — fixed all three.
42. [x] "Add reaction" moved from a permanent `+` pill under every
    message into the "..." menu (as the first item, smile icon) —
    `renderReactions()` now only renders a row when there are already
    reactions on the message, so a fresh message doesn't carry a
    permanently-visible empty affordance.
43. [x] Settings modal enlarged and restyled to read more like an
    actual settings page (matching a Discord reference screenshot) —
    900px instead of 680px wide, taller, and the nav column now has
    its own darker background bleeding to the modal's edges instead of
    floating inside uniform padding. Didn't attempt the full "single
    continuous scroll across page-like sections" architecture Discord
    actually uses; kept the existing tab-switching model since that's
    a much larger change for uncertain benefit at Chatly's current
    settings surface area (5 tabs).
44. [x] **Bug:** the guild-icon preview in "Customize your server"
    showed nothing after cropping (`server-icon-picker` — real root
    cause this time, unlike item 31's inconclusive first pass).
    `GET /api/files/:id` rejected the request with 404: an uploaded
    file only became viewable once attached to a message, guild icon,
    or avatar, and the create-server flow previews the crop *before*
    the guild (and thus the icon_file_id link) exists — a genuine
    chicken-and-egg gap in `uploads::download`'s access check, not a
    frontend bug. Fixed by letting a file's own uploader always view
    it regardless of attachment state — doesn't loosen anyone else's
    access, only ever grants the person who provided the bytes a way
    to see them again. Verified via a real crop → upload → preview run
    (`naturalWidth` went from 0 to 256, and the screenshot shows the
    actual gradient image instead of a blank circle).
45. [x] Removed the member-invite picker from channel creation —
    people are added afterward through the channel's own manage panel
    (gear icon → already supports add/remove members and admins),
    which already worked and made the duplicate picker at creation
    time redundant. Creation is now just name + text/voice.
46. [x] Moved "Server resource usage" (item 26) from the sidebar
    footer into the top-right corner of the channel header — required
    splitting `channelHeader`'s single mutable text/icon slot into a
    stable `channelHeaderLabel` (left, gets replaced per
    channel/DM/empty-state as before) and a persistent
    `channelHeaderRight` (holds the status button, survives all of
    that).

### Batch 7 — 2026-09-13

34. [x] **Bug:** "The delete of messages doesn't seem to work." Root
    cause found and it's a real, likely-impactful one: the gateway
    WebSocket's CSRF-style origin check compared the browser's
    `Origin` header against `PUBLIC_URL` with plain string equality —
    `PUBLIC_URL=http://localhost:8090` but a browser reaching the app
    at `http://127.0.0.1:8090` (e.g. via VS Code port forwarding) sends
    `Origin: http://127.0.0.1:8090`, which never matched, so the
    gateway connection was silently rejected (403) on every such
    browser. The DELETE (and edit/reaction) REST call still succeeded
    server-side — the message really was gone — but the client never
    got the `MESSAGE_DELETE` echo telling it to remove the element, so
    the UI looked like nothing happened. Reproduced this exact
    sequence with real Chromium hitting the app via `127.0.0.1` before
    fixing it. Fix: `origin_allowed()` in `gateway/mod.rs` now also
    accepts the other loopback spellings (`localhost`/`127.0.0.1`/
    `[::1]`) on the same scheme+port as `PUBLIC_URL`, instead of
    requiring an exact string match — widens *only* loopback
    equivalence, so a genuinely different (cross-site) origin is still
    rejected exactly as before. 8 new unit tests. Re-verified live:
    delete now reflects immediately with no refresh needed.
35. [x] Message hover actions redesigned to match the compact
    "icons + `...` overflow" layout the user pointed at (a Discord
    screenshot) — trimmed down to what Chatly actually has, not
    Discord's full list. Reply and Edit stay as always-visible hover
    icons; a new `...` opens a small dropdown with Copy text and (if
    permitted) Delete, styled red with a divider above it — mirroring
    Discord's own convention of tucking the destructive action behind
    "more" rather than leaving it always visible. Found and fixed a
    real bug while building this: the delete option's text was
    invisible (red-on-red) because its `.danger` class collided with
    the app-wide `button.danger` rule (solid red background, meant for
    standalone CTA buttons) — added an explicit `background: none`
    override.
36. [x] Removed the "Restricted — only invited members can see this
    channel" checkbox from channel creation — every channel now always
    requires being explicitly added, full stop, both in the UI (no
    toggle, just an explanatory line + the member picker) and
    server-side (`create_channel` no longer reads a client-supplied
    flag at all; it's hardcoded `true`), so there's no way to create an
    open-to-the-whole-guild channel through this API any more.
37. [x] Follow-up from item 33's Settings redesign: "Log out"/"Log out
    everywhere" (and, it turns out, any button combining an icon with
    text anywhere buttons don't already opt into flex layout) rendered
    with the icon stacked above the text instead of beside it, making
    the button much taller than intended, and text could wrap
    mid-word at narrow widths. Root cause: the global `button` rule
    didn't set `display: flex`, and the icon SVG's own `.icon` rule is
    `display: block` — block-level content always forces a line break
    around itself unless the parent is a flex/grid container. Fixed at
    the source: the base `button` rule is now `inline-flex` with
    `align-items: center` and a `gap`, plus `white-space: nowrap` and
    `flex-wrap` on multi-button rows in Settings specifically. Verified
    at 480px width (a narrow VS Code panel is the likely real
    scenario) across Account/Security/Devices — no more stacking or
    mid-word wraps.

### Batch 6 — 2026-09-13
26. [x] Server load/resource visibility — the user runs this alongside
    other things (e.g. gaming) on the same machine/connection and
    wants to see if the server is straining it. Added a live status
    pill in the sidebar footer (next to mute/deafen/settings) showing
    CPU%, refreshed every 3s via a new `GET /api/system/stats`;
    clicking it opens a popover with memory and network throughput
    too. New `sysstats` module runs a background sampler
    (`sysinfo` crate) on a 2s tick. Important nuance, documented in
    both the code and the popover copy: CPU/memory are **whole-machine**
    figures (Docker doesn't namespace `/proc` by default, verified
    this matches `free -b` on the host exactly) — which is actually
    what's wanted here ("is hosting this competing with my game").
    Network is scoped to the container's own interface only (no host
    networking), so it reads as Chatly's own traffic, not the host's
    total — a narrower but still useful number. Verified via curl
    (values change realistically under load) and a real headless-
    Chromium check of the rendered pill/popover.
27. [x] Group DMs (more than 2 participants in a DM channel). The
    schema already supported N participants per DM channel (a plain
    join table) — this was really an API/UI restriction, not a
    missing data model. `POST /api/dms` now takes `usernames: string[]`
    instead of one `username`; exactly one other person keeps the old
    find-or-create 1:1 behavior (so repeatedly messaging the same
    person doesn't spawn duplicates), two or more always creates a
    fresh group channel with no dedup (matches Discord: starting a new
    group makes a new one even with the same people), capped at 10
    participants total. `DmSummary.other: User` became
    `participants: User[]` (breaking API change, but this is a
    single-instance self-hosted app with one client — no versioning
    concern). Client's "Message someone" modal now supports picking
    several people via removable chips before submitting, and the DM
    sidebar label is a comma-joined name list for groups. Verified via
    curl (1:1 dedup still works, group creation, no dedup on repeat,
    permission check still rejects non-participants) and a real
    headless-Chromium run of the full picker → chip → submit flow
    against the deployed instance. Cleaned up the group-DM channels
    created while testing this from the live database afterward (left
    the pre-existing self-DM and admin↔alice conversations untouched —
    verified message counts before/after).
28. [x] Friend lists, and a non-spammy way to invite friends (QR code
    or a sendable invite link, not e.g. auto-messaging). Deliberately
    NOT a search-and-send-request system: the only way to become
    friends is one person generating a shareable code/link/QR (new
    `POST /api/friends/invites`, reusing the same expiry/max-uses
    shape as guild invites, plus a QR helper pulled out of the
    MFA-enrollment code into `crates/server/src/qr.rs` so both share
    it) and the other person redeeming it (`POST /api/friends/redeem`)
    — nobody can be added without taking that action themselves,
    which is the "not spammy" part. Friendship itself is a plain
    undirected `friendships` table (canonical `min(a,b), max(a,b)`
    ordering, one row per pair). New "Friends" button in the DM home
    sidebar (people icon) opens a modal: your friends list (Message
    opens a DM, Remove unfriends), generate-an-invite (link + QR,
    copy-to-clipboard), and a paste-a-code-or-link box to redeem one.
    Verified via curl (self-redeem rejected, redeeming creates the
    friendship on both sides, redeeming twice correctly reports
    already_friends, removal works) and a real headless-Chromium run
    of the invite-generation and friends-list UI against the deployed
    instance. — **Replaced entirely in batch 16 item 62**: the
    invite-link/QR system and the standalone "Friends" list/button are
    both gone, replaced by a real search-and-request flow with friends
    folded into the DM list itself.
29. [ ] Voice channel participant display: now shows each person's
    *name* next to their avatar (was icon-only). The blink-when-
    speaking glow still only works for the local user's own row —
    detecting *remote* participants' speaking state would need the
    SFU to expose a per-track → user-id mapping (see batch 1 item 4/
    batch 4 item 4), which hasn't been built. Leaving this open until
    that's addressed.
30. [ ] Video chat and screen share — explicitly still wanted, on top
    of voice. (Item 9's architecture question — unifying text+voice+
    webcam into one channel — is still open above; this may be
    approached as an addition to the *existing* voice-channel model
    instead, which doesn't require that unification. Check
    UX_FEEDBACK once attempted for which path was taken.) — **now
    done** via batch 9 item 54: added on top of the existing
    voice-channel model, no channel-model unification attempted. See
    item 54 for the current, still-not-fully-verified state, and item
    56 for a real bug found in it since.
31. [ ] **Bug:** in "Customize your server", after positioning the
    image in the cropper, the preview inside the crop circle shows a
    grey square instead of the actual crop — the correct image only
    shows up afterward, in the guild rail, once the server is created.
    Tried to reproduce with real Chromium (Playwright) driving the
    deployed instance — drag, zoom, small and multi-megabyte images,
    sampling pixels at short intervals right after file selection —
    and couldn't force the grey square to appear; the live preview
    painted correctly every time. Found and fixed a real related gap
    though: the cropper only listened for the image's `load` event,
    which guarantees dimensions but not that a frame is paintable yet,
    and had no `error` handler at all — a slow/failed decode could
    plausibly leave the viewport showing nothing but its own grey
    background with no visible error. Now awaits `img.decode()` before
    the first render and shows an alert instead of a silent grey box
    if the file can't be decoded. Leaving this open since I couldn't
    confirm the original symptom is actually gone — if it recurs,
    next time note the browser and whether the source file is a
    photo straight off a phone (EXIF/HEIC would be my next suspect).
32. [x] The mute/unmute-mic icon pair looks fine, but the
    deafen/undeafen (headphones) icon doesn't look consistent with
    it — should also be a plain headphones icon vs. a crossed-out
    variant, matching the mic/mic-off pattern. Added a `headphones-off`
    icon (headphones outline + diagonal strike, same treatment as
    `mic-off`); the deafen buttons (both the per-channel voice control
    and the global one) now swap between `headphones`/`headphones-off`
    based on `voiceClient.isDeafened`, same as the mic buttons already
    did.
33. [x] Settings still looks rough: oversized buttons, inconsistent
    margins. Security specifically shouldn't dump a long, fully
    expanded session list — should be compact by default with
    delete-on-demand, not everything visible at once. Introduced one
    `section()` helper so every tab has the same heading/spacing
    rhythm instead of each tab improvising its own margins, and
    scoped a more compact button size to the settings modal only
    (left the rest of the app's buttons — composer send, etc. —
    untouched). Security's session list now shows only the current
    device (tagged "This device", not revocable from here) plus a
    "Show N other sessions" toggle that's collapsed until clicked;
    added a small `is_current` field to the session API response
    (computed from the existing session id already carried by the
    auth extractor) to make this possible. Verified all five tabs and
    the collapse/expand toggle with a real headless-Chromium run
    against the deployed instance (screenshotted each tab; confirmed
    the toggle actually flips `hidden` and its own label).

### Batch 5 — 2026-09-13
22. [x] Delete your own messages; guild owner or a channel admin can
    delete anyone's in a channel they moderate. New `DELETE
    /api/messages/:id`, broadcasts a new `MESSAGE_DELETE` gateway
    event (hard delete, not soft — matches the rest of this app's
    "no undo yet" posture). Client-side gating for the trash icon
    reuses the same `channel.is_admin` flag already computed for the
    per-channel access-control work (item 13), so no extra request
    needed to decide whether to show it. Found and fixed a real
    landmine while implementing this: `messages.reply_to` has no
    `ON DELETE` action, so deleting a message with replies would have
    hit a foreign-key violation under `PRAGMA foreign_keys=ON` —
    verified this failure mode with a standalone script first, then
    fixed it by nulling out dependent `reply_to` references before the
    delete rather than risking a table-rebuild migration. Verified via
    curl (author deletes own; non-author non-admin gets 403; guild
    owner deletes someone else's as moderator; deleting a message with
    a reply doesn't crash the server, and the reply's preview
    correctly disappears) and a real WebSocket client confirming a
    second user receives the live `MESSAGE_DELETE`.
23. [x] Edit your own message, only within 5 minutes of creation
    (`PATCH /api/messages/:id`, checked server-side against
    `created_at` — the edit button's visibility client-side is just a
    hint, not the real enforcement). Re-parses mentions on every edit.
    Reuses the existing reactions' "mutate then re-broadcast as
    MESSAGE_UPDATE" helper (pulled out of `reactions.rs` into
    `permissions.rs` so both could share it) rather than inventing a
    parallel path. Verified via curl: author edits within window
    succeeds and shows `edited_at`; a non-author gets 403.
24. [x] Reply/quote another message. The `messages.reply_to` column
    already existed in the schema from Phase 2 but was completely
    unused — wired it up. A reply must target a message in the *same*
    channel (rejected otherwise, so a client can't probe whether a
    message id exists in a channel it can't see). Each message
    carries a `reply_preview` (replied-to author + a truncated content
    snippet) computed server-side via a join, so the client never
    needs a second fetch to render the quote header — and it becomes
    `null` gracefully if the original was deleted, rather than
    erroring. Verified via curl end-to-end, including the
    delete-with-dependent-reply case above.
25. [x] Markdown quality-of-life: fenced code blocks and GFM-style
    tables, plus a formatting-snippet picker (mirrors the emoji
    picker — Bold/Italic/Inline code/Code block/Table/Link) so people
    don't have to memorize the syntax. **LaTeX is not actually
    rendered** — real math typesetting needs a dedicated library
    (KaTeX/MathJax), a much bigger addition than this pass; the "Math"
    snippet just drops the source into a fenced code block so it at
    least displays verbatim and legibly instead of getting mangled.
    Found and fixed a real bug while testing: the table-row splitter's
    regex greedily consumed the trailing `|`, producing a spurious
    empty cell that made the separator-row check silently fail for
    every table — caught by an actual unit test of the renderer, not
    just eyeballing the code, which is exactly why that test was worth
    writing.

### Batch 4 — 2026-09-12
21. [x] **Bug, root cause found:** MP3 (and any file over ~2MB)
    uploads were rejected. Not a file-type restriction at all —
    there's never been a mime allowlist in the upload path — it was
    axum's own silent default request-body limit (2MB, applied
    automatically unless overridden) rejecting the multipart body
    before our own `max_upload_bytes` check ever ran. Small test
    images happened to slip under 2MB; real-world audio/video almost
    never does, which is exactly why it looked file-type-specific.
    Fixed by scoping `DefaultBodyLimit::max(max_upload_bytes)` to the
    `/api/uploads` route (`crates/server/src/api/mod.rs`), so our own
    configurable limit (1024 MB by default) is what actually decides,
    not an unrelated hard-coded cap. Verified via curl: a 3MB generic
    file and a 5MB synthetic MP3 both failed before this fix
    (`400 invalid_upload — Error parsing multipart/form-data request`)
    and succeed after it.

### Batch 3 — 2026-09-12
14. [x] Mic mute and headphone deafen decoupled — deafen no longer
    forces mute on (voice.ts's toggleMute/toggleDeafen no longer touch
    each other's state). Added a matching deafen button to the
    in-call status bar too (previously only mute+leave were there).
    Verified via jsdom: clicking deafen leaves the mute button
    unaffected.
15. [x] Fixed button text overflow: buttons weren't allowed to wrap
    (`white-space`/`max-width` unset), so a long label like the old
    "Grant microphone access to see device names" forced the button
    wider than its container instead of wrapping. Added a global
    `max-width: 100%; white-space: normal;` to the base `button` rule,
    and shortened that specific label regardless.
16. [x] Channel creation implemented end-to-end: `POST
    /api/guilds/:id/channels` (name + kind, gated on
    `Permissions::MANAGE_CHANNELS` — in practice only the guild owner,
    since roles/overwrites still aren't manageable — see open item 13),
    a "+" button next to Invite in the sidebar header (owner-only,
    hidden for everyone else), a create-channel modal with a text/voice
    picker, and a command-palette entry. Verified via curl (creates
    correctly, a non-owner gets 403) and jsdom (new channels appear in
    the list).
17. [x] Built a reusable pan/zoom image cropper
    (`web/src/image-cropper.ts`) — drag to pan, slider to zoom 1x-3x,
    exports a plain square JPEG crop (no baked-in circle mask; the app
    already clips avatars/icons to a circle via CSS wherever they're
    shown). Wired into both the guild-icon picker and the new avatar
    picker. The crop math itself (mapping viewport pixels back to
    source-image pixels) is verified by code review and by the modal
    rendering correctly under jsdom, but jsdom has no real canvas
    2D context, so the actual pixel-accurate crop output needs your
    eyes in a real browser.
18. [x] Profile pictures: new `users.avatar_file_id` column
    (migration 0008), `POST /api/me/avatar` (validated to be a file
    you uploaded yourself, mirrors the guild-icon check), served
    instance-wide to any signed-in user (unlike message attachments/
    guild icons, which are scoped to shared channels/guilds — avatars
    are meant to be visible everywhere, e.g. in DM search results with
    someone you don't share a server with). New "Profile" tab in
    Settings (now the default tab) with the picker; messages now carry
    `author_avatar_file_id` and render it everywhere an avatar shows
    (message list, user chip, DM search results). Also added a
    post-registration "Add a profile picture?" step (skippable) since
    upload requires auth and there's no account yet during the signup
    form itself. Verified via curl (upload → set → fetch as a
    different user → post a message → avatar id present) and jsdom
    (renders as an `<img>` with the right src in both the user chip
    and message list).
19. [x] **Turned out to already work** — verified by code inspection,
    not a bug. `voiceClient` is a single persistent object created once
    per session; nothing in `switchGuild`/`selectChannel`/`selectDm`
    navigation calls `voiceClient.leave()` (the only call site is the
    explicit leave button and re-clicking the same voice channel to
    toggle off). The voice status bar lives in the sidebar, a sibling
    of the channel list, so it isn't touched when the channel list gets
    replaced for a different guild/DM view either. No code changes
    were needed. Still worth confirming with real audio in a real
    browser, since jsdom can't exercise actual WebRTC.
20. [ ] **Not started.** Screen sharing. Plausibly tractable — the SFU
    forwards media generically (str0m doesn't hardcode audio-only), so
    `getDisplayMedia()` + `addTrack` + renegotiate should follow the
    same pattern as voice — but unverified, and it's the same category
    of "more attack surface on an unvetted SFU" as webcam (see open
    item 9). Sequencing this after item 9 gets resolved makes sense.
    — **now done** via batch 9 item 54, without waiting on item 9
    (proceeded on the existing voice-channel model instead of
    resolving that architecture question). See item 54/56.

### Batch 2 — 2026-09-12, screenshot of bottom-left menu
1. [x] Bottom-left user menu redesigned Discord-style: avatar with
   online-status dot, name + status text, then circular mic/headphone/
   settings icon buttons (global mute + deafen pre-toggle, works
   whether or not you're in a call).
2. [x] Settings reorganized into categories (left nav: Devices,
   Security, Invites [owner-only], Account) instead of one long
   scrolling modal.
3. [x] **Bug, root cause found:** audio files uploaded fine but
   wouldn't play. `/api/files/:id` ignored `Range` requests and
   streamed the whole file as `chunked` with no `Content-Length` —
   real browsers' `<audio>`/`<video>` elements need Range support to
   play back reliably (curl-ing the file "worked" because curl doesn't
   care). Fixed in `crates/server/src/api/uploads.rs` (`parse_range` +
   206 Partial Content handling).
4. [x] Participant list implemented. Added the missing protocol piece
   (PLAN.md 4.2): a new `VOICE_STATE_UPDATE` gateway dispatch event,
   broadcast to a guild whenever someone joins/leaves one of its voice
   channels — including on an *abrupt* disconnect (closed tab, dead
   connection), not just an explicit leave. A late-joining client
   snapshots current state via a new `GET /api/guilds/:id/voice-state`
   (backed by presence tracking added to `GatewayHub`, not the SFU —
   this is bookkeeping, not media). Voice channel items in the sidebar
   now show a row of avatars for everyone currently connected,
   including yourself. While implementing this, found and fixed a real
   gap: joining a voice channel had **no permission check at all** —
   any authenticated user could join any voice channel by id
   regardless of guild membership. It now requires `Permissions::CONNECT`
   on the target channel, same as everything else. Verified end-to-end
   with real WebSocket clients: a second user receives the join/leave
   events live, the snapshot endpoint reflects who's connected
   mid-call, and it clears correctly even when a connection dies
   without an explicit leave.

   Not done, and worth being explicit about why: **per-participant
   speaking indicators** (only *your own* mic still glows, from batch 1
   item 4's local Web Audio analysis) — the SFU forwards audio
   generically and doesn't currently tell the client which remote
   `MediaStream`/track belongs to which user id, so there's no way to
   attach a speaking indicator to a specific participant's avatar yet.
   That needs either RTP header-extension audio levels forwarded with a
   user-id tag, or a client-side mapping from track/mid to user id
   established during signaling — a real follow-up, not attempted here
   to avoid shipping something fragile I can't verify against a real
   multi-party call. "Easy invite-to-channel": voice channels are
   guild-scoped, so the existing per-guild Invite button already covers
   this — no separate action needed.
5. [x] **Bug, root cause found:** the "Invite" button did nothing in
   the Direct Messages panel. Root cause: `.icon-button` (and
   `.voice-status-bar`) set their own `display` in CSS, which silently
   overrides the `hidden` attribute's default `display: none` — so
   `inviteBtn.hidden = true` on the DMs/home view had no visual effect
   and the button stayed clickable (its click handler correctly
   no-ops with no active guild, but it shouldn't have been visible at
   all). Fixed with a global `[hidden] { display: none !important; }`
   rule in style.css. **This bug class could affect any other
   `.hidden`-toggled element with its own CSS `display` — re-check if
   something else looks "stuck visible" after future CSS changes.**
6. [x] Cmd+K / Ctrl+K command palette (`web/src/command-palette.ts`):
   fuzzy-filters channels in the current guild, DMs, other servers, and
   actions (add/join a server, invite, message someone, settings,
   mute/deafen, log out); arrow keys + Enter to run, Escape to close.
   No visible trigger button (keyboard-only, as asked) — verified via
   jsdom (open/filter/close all work; a `scrollIntoView` call errors
   under jsdom only, since jsdom doesn't implement it — real browsers
   do, not a real bug).
7. [x] This tracking file.

### Batch 1 — earlier in the session, still open
8. [x] Redesigned the "Add a server" modal into a two-step flow
   (`web/src/views/servers.ts`): choose Create or Join, then Create
   shows a circular icon-upload picker (uploads immediately via
   `/api/uploads`, previews the result) + name field; invite-link
   generation was already separate (the guild's own Invite button) —
   turned out the complaint was really about create/join being mashed
   into one screen with no icon option, both now fixed. Backend: new
   `guilds.icon_file_id` column (migration 0007), validated at guild
   creation to be a file the requester actually uploaded, served via
   `/api/files/:id` with a guild-membership check (new
   `guild_for_icon_file` lookup, since icons aren't attached to any
   message/channel). Guild rail now renders the icon image when set.
9. [ ] **Needs a decision, asked once already, no answer yet.** Each
   channel should support text + voice + webcam together, not
   Discord's separate-channel split. This is a real architecture
   change to the channel model, and webcam adds meaningfully more
   attack surface on top of an SFU (str0m) that hasn't had a security
   review. Proceed now, or hold for a security pass first?
10. [x] @ mentions: typing `@` in the composer opens an autocomplete
    (filtered by guild members, or the DM's participant(s) for a DM;
    new `GET /api/guilds/:id/members` backs this) — Enter/Tab picks
    the top match, click picks any. The server independently re-parses
    `@username` occurrences against the same candidate set at message
    creation time (new `message_mentions` table, migration 0009) and
    returns `mentions: [user_id]` on the message — the client never
    just trusts whatever the composer inserted. Rendering only
    highlights `@word` spans that the server actually recorded as a
    mention (cross-referenced by id → username via the same member
    list), so typing a literal "@" that doesn't match anyone stays
    plain text. Verified via curl (mentioning a real member resolves
    to their id; a fake username resolves to no mentions) and jsdom
    (highlight renders, autocomplete filters and inserts correctly).
    Not done: an actual notification/highlight distinct from the sound
    below when *you're* mentioned outside the active channel — right
    now a mention only triggers the same sound described in item 11.
11. [x] Notification sounds: a short sound (synthesized with Web Audio,
    no audio asset to fetch or license) plays on an incoming message
    from someone else, when either the message isn't in the channel
    you're currently viewing or it mentions you. Toggle in Settings →
    Devices → Notifications, on by default, persisted in the same
    per-browser audio-prefs store as the mic/speaker settings. Not
    done: a sound specifically for someone joining a voice channel
    (there's no voice-membership broadcast to hang that off yet — see
    item 4).
12. [x] Self-DM (message yourself) + search-by-username for starting a
    DM. Backend: removed the explicit "can't DM yourself" block in
    `api/dms.rs`; a self-DM is structurally a DM channel with exactly
    *one* `dm_participants` row (its primary key is
    `(channel_id, user_id)`, so you can't insert the same user twice)
    — added `find_existing_self`/`create_self` alongside the existing
    2-participant queries, and `list_for_user`'s "other participant"
    lookup now falls back to yourself when there isn't one. New
    `GET /api/users/search?q=` (substring match on username/display
    name, `%`/`_` escaped, limit 10) backs a real search-as-you-type
    box in the "Message someone" modal — no more typing an exact
    username blind. Self shows up in results labeled "(you)". Verified
    via curl (idempotent — calling it twice returns the same channel)
    and jsdom (search box renders results live, self-DM opens as
    "You").
13. [x] Per-channel access control, first slice. New schema
    (migration 0010): `channels.created_by`/`.restricted`, plus
    `channel_members` and `channel_admins` tables. A channel can be
    marked restricted at creation (with an initial invite list, picked
    via search in the create-channel modal) — non-members don't just
    get a 403, the channel is omitted from their channel list entirely
    and direct access 404s, so they can't tell it exists. The creator
    is automatically its first admin; admins can add/remove members,
    and add/remove *other* admins (both "transfer" and "share" — there
    isn't a single-owner field to hand off, just a set anyone in it can
    grow or shrink), and only an admin (or the guild owner, who always
    has full authority over every channel) can delete it. A "Manage
    channel" gear (visible only to admins, hover-revealed in the
    sidebar) opens a roster with add/remove for both lists and a
    delete button.

    **Interpretation call, flagging in case it's not what was meant:**
    channel *creation* itself is still gated to `MANAGE_CHANNELS`
    (guild owner only, since roles/role-assignment don't exist yet) —
    I didn't open that up to arbitrary members. So "the creator is its
    admin" is real and working, but in practice today the creator is
    always the guild owner *unless* the owner explicitly shares admin
    with someone else afterward. Opening up who can create channels at
    all is a bigger, separate change I held off on since it wasn't
    unambiguous from the original ask. Also not implemented: "create
    sibling channels" — unclear what this should mean on top of the
    flat (non-hierarchical) channel model this app has, so it's not
    attempted rather than guessed at.

    Verified via curl end-to-end (created a restricted channel with one
    invited member; confirmed a non-invited guild member's channel
    list omits it and direct access 404s; confirmed the invited member
    and the guild owner can both access it; shared admin with a second
    user and had *them* delete the channel to confirm the grant
    actually works, not just that the owner retains override power)
    and jsdom (lock icon + manage button render only where expected,
    manage modal loads the real roster).

## Done

### Batch 1 (this session, before batch 2 feedback)
- [x] Fixed the "General 🎤 ☎️✕" broken-looking voice status row →
  proper mic/hangup icons, red leave button styling.
- [x] Fixed composer attach/emoji icon vertical misalignment.
- [x] Modern inline-SVG icon set (`web/src/icons.ts`) replacing raw
  emoji glyphs in UI chrome — emoji stay for message content/reactions.
- [x] Local "you're speaking" indicator (pulsing ring on the mic
  button) via client-side Web Audio volume analysis on your own mic —
  **local user only**; see open item 4 for the real per-participant
  version.
- [x] Fixed misaligned header/panel top lines (sidebar vs. chat vs.
  guild rail all now line up).
- [x] Attachments render video/audio inline with native controls, not
  just images (playback itself needed the Range-support fix above too
  — see batch 2 item 3).
- [x] Expanded emoji palette (reactions 10→20, composer 30→~100).
- [x] Seeded 3 test accounts for multi-browser testing.
- [x] Bound the deployed container to `127.0.0.1` only, not the LAN —
  the app hasn't had a security review yet. **Do not re-expose to the
  LAN or the internet without being asked again.**

### From the very first round of feedback (before batch 1), for context
- [x] Visual redesign (was "looks nothing like Discord, unprofessional
  login page").
- [x] Multi-server support + DMs (was "no place for servers or
  friends").
- [x] File/image attachments, emoji reactions (was "missing usual
  chat features").
- [x] Voice chat via a str0m SFU — first slice only, see PLAN.md
  Phase 4 and open item 9 above for what's still missing.
- [ ] Audio device/volume settings — **now done** via batch 2 item 2's
  Devices settings tab (mic/speaker picker, output volume slider,
  live device switching mid-call).
- Webcam/video chat — explicitly out of scope for v1 per PLAN.md 4.5,
  revisited by open item 9 above.

## Known constraints / standing decisions

- **Local-only deployment, with one explicit exception.** The default
  is still `http://127.0.0.1:8090`, not the LAN or the internet — the
  user asked for that because the app (voice SFU especially) hasn't
  had a security review. As of batch 18 there's one deliberate,
  user-requested exception: a real deployment at
  `https://chatty.ebbemonster.dk` (via a host nginx reverse proxy) to
  test with another real person, which necessarily also means the
  voice UDP port (50000) is bound `0.0.0.0` rather than `127.0.0.1` —
  WebRTC media can't ride through the HTTP reverse proxy, so it has to
  be reachable from the internet directly for a remote peer's call to
  work at all. The HTTP app port itself stays `127.0.0.1`-only either
  way (nginx, not the app, is what's actually internet-facing). Don't
  widen either exposure further without being asked again.
- Voice chat is a "first slice" (PLAN.md Phase 4): SFU + signaling
  work, but no server-enforced mute, no NAT test matrix beyond
  same-host/TURN-relay. PLAN.md Phase 4 is the authoritative gap list.
  **Historical note, since corrected (batch 19 item 73):** for most of
  this session, voice/video never actually connected *anywhere* —
  this sandbox, and (confirmed later) the real production deployment
  — and it was wrongly attributed at the time to a sandbox-only
  limitation (this note used to say so explicitly, after a same-code
  A/B test in batch 18 showed identical behavior on the pre-session
  commit). The real cause was a one-line server bug found in batch 19
  item 73 (a wrong `destination` address on every received packet,
  making str0m's ICE agent silently discard every connectivity check —
  see that item for the full trace) that affected every environment
  identically, which is exactly why the A/B test came back
  inconclusive: both sides of it had the same bug. **Now fixed and
  verified live** (real `Connected` state, real transmitted packets) —
  treat voice/video as working pending the user's own real-call
  confirmation, not as still-unverified.
- `REACTION_EMOJI` (web/src/emoji.ts) must stay in sync with the
  server's `ALLOWED_REACTIONS` (crates/server/src/models.rs) — the
  server validates against that exact list; the client validates
  nothing for composer emoji (just text).
- Test users: `admin`/`admin1234` (owner), `alice`/`alicepass1`,
  `bob`/`bobpass123`. Re-seed script: register admin without an
  invite code, `POST /api/invites` twice as admin, register alice/bob
  with those codes. If the guild ever predates a channel-bootstrap
  change (like it did once this session), the fix is to wipe
  `data/chat.db*` + `data/secret_key` and redo this — ask the user
  first, it's a destructive action.
