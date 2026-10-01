-- Repairs a channel that started life as somebody's private "note to
-- self" chat (`is_self_dm = 1`) but later had someone else added to it —
-- which the app used to allow (see `api::dms::add_participant`, now
-- refused). Such a channel is still flagged as a self-DM even though
-- it's shared, so `find_existing_self` kept resolving the owner's "You"
-- chat to *it* and never created a fresh private one: their own chat
-- effectively vanished into a conversation with whoever was added.
--
-- Clearing the flag turns it into what it de facto already is — an
-- ordinary conversation between the people in it, messages and all —
-- and the next DM-list fetch creates the owner a brand-new private chat
-- (`api::dms::list` always ensures one exists). Nothing is deleted and
-- nobody loses access to anything they already had.
UPDATE channels SET is_self_dm = 0
WHERE is_self_dm = 1
  AND (SELECT COUNT(*) FROM dm_participants WHERE channel_id = channels.id) > 1;
