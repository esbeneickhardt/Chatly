//! Everything a permission check needs about one user and one channel,
//! gathered in a single database round trip.
//!
//! The individual lookups (channel, guild, membership, roles, overwrites,
//! restricted-channel access) each cost a hop onto the blocking thread and
//! a wait for the one connection. Every message post, edit, upload and
//! history read needs all of them, so they are fetched together here and
//! `api::permissions` does the (pure) decision.

use protocol::permissions::Overwrite;
use protocol::{Id, Permissions};

use super::queries;
use super::sqlite::SqliteStorage;
use crate::models::{Channel, Guild};

/// The facts behind "may this user do X in this channel".
pub struct ChannelAccessFacts {
    pub channel: Channel,
    /// `None` for a DM, which has no server.
    pub guild: Option<Guild>,
    /// A guild member, or (for a DM) a participant.
    pub is_member: bool,
    /// `@everyone` plus every assigned role, unioned (guild channels only).
    pub base: Permissions,
    /// `(everyone, role, member)` overwrites for this channel.
    pub overwrites: (Option<Overwrite>, Vec<Overwrite>, Option<Overwrite>),
    /// Explicit access to a restricted channel (only looked up when the
    /// channel is restricted).
    pub has_restricted_access: bool,
}

#[async_trait::async_trait]
pub trait AccessStore: Send + Sync {
    /// `None` if the channel doesn't exist. A channel pointing at a
    /// missing guild is an error, as it can't happen.
    async fn channel_access_facts(
        &self,
        channel_id: Id,
        user_id: Id,
    ) -> anyhow::Result<Option<ChannelAccessFacts>>;
}

#[async_trait::async_trait]
impl AccessStore for SqliteStorage {
    async fn channel_access_facts(
        &self,
        channel_id: Id,
        user_id: Id,
    ) -> anyhow::Result<Option<ChannelAccessFacts>> {
        self.with_conn(move |conn| {
            let Some(channel) = queries::channels::by_id(conn, channel_id)? else {
                return Ok(None);
            };
            let Some(guild_id) = channel.guild_id else {
                let is_member = queries::dms::is_participant(conn, channel_id, user_id)?;
                return Ok(Some(ChannelAccessFacts {
                    channel,
                    guild: None,
                    is_member,
                    base: Permissions::empty(),
                    overwrites: (None, Vec::new(), None),
                    has_restricted_access: false,
                }));
            };
            let guild = queries::guilds::by_id(conn, guild_id)?
                .ok_or(rusqlite::Error::QueryReturnedNoRows)?;
            let is_member = queries::guilds::is_member(conn, guild_id, user_id)?;
            let everyone = queries::guilds::everyone_permissions(conn, guild_id)?
                .unwrap_or(Permissions::empty());
            let roles = queries::roles::for_member(conn, guild_id, user_id)?;
            let base = roles.iter().fold(everyone, |acc, role| acc | role.permissions);
            let role_ids: Vec<Id> = roles.into_iter().map(|r| r.id).collect();
            let overwrites = queries::roles::overwrites_for_member(
                conn, channel_id, guild_id, &role_ids, user_id,
            )?;
            let has_restricted_access = channel.restricted
                && queries::channels::can_access_restricted(conn, channel_id, user_id)?;
            Ok(Some(ChannelAccessFacts {
                channel,
                guild: Some(guild),
                is_member,
                base,
                overwrites,
                has_restricted_access,
            }))
        })
        .await
    }
}
