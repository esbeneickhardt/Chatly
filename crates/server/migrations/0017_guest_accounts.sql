-- Backs "invite someone to a quick call, no signup required" (see
-- UX_FEEDBACK.md and api::invites::register_guest). A guest is an
-- ephemeral, auto-expiring `users` row — deliberately *not* a whole
-- separate parallel auth system: reusing the real session/permission
-- machinery inherits every already-verified security property that
-- machinery has (channel-scoped checks, gateway room isolation, rate
-- limits) instead of introducing an untested new code path for
-- something explicitly flagged as security-sensitive. What actually
-- keeps a guest sandboxed is that its only DM-invite destination is a
-- DM channel — a DM participant already sees nothing beyond that one
-- conversation (no guild list, no other members, nothing), a
-- guarantee this codebase already relies on elsewhere.
ALTER TABLE users ADD COLUMN is_guest INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN guest_expires_at INTEGER;
