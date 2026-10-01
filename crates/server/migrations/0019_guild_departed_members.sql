-- Backs the "leave a server" choice (see UX_FEEDBACK.md): leaving on
-- your own terms is different from having your whole account
-- hard-deleted (which now erases everything, everywhere — see
-- 0018's own migration and that batch's UX_FEEDBACK entry). Leaving
-- one server shouldn't have to mean either "wipe every message I ever
-- sent here" or "leave them exactly as if I were still a member" —
-- this is the middle option: your real account is completely
-- untouched (still logged in, still yourself in every other server
-- and DM), but messages you leave behind *in this one guild* render
-- under a generic "Former member" identity instead of your real name,
-- without ever touching the `users` row itself. Reactions have no
-- per-reactor identity exposed anywhere in this app (just an emoji +
-- count), so there's nothing to anonymize there — they just stay,
-- same as the messages they're attached to.
CREATE TABLE guild_departed_members (
    guild_id INTEGER NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    left_at  INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id)
);
