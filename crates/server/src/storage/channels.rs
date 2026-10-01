//! Channels and private-channel member lists.
//! The contract (`ChannelStore`) and its SQLite implementation live together.

use protocol::Id;

use super::queries;
use super::sqlite::SqliteStorage;
use crate::models::*;

#[async_trait::async_trait]
pub trait ChannelStore: Send + Sync {
    async fn get_channel(&self, id: Id) -> anyhow::Result<Option<Channel>>;

    async fn list_channels_for_guild(&self, guild_id: Id) -> anyhow::Result<Vec<Channel>>;

    /// Like `list_channels_for_guild`, but omits restricted channels
    /// `viewer_id` can't access — used by the actual channel-list
    /// endpoint so a non-member doesn't learn a restricted channel
    /// exists at all.
    async fn list_channels_visible_to(
        &self,
        guild_id: Id,
        viewer_id: Id,
        viewer_sees_all: bool,
    ) -> anyhow::Result<Vec<Channel>>;

    #[allow(clippy::too_many_arguments)]
    async fn create_channel(
        &self,
        guild_id: Id,
        id: Id,
        name: String,
        kind: ChannelKind,
        position: i64,
        created_by: Id,
        restricted: bool,
        member_ids: Vec<Id>,
    ) -> anyhow::Result<Channel>;

    async fn delete_channel(&self, channel_id: Id) -> anyhow::Result<()>;

    async fn add_channel_member(&self, channel_id: Id, user_id: Id) -> anyhow::Result<()>;

    async fn remove_channel_member(&self, channel_id: Id, user_id: Id) -> anyhow::Result<()>;

    async fn list_channel_members(&self, channel_id: Id) -> anyhow::Result<Vec<User>>;
}

#[async_trait::async_trait]
impl ChannelStore for SqliteStorage {
    async fn get_channel(&self, id: Id) -> anyhow::Result<Option<Channel>> {
        self.with_conn(move |conn| queries::channels::by_id(conn, id)).await
    }

    async fn list_channels_for_guild(&self, guild_id: Id) -> anyhow::Result<Vec<Channel>> {
        self.with_conn(move |conn| queries::channels::list_for_guild(conn, guild_id)).await
    }

    async fn list_channels_visible_to(
        &self,
        guild_id: Id,
        viewer_id: Id,
        viewer_sees_all: bool,
    ) -> anyhow::Result<Vec<Channel>> {
        self.with_conn(move |conn| {
            queries::channels::list_for_guild_visible_to(conn, guild_id, viewer_id, viewer_sees_all)
        })
        .await
    }

    async fn create_channel(
        &self,
        guild_id: Id,
        id: Id,
        name: String,
        kind: ChannelKind,
        position: i64,
        created_by: Id,
        restricted: bool,
        member_ids: Vec<Id>,
    ) -> anyhow::Result<Channel> {
        self.with_conn(move |conn| {
            let tx = conn.unchecked_transaction()?;
            let kind_str = match kind {
                ChannelKind::Voice => "voice",
                ChannelKind::Text | ChannelKind::Category => "text",
            };
            queries::channels::create(
                &tx, id, guild_id, &name, kind_str, position, created_by, restricted,
            )?;
            // The creator can always see their own channel (if it's
            // restricted, that takes a membership row — being its
            // creator carries no other standing; who can *manage* it is
            // a server-level permission, not a per-channel one).
            if restricted {
                queries::channels::add_member(&tx, id, created_by)?;
                for user_id in &member_ids {
                    queries::channels::add_member(&tx, id, *user_id)?;
                }
            }
            let channel =
                queries::channels::by_id(&tx, id)?.ok_or(rusqlite::Error::QueryReturnedNoRows)?;
            tx.commit()?;
            Ok(channel)
        })
        .await
    }

    async fn delete_channel(&self, channel_id: Id) -> anyhow::Result<()> {
        self.with_conn(move |conn| queries::channels::delete(conn, channel_id)).await
    }

    async fn add_channel_member(&self, channel_id: Id, user_id: Id) -> anyhow::Result<()> {
        self.with_conn(move |conn| queries::channels::add_member(conn, channel_id, user_id)).await
    }

    async fn remove_channel_member(&self, channel_id: Id, user_id: Id) -> anyhow::Result<()> {
        self.with_conn(move |conn| queries::channels::remove_member(conn, channel_id, user_id))
            .await
    }

    async fn list_channel_members(&self, channel_id: Id) -> anyhow::Result<Vec<User>> {
        self.with_conn(move |conn| queries::users::list_channel_members(conn, channel_id)).await
    }
}
