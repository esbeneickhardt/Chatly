# Security

## Reporting a vulnerability

Please report suspected vulnerabilities **privately** to the maintainer
(Esben Eickhardt, esbeneickhardt@gmail.com) rather than in a public
issue. Include what you found, how to reproduce it, and the version
(`/healthz` reports it). You'll get an acknowledgement within a few days;
please give a reasonable window to fix before disclosing.

## Supported versions

Only the latest release is supported. Chatly is a single-binary,
self-hosted application: upgrading is `git pull` and a rebuild, and
migrations run automatically (see [docs/admin.md](docs/admin.md)).

## What the design protects

- **Passwords** are hashed with Argon2id; only hashes are stored.
- **Sessions** are random 256-bit tokens in an `HttpOnly`, `Secure`,
  `SameSite=Lax` cookie; only their hashes are stored, and they can be
  listed and revoked per device.
- **MFA**: TOTP (RFC 6238) with single-use recovery codes; TOTP secrets
  are encrypted at rest with `SECRET_KEY`.
- **CSRF**: every mutating request needs an `X-Requested-With` header,
  which a cross-site request can't add without a CORS preflight.
- **Browser hardening**: a strict Content-Security-Policy, `nosniff`,
  frame denial, a referrer policy and HSTS on every response.
- **Injection**: all SQL is parameterized; message text is rendered by
  building DOM nodes, never by assigning HTML (covered by tests).
- **Authorization** is enforced server-side on every request, never by
  what the UI shows. There are two administration levels — the *global
  admin* for the deployment and a *server admin* per server — and they
  are deliberately separate (see
  [docs/architecture.md](docs/architecture.md#authorization-model)).
  Private channels answer 404, not 403, so their existence isn't leaked.
- **Abuse limits**: per-IP and per-username rate limits on login,
  registration and MFA; bot tokens can't touch account management.
- **Supply chain**: dependencies are pinned by lockfile, audited weekly
  (`cargo audit`, `npm audit`) and by Dependabot; the release image is
  scanned in CI.

## Deliberate exposures

- The **voice UDP port** (default 50000) is reachable from the internet —
  media can't go through an HTTP reverse proxy. It only carries
  ICE-authenticated, DTLS-SRTP-encrypted media.
- The HTTP port is meant to be bound to localhost and fronted by a
  reverse proxy that terminates TLS.

## Not provided

- **End-to-end encryption.** The server can read messages; TLS protects
  them in transit and disk encryption is your responsibility at rest.
- Instance-wide presence is visible to every signed-in user (a deliberate
  trade for a self-hosted community where everyone already knows each
  other).
