//! Accounts: lookup, profile, registration, password and account deletion.
//! The contract (`AccountStore`) and its SQLite implementation live together.

use protocol::Id;

use super::queries;
use super::sqlite::{bootstrap_guild, SqliteStorage};
use crate::auth::{password, token};
use crate::models::*;
use crate::time::now_ms;

#[async_trait::async_trait]
pub trait AccountStore: Send + Sync {
    async fn get_user_by_username_for_login(
        &self,
        username: &str,
    ) -> anyhow::Result<Option<UserWithPasswordHash>>;

    async fn get_user_by_id(&self, id: Id) -> anyhow::Result<Option<User>>;

    async fn get_user_by_username(&self, username: &str) -> anyhow::Result<Option<User>>;

    async fn search_users(&self, query: &str, limit: i64) -> anyhow::Result<Vec<User>>;

    /// Validates `code` exactly like `redeem_invite`, but only ever
    /// succeeds for a DM-destination invite, and creates a brand-new
    /// ephemeral guest account (`is_guest`, `guest_expires_at = now +
    /// expires_in_ms`) rather than acting for an existing one. See
    /// `api::invites::register_guest`.
    async fn register_guest(
        &self,
        code: &str,
        display_name: String,
        guest_id: Id,
        expires_in_ms: i64,
    ) -> anyhow::Result<GuestRegisterOutcome>;

    async fn set_user_avatar(&self, user_id: Id, avatar_file_id: Option<Id>) -> anyhow::Result<()>;

    async fn set_user_display_name(&self, user_id: Id, display_name: String) -> anyhow::Result<()>;

    /// `None` on success. `Some(())`... no — returns whether the
    /// requested username was already taken by someone else (checked
    /// under the same lock/transaction as the write, so this can't
    /// race a concurrent registration/rename onto the same name).
    async fn set_user_username(&self, user_id: Id, username: String) -> anyhow::Result<bool>;

    async fn set_user_password_hash(
        &self,
        user_id: Id,
        password_hash: String,
    ) -> anyhow::Result<()>;

    async fn get_password_hash(&self, user_id: Id) -> anyhow::Result<Option<String>>;

    /// Permanently erases an account: every message it ever sent is
    /// deleted outright (no anonymized "Deleted User" tombstone left
    /// behind — see `DeleteAccountOutcome`'s doc comment for exactly
    /// what this touches), and the `users` row itself is removed, not
    /// just neutralized in place. `force_guilds` bypasses the one
    /// remaining precondition (no owned guild with other members),
    /// deleting every guild the account owns outright regardless of
    /// who else is still in it — used for admin-triggered deletion
    /// always, and for self-service deletion when the account holder
    /// explicitly chose to skip transferring ownership first.
    async fn delete_account(
        &self,
        user_id: Id,
        force_guilds: bool,
    ) -> anyhow::Result<DeleteAccountOutcome>;

    /// Creates the very first account (no invite required), along with
    /// the single default guild and its `general` channel — this is a
    /// single-guild MVP (see `PLAN.md` Phase 2 notes). Returns `None` if
    /// a user already exists (checked and inserted in one transaction,
    /// so it's race-free even without an explicit lock).
    async fn register_owner(
        &self,
        new_user: NewUser,
        guild_id: Id,
        guild_name: String,
        general_channel_id: Id,
        voice_channel_id: Id,
    ) -> anyhow::Result<Option<User>>;

    /// Validates `code`, creates the user, grants whatever the invite's
    /// destination channel implies (guild membership for a guild
    /// channel, DM participancy for a DM channel, or — for a
    /// destination-less invite predating the unified invite system —
    /// membership in "the" (first) guild), and increments the invite's
    /// use count — all in one transaction.
    async fn register_with_invite(
        &self,
        code: &str,
        new_user: NewUser,
    ) -> anyhow::Result<RegisterOutcome>;
}

#[async_trait::async_trait]
impl AccountStore for SqliteStorage {
    async fn get_user_by_username_for_login(
        &self,
        username: &str,
    ) -> anyhow::Result<Option<UserWithPasswordHash>> {
        let username = username.to_string();
        self.with_conn(move |conn| queries::users::by_username_for_login(conn, &username)).await
    }

    async fn get_user_by_id(&self, id: Id) -> anyhow::Result<Option<User>> {
        self.with_conn(move |conn| queries::users::by_id(conn, id)).await
    }

    async fn get_user_by_username(&self, username: &str) -> anyhow::Result<Option<User>> {
        let username = username.to_string();
        self.with_conn(move |conn| queries::users::by_username(conn, &username)).await
    }

    async fn search_users(&self, query: &str, limit: i64) -> anyhow::Result<Vec<User>> {
        let query = query.to_string();
        self.with_conn(move |conn| queries::users::search(conn, &query, limit)).await
    }

    async fn register_guest(
        &self,
        code: &str,
        display_name: String,
        guest_id: Id,
        expires_in_ms: i64,
    ) -> anyhow::Result<GuestRegisterOutcome> {
        let code = code.to_string();
        // Computed outside `with_conn` — `password::hash` can fail for
        // reasons that have nothing to do with SQL, and that closure
        // has to return a plain `rusqlite::Result`.
        let unusable_password_hash = password::hash(&token::generate_session_token())?;
        self.with_conn(move |conn| {
            let tx = conn.unchecked_transaction()?;

            let Some(invite) = queries::invites::by_code(&tx, &code)? else {
                return Ok(GuestRegisterOutcome::InvalidInvite);
            };
            if invite.revoked {
                return Ok(GuestRegisterOutcome::InvalidInvite);
            }
            if invite.expires_at.is_some_and(|exp| exp <= now_ms()) {
                return Ok(GuestRegisterOutcome::InvalidInvite);
            }
            if invite.max_uses.is_some_and(|max| invite.uses >= max) {
                return Ok(GuestRegisterOutcome::InvalidInvite);
            }

            // No destination at all (a pre-unified-invites row) can
            // only ever mean "join the guild" — never a DM — so it's
            // rejected here the same as an explicit guild channel is.
            let Some(channel_id) = invite.channel_id else {
                return Ok(GuestRegisterOutcome::NotADmInvite);
            };
            let Some(channel) = queries::channels::by_id(&tx, channel_id)? else {
                return Ok(GuestRegisterOutcome::InvalidInvite);
            };
            if channel.guild_id.is_some() {
                return Ok(GuestRegisterOutcome::NotADmInvite);
            }
            if queries::dms::participant_count(&tx, channel.id)? as usize
                >= MAX_GROUP_DM_PARTICIPANTS
            {
                return Ok(GuestRegisterOutcome::DmFull);
            }

            queries::users::insert(
                &tx,
                &NewUser {
                    id: guest_id,
                    username: format!("guest-{}", guest_id.raw()),
                    display_name,
                    password_hash: unusable_password_hash,
                    is_owner: false,
                    is_bot: false,
                },
            )?;
            queries::users::mark_as_guest(&tx, guest_id, now_ms() + expires_in_ms)?;
            queries::dms::add_participant(&tx, channel.id, guest_id)?;
            queries::invites::increment_use(&tx, invite.id)?;

            let user = queries::users::by_id(&tx, guest_id)?
                .ok_or(rusqlite::Error::QueryReturnedNoRows)?;
            tx.commit()?;
            Ok(GuestRegisterOutcome::Ok { user, channel_id: channel.id })
        })
        .await
    }

    async fn set_user_avatar(&self, user_id: Id, avatar_file_id: Option<Id>) -> anyhow::Result<()> {
        self.with_conn(move |conn| queries::users::set_avatar(conn, user_id, avatar_file_id)).await
    }

    async fn set_user_display_name(&self, user_id: Id, display_name: String) -> anyhow::Result<()> {
        self.with_conn(move |conn| queries::users::set_display_name(conn, user_id, &display_name))
            .await
    }

    async fn set_user_username(&self, user_id: Id, username: String) -> anyhow::Result<bool> {
        self.with_conn(move |conn| {
            let tx = conn.unchecked_transaction()?;
            if let Some(existing) = queries::users::by_username(&tx, &username)? {
                if existing.id != user_id {
                    return Ok(true);
                }
            }
            queries::users::set_username(&tx, user_id, &username)?;
            tx.commit()?;
            Ok(false)
        })
        .await
    }

    async fn set_user_password_hash(
        &self,
        user_id: Id,
        password_hash: String,
    ) -> anyhow::Result<()> {
        self.with_conn(move |conn| queries::users::set_password_hash(conn, user_id, &password_hash))
            .await
    }

    async fn get_password_hash(&self, user_id: Id) -> anyhow::Result<Option<String>> {
        self.with_conn(move |conn| queries::users::password_hash_by_id(conn, user_id)).await
    }

    async fn delete_account(
        &self,
        user_id: Id,
        force_guilds: bool,
    ) -> anyhow::Result<DeleteAccountOutcome> {
        let files_dir = self.data_dir.join("files");
        self.with_conn(move |conn| {
            let tx = conn.unchecked_transaction()?;

            // The one remaining precondition, unless `force_guilds`
            // bypasses it: no automatic "pick a new owner" exists, so
            // an owned guild with anyone else still in it blocks
            // deletion until that's resolved by hand (transfer
            // ownership, or delete the guild outright — both
            // already-existing flows). A guild they own with no other
            // members is always safe to just take down with them.
            let owned = queries::guilds::owned_by(&tx, user_id)?;
            let mut blocking = Vec::new();
            for guild in owned {
                let members = queries::users::list_for_guild(&tx, guild.id)?;
                if !force_guilds && members.iter().any(|m| m.id != user_id) {
                    blocking.push(guild);
                } else {
                    queries::guilds::delete(&tx, guild.id)?;
                }
            }
            if !blocking.is_empty() {
                return Ok(DeleteAccountOutcome::OwnsGuildsWithMembers(blocking));
            }

            // Every 1:1 DM (not a self-DM, not a group) this account
            // was part of is deleted outright — channel, messages, and
            // all — rather than left behind for the other side to see
            // with nobody in it. A group DM (3+ participants) is
            // untouched here: it continues for whoever's left, with
            // just this account's own messages/reactions in it gone
            // via the unconditional erase below (see UX_FEEDBACK.md —
            // no "Former member" placeholder for a 1:1, that's a
            // leftover identity exactly like the tombstone this whole
            // feature removed).
            let one_on_one_dms: Vec<i64> = {
                let mut stmt = tx.prepare_cached(
                    "SELECT dp.channel_id FROM dm_participants dp
                     JOIN channels c ON c.id = dp.channel_id
                     WHERE dp.user_id = ?1 AND c.guild_id IS NULL AND c.is_self_dm = 0
                     AND (SELECT COUNT(*) FROM dm_participants WHERE channel_id = dp.channel_id) = 2",
                )?;
                let rows =
                    stmt.query_map(rusqlite::params![user_id.raw() as i64], |row| row.get(0))?;
                rows.collect::<rusqlite::Result<Vec<i64>>>()?
            };
            for channel_id in one_on_one_dms {
                tx.execute(
                    "UPDATE messages SET reply_to = NULL
                     WHERE reply_to IN (SELECT id FROM messages WHERE channel_id = ?1)",
                    rusqlite::params![channel_id],
                )?;
                tx.execute("DELETE FROM channels WHERE id = ?1", rusqlite::params![channel_id])?;
            }

            // Every message they ever sent elsewhere is actually
            // deleted too — there used to be an "anonymize" choice
            // that left content in place under a "Deleted User"
            // placeholder; the account holder decided that was worse
            // than just losing the message, so that choice (and the
            // placeholder itself) is gone. Clear the reply link first
            // — `messages.reply_to`
            // has no ON DELETE clause (NO ACTION), so deleting a
            // message someone else replied to would otherwise be
            // rejected outright rather than silently cascading away
            // *their* message too.
            tx.execute(
                "UPDATE messages SET reply_to = NULL
                 WHERE reply_to IN (SELECT id FROM messages WHERE author_id = ?1)",
                rusqlite::params![user_id.raw() as i64],
            )?;
            tx.execute(
                "DELETE FROM messages WHERE author_id = ?1",
                rusqlite::params![user_id.raw() as i64],
            )?;

            // Everything they ever uploaded — avatar, any guild icon
            // they set, attachments on the messages just deleted above
            // — since `files.uploader_id` is `NOT NULL` with no
            // cascade and would otherwise block deleting the row
            // below. Collected before the delete so the actual disk
            // blobs can be removed after the transaction commits,
            // rather than risking an orphaned blob if it rolled back
            // partway through.
            let file_ids: Vec<i64> = {
                let mut stmt = tx.prepare_cached("SELECT id FROM files WHERE uploader_id = ?1")?;
                let rows =
                    stmt.query_map(rusqlite::params![user_id.raw() as i64], |row| row.get(0))?;
                rows.collect::<rusqlite::Result<Vec<i64>>>()?
            };
            tx.execute(
                "DELETE FROM files WHERE uploader_id = ?1",
                rusqlite::params![user_id.raw() as i64],
            )?;

            // Two more `NOT NULL`, non-cascading references to this
            // account that would otherwise block deleting the row
            // outright: registration invites it created (gone with
            // it — nobody benefits from keeping someone else's invite
            // valid) and any bot token it issued (revoked, same as the
            // existing "Revoke token" button — the bot's own account
            // is untouched, just no longer able to authenticate).
            tx.execute(
                "DELETE FROM invites WHERE created_by = ?1",
                rusqlite::params![user_id.raw() as i64],
            )?;
            tx.execute(
                "DELETE FROM bot_tokens WHERE created_by = ?1",
                rusqlite::params![user_id.raw() as i64],
            )?;
            // `channels.created_by` is nullable and purely an audit
            // field (who made this channel) — cleared rather than
            // dragging the channel down with it, since the channel
            // obviously survives its creator's account going away.
            tx.execute(
                "UPDATE channels SET created_by = NULL WHERE created_by = ?1",
                rusqlite::params![user_id.raw() as i64],
            )?;

            queries::sessions::delete_all_for_user(&tx, user_id)?;
            queries::mfa::disable(&tx, user_id)?;
            tx.execute(
                "DELETE FROM members WHERE user_id = ?1",
                rusqlite::params![user_id.raw() as i64],
            )?;
            tx.execute(
                "DELETE FROM friendships WHERE user_a_id = ?1 OR user_b_id = ?1",
                rusqlite::params![user_id.raw() as i64],
            )?;
            tx.execute(
                "DELETE FROM friend_requests WHERE sender_id = ?1 OR recipient_id = ?1",
                rusqlite::params![user_id.raw() as i64],
            )?;

            // The row itself, not a tombstone update — every remaining
            // reference to it (guild/channel membership and admin
            // grants, reactions, mentions, DM participancy, pins/
            // hides) is `ON DELETE CASCADE` and goes with it. A DM
            // this account was part of loses them as a participant
            // rather than keeping a permanently-offline placeholder —
            // see the frontend's DM-rendering code for how it handles
            // a participant that's no longer there.
            tx.execute("DELETE FROM users WHERE id = ?1", rusqlite::params![user_id.raw() as i64])?;

            tx.commit()?;

            for id in file_ids {
                let _ = std::fs::remove_file(files_dir.join(id.to_string()));
            }

            Ok(DeleteAccountOutcome::Ok)
        })
        .await
    }

    async fn register_owner(
        &self,
        new_user: NewUser,
        guild_id: Id,
        guild_name: String,
        general_channel_id: Id,
        voice_channel_id: Id,
    ) -> anyhow::Result<Option<User>> {
        self.with_conn(move |conn| {
            let tx = conn.unchecked_transaction()?;
            if queries::users::count(&tx)? != 0 {
                return Ok(None);
            }
            queries::users::insert(&tx, &new_user)?;
            bootstrap_guild(
                &tx,
                guild_id,
                &guild_name,
                new_user.id,
                general_channel_id,
                voice_channel_id,
                None,
            )?;

            let user = queries::users::by_id(&tx, new_user.id)?;
            tx.commit()?;
            Ok(user)
        })
        .await
    }

    async fn register_with_invite(
        &self,
        code: &str,
        new_user: NewUser,
    ) -> anyhow::Result<RegisterOutcome> {
        let code = code.to_string();
        self.with_conn(move |conn| {
            let tx = conn.unchecked_transaction()?;

            let Some(invite) = queries::invites::by_code(&tx, &code)? else {
                return Ok(RegisterOutcome::InvalidInvite);
            };
            if invite.revoked {
                return Ok(RegisterOutcome::InvalidInvite);
            }
            if invite.expires_at.is_some_and(|exp| exp <= now_ms()) {
                return Ok(RegisterOutcome::InvalidInvite);
            }
            if invite.max_uses.is_some_and(|max| invite.uses >= max) {
                return Ok(RegisterOutcome::InvalidInvite);
            }
            if queries::users::by_username(&tx, &new_user.username)?.is_some() {
                return Ok(RegisterOutcome::UsernameTaken);
            }

            // A group-DM destination that's already full is checked
            // *before* inserting the new user — unlike a guild (whose
            // `add_member` is an unconditional `INSERT OR IGNORE`, so
            // there's nothing that can fail there), a full DM means
            // this invite genuinely doesn't work for them, and that
            // has to be known before creating an account, not after
            // (there's no clean way to half-succeed a registration).
            let destination_channel = match invite.channel_id {
                Some(channel_id) => queries::channels::by_id(&tx, channel_id)?,
                None => None,
            };
            if let Some(channel) = &destination_channel {
                if channel.guild_id.is_none()
                    && !queries::dms::is_participant(&tx, channel.id, new_user.id)?
                    && queries::dms::participant_count(&tx, channel.id)? as usize
                        >= MAX_GROUP_DM_PARTICIPANTS
                {
                    return Ok(RegisterOutcome::InvalidInvite);
                }
            }

            queries::users::insert(&tx, &new_user)?;
            queries::invites::increment_use(&tx, invite.id)?;

            let (channel_id, guild_id) = match destination_channel {
                Some(channel) => {
                    match channel.guild_id {
                        Some(guild_id) => {
                            queries::guilds::add_member(&tx, guild_id, new_user.id, now_ms())?
                        }
                        None => queries::dms::add_participant(&tx, channel.id, new_user.id)?,
                    }
                    (Some(channel.id), channel.guild_id)
                }
                // No destination at all (a pre-unified-invites row) or
                // a destination that was deleted since the invite was
                // created — both fall back to the original behavior:
                // join "the" (first) guild, nothing specific to land
                // on afterward.
                None => {
                    if let Some(guild_id) = queries::guilds::first_guild_id(&tx)? {
                        queries::guilds::add_member(&tx, guild_id, new_user.id, now_ms())?;
                    }
                    (None, None)
                }
            };

            let user = queries::users::by_id(&tx, new_user.id)?
                .ok_or(rusqlite::Error::QueryReturnedNoRows)?;
            tx.commit()?;
            Ok(RegisterOutcome::Ok { user, channel_id, guild_id })
        })
        .await
    }
}
