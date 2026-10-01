//! Servers (guilds): membership, ownership, settings, and the audit log.
//! The contract (`GuildStore`) and its SQLite implementation live together.

use protocol::{Id, Permissions};

use super::queries;
use super::sqlite::{bootstrap_guild, SqliteStorage};
use crate::models::*;
use crate::time::now_ms;

#[async_trait::async_trait]
pub trait GuildStore: Send + Sync {
    async fn list_guild_members(&self, guild_id: Id) -> anyhow::Result<Vec<User>>;

    async fn get_guild(&self, id: Id) -> anyhow::Result<Option<Guild>>;

    async fn list_guilds_for_user(&self, user_id: Id) -> anyhow::Result<Vec<Guild>>;

    async fn is_guild_member(&self, guild_id: Id, user_id: Id) -> anyhow::Result<bool>;

    async fn everyone_permissions(&self, guild_id: Id) -> anyhow::Result<Option<Permissions>>;

    async fn remove_guild_member(&self, guild_id: Id, user_id: Id) -> anyhow::Result<bool>;

    /// The account holder leaving on their own terms — see
    /// `GuildLeaveMode`. Caller (`api::guilds::leave`) already checked
    /// they're a member and not the owner before this runs.
    async fn leave_guild(
        &self,
        guild_id: Id,
        user_id: Id,
        mode: GuildLeaveMode,
    ) -> anyhow::Result<()>;

    async fn update_guild(
        &self,
        id: Id,
        name: Option<String>,
        icon_file_id: Option<Id>,
    ) -> anyhow::Result<Guild>;

    async fn transfer_guild_ownership(&self, guild_id: Id, new_owner: Id) -> anyhow::Result<()>;

    /// Every guild on the instance, for the global admin's "All servers"
    /// view — see `api::admin::list_guilds`.
    async fn list_all_guilds_for_admin(&self) -> anyhow::Result<Vec<AdminGuildSummary>>;

    /// Appends an administrative action to the audit log.
    async fn record_audit(&self, entry: NewAuditEntry) -> anyhow::Result<()>;

    /// A server's log (`Some`) or the global admin's (`None`), newest
    /// first, older than `before`.
    async fn list_audit(
        &self,
        guild_id: Option<Id>,
        before: Option<Id>,
        limit: i64,
    ) -> anyhow::Result<Vec<AuditEntry>>;

    async fn delete_guild(&self, id: Id) -> anyhow::Result<()>;

    async fn set_guild_invites_open(&self, guild_id: Id, open: bool) -> anyhow::Result<()>;

    /// Creates a brand new guild owned by `owner_id`, with its
    /// `@everyone` role and a `general` text channel, and joins the
    /// owner to it — all in one transaction. Any authenticated user may
    /// create a guild (matches Discord's own model).
    async fn create_guild(
        &self,
        guild_id: Id,
        name: String,
        owner_id: Id,
        general_channel_id: Id,
        voice_channel_id: Id,
        icon_file_id: Option<Id>,
    ) -> anyhow::Result<Guild>;

    async fn guild_for_icon_file(&self, file_id: Id) -> anyhow::Result<Option<Id>>;
}

#[async_trait::async_trait]
impl GuildStore for SqliteStorage {
    async fn list_guild_members(&self, guild_id: Id) -> anyhow::Result<Vec<User>> {
        self.with_conn(move |conn| queries::users::list_for_guild(conn, guild_id)).await
    }

    async fn get_guild(&self, id: Id) -> anyhow::Result<Option<Guild>> {
        self.with_conn(move |conn| queries::guilds::by_id(conn, id)).await
    }

    async fn list_guilds_for_user(&self, user_id: Id) -> anyhow::Result<Vec<Guild>> {
        self.with_conn(move |conn| queries::guilds::list_for_user(conn, user_id)).await
    }

    async fn is_guild_member(&self, guild_id: Id, user_id: Id) -> anyhow::Result<bool> {
        self.with_conn(move |conn| queries::guilds::is_member(conn, guild_id, user_id)).await
    }

    async fn everyone_permissions(&self, guild_id: Id) -> anyhow::Result<Option<Permissions>> {
        self.with_conn(move |conn| queries::guilds::everyone_permissions(conn, guild_id)).await
    }

    async fn remove_guild_member(&self, guild_id: Id, user_id: Id) -> anyhow::Result<bool> {
        self.with_conn(move |conn| queries::guilds::remove_member(conn, guild_id, user_id)).await
    }

    async fn leave_guild(
        &self,
        guild_id: Id,
        user_id: Id,
        mode: GuildLeaveMode,
    ) -> anyhow::Result<()> {
        self.with_conn(move |conn| {
            let tx = conn.unchecked_transaction()?;
            match mode {
                GuildLeaveMode::Erase => {
                    // Same "clear the reply link first" two-step
                    // `delete_account` uses, scoped to this guild's
                    // channels instead of every channel everywhere.
                    tx.execute(
                        "UPDATE messages SET reply_to = NULL
                         WHERE reply_to IN (
                             SELECT m.id FROM messages m
                             JOIN channels c ON c.id = m.channel_id
                             WHERE c.guild_id = ?1 AND m.author_id = ?2
                         )",
                        rusqlite::params![guild_id.raw() as i64, user_id.raw() as i64],
                    )?;
                    tx.execute(
                        "DELETE FROM messages WHERE author_id = ?2 AND channel_id IN (
                             SELECT id FROM channels WHERE guild_id = ?1
                         )",
                        rusqlite::params![guild_id.raw() as i64, user_id.raw() as i64],
                    )?;
                    // Reactions *they* left on anyone else's message in
                    // this guild — reactions on their own messages are
                    // already gone via the delete above (cascade).
                    tx.execute(
                        "DELETE FROM reactions WHERE user_id = ?2 AND message_id IN (
                             SELECT id FROM messages WHERE channel_id IN (
                                 SELECT id FROM channels WHERE guild_id = ?1
                             )
                         )",
                        rusqlite::params![guild_id.raw() as i64, user_id.raw() as i64],
                    )?;
                }
                GuildLeaveMode::Anonymize => {
                    tx.execute(
                        "INSERT OR REPLACE INTO guild_departed_members (guild_id, user_id, left_at)
                         VALUES (?1, ?2, ?3)",
                        rusqlite::params![guild_id.raw() as i64, user_id.raw() as i64, now_ms()],
                    )?;
                }
            }
            tx.execute(
                "DELETE FROM members WHERE guild_id = ?1 AND user_id = ?2",
                rusqlite::params![guild_id.raw() as i64, user_id.raw() as i64],
            )?;
            tx.commit()?;
            Ok(())
        })
        .await
    }

    async fn update_guild(
        &self,
        id: Id,
        name: Option<String>,
        icon_file_id: Option<Id>,
    ) -> anyhow::Result<Guild> {
        self.with_conn(move |conn| {
            queries::guilds::update(conn, id, name.as_deref(), icon_file_id)?;
            queries::guilds::by_id(conn, id)?.ok_or(rusqlite::Error::QueryReturnedNoRows)
        })
        .await
    }

    async fn transfer_guild_ownership(&self, guild_id: Id, new_owner: Id) -> anyhow::Result<()> {
        self.with_conn(move |conn| queries::guilds::transfer_ownership(conn, guild_id, new_owner))
            .await
    }

    async fn list_all_guilds_for_admin(&self) -> anyhow::Result<Vec<AdminGuildSummary>> {
        self.with_conn(queries::guilds::list_all_for_admin).await
    }

    async fn record_audit(&self, entry: NewAuditEntry) -> anyhow::Result<()> {
        self.with_conn(move |conn| queries::audit::record(conn, &entry, now_ms())).await
    }

    async fn list_audit(
        &self,
        guild_id: Option<Id>,
        before: Option<Id>,
        limit: i64,
    ) -> anyhow::Result<Vec<AuditEntry>> {
        self.with_conn(move |conn| queries::audit::list(conn, guild_id, before, limit)).await
    }

    async fn delete_guild(&self, id: Id) -> anyhow::Result<()> {
        self.with_conn(move |conn| queries::guilds::delete(conn, id)).await
    }

    async fn set_guild_invites_open(&self, guild_id: Id, open: bool) -> anyhow::Result<()> {
        self.with_conn(move |conn| queries::guilds::set_invites_open(conn, guild_id, open)).await
    }

    async fn create_guild(
        &self,
        guild_id: Id,
        name: String,
        owner_id: Id,
        general_channel_id: Id,
        voice_channel_id: Id,
        icon_file_id: Option<Id>,
    ) -> anyhow::Result<Guild> {
        self.with_conn(move |conn| {
            let tx = conn.unchecked_transaction()?;
            bootstrap_guild(
                &tx,
                guild_id,
                &name,
                owner_id,
                general_channel_id,
                voice_channel_id,
                icon_file_id,
            )?;
            let guild = queries::guilds::by_id(&tx, guild_id)?
                .ok_or(rusqlite::Error::QueryReturnedNoRows)?;
            tx.commit()?;
            Ok(guild)
        })
        .await
    }

    async fn guild_for_icon_file(&self, file_id: Id) -> anyhow::Result<Option<Id>> {
        self.with_conn(move |conn| queries::guilds::guild_for_icon_file(conn, file_id)).await
    }
}
