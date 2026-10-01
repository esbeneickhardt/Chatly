-- A self-DM ("note to self") and a real 1:1 whose other side has since
-- had their account hard-deleted (see UX_FEEDBACK.md's entry on
-- removing the "Deleted User" tombstone entirely) used to be
-- structurally identical: both are just a channel with exactly one
-- `dm_participants` row. `find_existing_self`/`list_for_user` relied
-- on that count to tell them apart — which broke the moment account
-- deletion started actually removing the `users` row instead of
-- neutralizing it in place, since a real 1:1 can now *become*
-- exactly that same shape.
--
-- An explicit flag, set only by `create_self` (the one place a self-DM
-- is ever created), makes the two cases distinguishable regardless of
-- how many `dm_participants` rows either one currently has. The
-- backfill is safe precisely because this ships alongside the
-- hard-delete change: no 1:1 DM has lost a participant to a hard
-- delete yet on any existing database, so "exactly one participant
-- today" still reliably means "always was a self-DM" one last time.
ALTER TABLE channels ADD COLUMN is_self_dm INTEGER NOT NULL DEFAULT 0;

UPDATE channels SET is_self_dm = 1 WHERE guild_id IS NULL AND id IN (
    SELECT channel_id FROM dm_participants GROUP BY channel_id HAVING COUNT(*) = 1
);
