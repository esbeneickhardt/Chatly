# Self-hosting Chatly

## First run

```sh
git clone <your fork/clone of this repo>
cd chatly
mkdir -p data
docker run --rm -v "$(pwd)/data:/data" busybox chown 65532:65532 /data
printf 'TURN_SECRET=%s\n' "$(openssl rand -hex 32)" > docker/.env
docker compose -f docker/docker-compose.yml up -d --build
```

`docker/.env` holds the secret shared by the app and the `coturn` relay
(see below). It is git-ignored; keep it out of the repository.

The `chown` step matters: the container runs as a fixed non-root user
(UID/GID `65532`, the `nonroot` user baked into the distroless base
image) and the image has no shell to fix permissions itself at
startup. A freshly created `./data` directory is owned by whichever
user ran `mkdir`, which the container cannot write to until you hand
it over. You only need to do this once, before the first `up`.

The compose file publishes the container's port 8080 on host port
**8090** (`docker/docker-compose.yml`'s `ports: ["8090:8080"]`) — pick a
different host port there if 8090 is also taken on your machine; the
`PUBLIC_URL` environment variable in the same file must match whatever
you choose, since it's used for invite links, the TOTP issuer name, and
the gateway's Origin check.

Once it's running, open `http://localhost:8090` and register — the
first account created on an empty instance automatically becomes the
**global admin** (no invite needed) and gets a first server with a
`general` text channel and a `General` voice channel. Every later
registration needs an invite code, which any member of a server that
allows it can create from that server's *Invite* button.

## Who can do what

There are two levels of administrator, and they are separate:

- The **global admin** runs the whole deployment: Settings → *Global
  admin* lists **all accounts** and **all servers** (including servers
  they never joined) and can delete either, or reassign a server whose
  owner is gone. Hand the role to someone else from Settings → Danger →
  *Transfer ownership*.
- A **server admin** runs one server (what *Add Server* creates): its
  owner, plus anyone the owner or another admin promotes from *Manage
  server → Members → Make admin*. Only the owner can delete the server,
  hand it over, or demote another admin.

The global admin has no special powers *inside* a server they haven't
joined, and a server admin has none globally. See
[architecture.md](architecture.md#authorization-model).

## Configuration

All configuration is environment variables, with an optional
`config.toml` (path from `CONFIG_FILE`, default `./config.toml`)
providing defaults that environment variables override. See
`crates/server/src/config.rs` for the authoritative list:

| Env var         | Default                 | Meaning                                                |
|-----------------|-------------------------|---------------------------------------------------------|
| `LISTEN_ADDR`   | `0.0.0.0:8080`          | Address the HTTP server binds to                       |
| `DATA_DIR`      | `./data`                | Root for `chat.db` and `files/`                        |
| `LOG_LEVEL`     | `info`                  | `tracing` env-filter directive                         |
| `CONFIG_FILE`   | `./config.toml`         | Path to the optional TOML config file                  |
| `SECRET_KEY`    | generated & persisted   | Base64 32-byte key encrypting TOTP secrets at rest      |
| `PUBLIC_URL`    | `http://localhost:8080` | Used in invite links, the TOTP issuer name, and the gateway's Origin check |
| `TRUSTED_PROXY` | unset                   | IP of a reverse proxy to trust `X-Forwarded-For` from (set this in Phase 5) |
| `INSTANCE_NAME` | `Chatly`                | Shown as both the TOTP issuer and the default guild's name |
| `MAX_UPLOAD_MB` | `1024`                  | Largest file attachment accepted, in megabytes |
| `VOICE_PORT`    | `50000`                 | UDP port the voice SFU listens on |
| `VOICE_PUBLIC_IP` | unset                 | Public/LAN IP to advertise as an ICE candidate for voice; without it, the server guesses its own local IP and only same-host peers can reliably connect |
| `TURN_SECRET`   | unset                   | Shared secret with a coturn instance (its `--static-auth-secret`); without it, no TURN relay is offered — see below |
| `TURN_HOST`     | `VOICE_PUBLIC_IP`       | Host/IP clients reach the TURN server at, if different from the voice SFU's own address |
| `TURN_PORT`     | `3478`                  | Port the TURN server listens on |

If `SECRET_KEY` is left unset, one is generated on first startup and
saved to `$DATA_DIR/secret_key`. That's fine for a single long-running
instance, but if you ever restore `chat.db` onto a fresh `DATA_DIR`
without also copying `secret_key`, every enrolled user's TOTP breaks
(the encrypted secrets can't be decrypted with a different key). Set
`SECRET_KEY` explicitly and keep it in your password manager if you
want backups to be portable independent of the data directory.

`VOICE_PUBLIC_IP` matters more than it looks: voice signaling (who's
in a channel, the offer/answer exchange) always works over the
existing HTTP/WebSocket connection, but the actual audio is a
separate UDP media stream. If the address the server advertises isn't
one a peer can actually reach — e.g. it's left unset and the server
guesses a Docker-internal IP — call setup will complete but no audio
will flow. Set it to the host's LAN IP for same-network use, or a
public IP (with the UDP port forwarded on your router) for peers
outside your network.

Even with `VOICE_PUBLIC_IP` set correctly, two real peers on different
real networks can still fail to connect directly — plenty of common
NAT setups (symmetric NAT, CGNAT, common on mobile networks and some
home routers) simply can't complete a direct UDP handshake no matter
how correct the signaling is. The `coturn` service in
`docker/docker-compose.yml` is a TURN relay for exactly that case: both
read `TURN_SECRET` from `docker/.env`, so they always agree, and the app hands out short-lived TURN credentials
(`GET /api/voice/ice-servers`) the browser falls back to when a direct
connection can't be established. Without it, voice/video only works
for peers whose networks happen to traverse directly to each other.

## Data and backups

Everything lives under `DATA_DIR` (the `./data` host directory in the
default compose file):

- `chat.db`, `chat.db-wal`, `chat.db-shm` — the SQLite database (WAL mode).
- `secret_key` — only present if you didn't set `SECRET_KEY` yourself.
- `files/` — uploaded attachments and avatars.

### Backup and restore

`chatly backup` makes a transactionally consistent snapshot **while the
server is running** (it uses SQLite's `VACUUM INTO`, not a file copy):

```sh
docker compose -f docker/docker-compose.yml exec chatly \
    chatly backup /data/backups/$(date +%F)
```

The directory must be empty or not exist; it receives `chat.db`, `files/`
and `secret_key`. Copy it off the machine — a backup on the same disk
isn't one. Restore into an empty data directory, with the server stopped:

```sh
docker compose -f docker/docker-compose.yml stop chatly
docker compose -f docker/docker-compose.yml run --rm chatly \
    chatly restore /data/backups/2026-09-19 --force
docker compose -f docker/docker-compose.yml start chatly
```

Restore refuses to replace an existing database without `--force`, and
with it the old database is kept as `chat.db.before-restore`. A backup
whose database fails its integrity check is rejected. Try a restore on a
scratch directory now and then — an untested backup is a hope, not a
backup.

If you use the generated `secret_key` (rather than setting `SECRET_KEY`),
it's included in the snapshot; without it every enrolled user's TOTP
would stop working after a restore onto a fresh directory.

## Upgrades

```sh
git pull
docker compose -f docker/docker-compose.yml up -d --build
```

Schema migrations are embedded in the binary and run automatically on
startup — there is no separate migrate step. Back up `DATA_DIR` first
regardless.

## Recovery

If someone is locked out, there are commands for it (run inside the
container the same way as `backup`; they act on `DATA_DIR` directly):

```sh
# Turn off two-factor authentication for an account and sign it out everywhere
chatly admin reset-mfa <username>

# Set a new password and sign the account out everywhere.
# The new password comes from $NEW_PASSWORD, or the first line of stdin.
NEW_PASSWORD='a long new password' chatly admin reset-password <username>
```

Prefer `NEW_PASSWORD` or a pipe over typing it at the prompt, which
echoes. Use these on a locked-out global admin too — they don't need a
working login.

## Logs

The server writes one structured line per API request (method, path
*without* its query string, status, duration, and a request id) plus its own
events, to stdout — `docker compose logs chatly`. Every response carries an
`X-Request-Id` header; if your reverse proxy sets one, that id is kept, so a
single request can be followed from the proxy's log into Chatly's. Set
`LOG_LEVEL` (default `info`; `warn` to quiet it, or a `tracing` filter such
as `chatly=debug`).

### When a call will not connect

Ask the person to run **Settings → Devices → Test my connection** on the
device that fails, on the network that fails: it names the missing piece
(microphone permission, an insecure page, no voice relay, UDP blocked) in words.
On the server, `docker compose logs chatly | grep voice:` shows the other side:

| Log line | Meaning |
|---|---|
| `voice: first packet from client` (with the source address) | Their traffic reaches the server. |
| `no ICE connection after 10s and not one packet from this client has reached the server` | Nothing from that device arrives on `VOICE_PORT`: its network (or your router's port forward, or the firewall) drops UDP there. Check that UDP `VOICE_PORT` is forwarded and that `VOICE_PUBLIC_IP` is right, then that the TURN relay is reachable. |
| `no ICE connection after 10s although packets arrive from this client` | Packets arrive but the handshake does not finish: look at the client's console (`[voice]` lines). |
| `datagram matches no connection` | Something sent UDP to `VOICE_PORT` that belongs to no live call: a browser using stale credentials, or a port scan. Logged at most once per source every 30 s. |

In the browser, a call that has not connected after 20 seconds is ended with a
message, so a dead call is never left on screen.

## Current limitations

Stated plainly, so you can decide whether they matter to you:

- **Notifications need the app open.** Turning on *Settings → Devices →
  Show notifications when the app is in the background* raises a
  notification for direct messages, mentions and incoming calls while a
  Chatly tab or the installed app is open but not in front. Chatly can be
  installed as an app (browser menu → *Install*). It does **not** use Web
  Push, so nothing arrives once every Chatly window is closed; that needs a
  push service and is not built.
- **No end-to-end encryption.** The server can read messages. Use TLS
  (see below) and encrypt the disk if that matters.
- **No gateway resume.** A dropped connection reconnects and refetches
  the open conversation instead of replaying missed events. Nothing is
  lost; it's just a refetch.
- **Voice is relayed, not adaptive.** The SFU forwards what each sender
  produces and does not estimate the *receiver's* bandwidth, so a viewer
  on a weak connection can see stutter on a heavy screen share. Senders
  are capped (screen share: 4 Mbps, 30 fps) to keep that in check. If
  it's a problem for you, raise `net.core.rmem_max`/`wmem_max` on the
  host (the server logs the buffer sizes it actually got at startup) and
  see [architecture.md](architecture.md#voice-and-video).
- **Screen sharing needs a desktop browser.** Phone browsers don't
  implement it.
- **One process, one host.** Presence and fan-out are in memory; there
  is no clustering. The design target is a community of roughly 50–100.
- **The whole instance shares presence.** Every signed-in user can see
  who is online.

## Running behind a reverse proxy

Chatly speaks plain HTTP and expects a proxy (nginx, Caddy, …) to
terminate TLS. Bind it to localhost (the compose file does:
`127.0.0.1:8090`), set `PUBLIC_URL` to the public `https://` address,
set `TRUSTED_PROXY` to the proxy's IP so rate limiting sees real client
addresses, and proxy WebSocket upgrades on `/gateway`. The voice UDP port
(`VOICE_PORT`, default 50000) is **not** proxied: forward it straight to
the container.
