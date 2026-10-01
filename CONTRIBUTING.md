# Contributing

Thanks for helping. This is a small codebase with a few firm habits;
knowing them up front saves a review round.

## Getting set up

You need Rust (the exact toolchain is pinned in `rust-toolchain.toml`),
Node 18.19+ (CI uses 20), and [`just`](https://github.com/casey/just).

```sh
just web      # build the client into web/dist
just run      # run the server, serving web/dist from disk
just test     # cargo test --workspace
just lint     # cargo fmt --check + clippy -D warnings
```

Web tooling (in `web/`): `npm run typecheck`, `npm run lint`,
`npm run format:check` (`npm run format` fixes it), `npm test`.

[docs/architecture.md](docs/architecture.md) explains how the pieces fit;
read it before a non-trivial change.

## What a change needs

CI runs all of this, and so should you before pushing:

1. `cargo fmt --all` and `cargo clippy --workspace --all-targets -- -D warnings`
2. `cargo test --workspace`
3. In `web/`: `npm run typecheck && npm run lint && npm run format:check && npm test`
4. The end-to-end suite if you touched behaviour a user sees:
   `cargo build && (cd web && npm run build && npm run e2e)`

**Tests are part of the change.** A new endpoint gets HTTP-level tests
(`crates/server/src/http_tests.rs`, using `test_support::TestApp` — it
drives the real router over a real database, so it's cheap to write).
A bug fix gets a test that fails without the fix. A behaviour users see
gets an end-to-end test in `web/e2e/`.

**Docs are part of the change.** A new route must appear in
[docs/api.md](docs/api.md) (a test enforces it), then run `just openapi` to
regenerate `docs/openapi.json` (a second test enforces that); a new gateway event in
[docs/protocol.md](docs/protocol.md); anything user-visible in
`CHANGELOG.md` under *Unreleased*.

## Conventions

- **Keep files under 600 lines** (enforced by a test; see [docs/architecture.md](docs/architecture.md#small-files-by-rule)). Split by responsibility, not by length.
- **Comments explain why**, not what. Put the *history* of a bug in the
  commit message, not the code.
- **Handlers stay thin**: parse → authorize (`api/permissions.rs`) →
  `Storage` → publish an event (after the transaction commits) → respond.
- **Permissions are checked server-side, always.** The client hiding a
  button is a convenience, never the control.
- **Migrations are append-only.** Never edit a released one; add the
  next number. A migration that rebuilds a table other tables reference
  must manage its own transaction (see `MANUAL_TRANSACTION`). Run it
  against a *copy* of a real database before shipping — never the live
  files.
- **No `unwrap()` on anything a client or the database can influence.**
  `expect("reason")` is for a real invariant, and says which.
- **Frontend**: no framework; build DOM imperatively; never recreate a
  live `<video>` element (re-parent it); pure logic goes in modules that
  can be unit-tested without a browser; shared widgets go in `ui.ts`.
- **Accessibility is not optional**: interactive elements are real
  `<button>`s/links, dialogs have roles and labels and trap focus, and
  nothing is conveyed by colour alone.

## Commits and releases

Small, focused commits with a message that says *why*. Releases are
tagged `vX.Y.Z` (matching the workspace version in `Cargo.toml`); the
release workflow builds and publishes the image and uses the matching
`CHANGELOG.md` section as the notes.

## Security issues

Please don't open a public issue — see [SECURITY.md](SECURITY.md).
