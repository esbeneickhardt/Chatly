-- One-time cleanup for real-world residue predating the "delete every
-- 1:1 DM outright on account deletion" fix (see UX_FEEDBACK.md): a
-- handful of production 1:1 DMs were left down to a single remaining
-- `dm_participants` row (the other side's account was hard-deleted by
-- an earlier version of `delete_account` that only cascaded away
-- *their own* rows, not the whole channel) — not flagged
-- `is_self_dm` by migration 0018's backfill because, at the time that
-- ran, these particular channels hadn't degraded yet. The client had
-- no choice but to render these as a "Former member" placeholder,
-- exactly the kind of leftover identity the whole hard-delete feature
-- was meant to avoid for a 1:1. `delete_account` already prevents any
-- *new* channel from ending up in this state; this clears out
-- whatever's already in it on this database. Same reply_to-nulling
-- step `delete_account` uses, needed because `messages.reply_to` has
-- no ON DELETE clause of its own (unlike `messages.channel_id`, which
-- does cascade and handles the rest).
UPDATE messages SET reply_to = NULL WHERE reply_to IN (
    SELECT id FROM messages WHERE channel_id IN (
        SELECT c.id FROM channels c
        WHERE c.guild_id IS NULL AND c.is_self_dm = 0
        AND (SELECT COUNT(*) FROM dm_participants WHERE channel_id = c.id) < 2
    )
);

DELETE FROM channels WHERE guild_id IS NULL AND is_self_dm = 0
AND (SELECT COUNT(*) FROM dm_participants WHERE channel_id = channels.id) < 2;
