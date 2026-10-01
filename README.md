# Chatly

A Discord-style text + voice server for a self-hosted community of
roughly 50–100 people. One binary, one container, one data volume. No
third-party identity providers, no telemetry, no external service
required at runtime.

See [PLAN.md](PLAN.md) for the full roadmap and current phase status,
and [docs/admin.md](docs/admin.md) for the self-hosting guide.

## What it does

- **Servers** (made with *Add Server*) with text and voice channels,
  private channels, roles and per-channel permission overrides, bots, and
  invite links; **server admins** run a server, and a single **global
  admin** runs the whole deployment (all accounts, all servers).
- **Direct messages**: 1:1, groups, friends, pinning, and calls with
  ringing — adding someone to a 1:1 starts a new group and keeps the 1:1.
- **Voice, video and screen sharing** through a built-in relay (SFU) with
  an optional TURN fallback for hard NATs.
- Markdown, LaTeX, replies, reactions, attachments, and message
  export; TOTP two-factor authentication; guest links for a quick call.
- Backup/restore and account-recovery commands (`chatly --help`).

Not included: end-to-end encryption, federation, clustering. See
[docs/admin.md](docs/admin.md#current-limitations).

## Documentation

| | |
|---|---|
| [docs/admin.md](docs/admin.md) | Run it: install, configuration, backups, recovery, reverse proxy |
| [docs/architecture.md](docs/architecture.md) | How it fits together, and the authorization model |
| [docs/api.md](docs/api.md) | Every HTTP route |
| [docs/openapi.json](docs/openapi.json) | The same routes as an OpenAPI 3 file (generated) |
| [docs/protocol.md](docs/protocol.md) | The WebSocket gateway and voice signalling |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Working on it: setup, checks, conventions |
| [SECURITY.md](SECURITY.md) | What it protects, and how to report a problem |
| [CHANGELOG.md](CHANGELOG.md) | What changed |
| [PLAN.md](PLAN.md) | The original roadmap (historical) |

## Quick start (development)

Requires Rust (stable, via [rustup](https://rustup.rs)) and Node 18+.

```sh
just web    # build the client into web/dist
just run    # cargo run, serving web/dist from disk
```

Open http://localhost:8080 (if that port's already in use on your
machine, run `LISTEN_ADDR=127.0.0.1:8090 just run` instead).

```sh
just test   # cargo test --workspace
just lint   # cargo fmt --check + clippy -D warnings
```

Web checks live in `web/` (`npm run typecheck`, `lint`, `format:check`,
`test`, and `e2e` for the browser tests); see [CONTRIBUTING.md](CONTRIBUTING.md).

## Quick start (Docker)

```sh
mkdir -p data
docker run --rm -v "$(pwd)/data:/data" busybox chown 65532:65532 /data
just up     # docker compose -f docker/docker-compose.yml up -d --build
```

Open http://localhost:8090 — the compose file publishes host port 8090
(not 8080) since 8080 is a very commonly occupied port; see
[docs/admin.md](docs/admin.md) for why the `chown` step is needed, how
to change the port, and for configuration, backups, and upgrades.

## Repository layout

```
crates/
  protocol/   shared wire types (IDs, errors, permissions) — no I/O
  server/     the binary: HTTP API, gateway, voice SFU, storage, CLI
  totp/       self-contained RFC 6238 TOTP implementation
web/          TypeScript client (Vite, no framework)
docker/       Dockerfile and docker-compose.yml
docs/         admin guide, architecture, API and protocol reference
```

## License

AGPL-3.0-or-later.
