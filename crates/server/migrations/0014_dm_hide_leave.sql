-- Lets a user declutter their own DM list without affecting anyone
-- else's view of the conversation — two different actions for two
-- different shapes of conversation (see api::dms):
--
-- - A 1:1 (or the self-DM) can only be *hidden*, per-viewer, same
--   shape as `pinned_dms` — removing yourself from `dm_participants`
--   instead would leave a channel with exactly one participant row,
--   which is structurally indistinguishable from a self-DM (see
--   queries::dms::find_existing_self) and would corrupt the model for
--   the person left behind. Hiding is purely a read-time filter
--   (see queries::dms::list_for_user): a `hidden_at` at or after the
--   conversation's last message means "stay hidden", so a new message
--   arriving un-hides it automatically without any write-side hook
--   needed on message creation.
-- - A real group (3+ participants) can be properly *left* — removing
--   your own `dm_participants` row is safe there since at least 2
--   people remain, no self-DM ambiguity possible.
CREATE TABLE hidden_dms (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    hidden_at  INTEGER NOT NULL,
    PRIMARY KEY (user_id, channel_id)
);
