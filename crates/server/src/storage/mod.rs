mod access;
mod accounts;
mod bots;
mod channels;
mod dms;
mod files;
mod friends;
mod guilds;
mod instance;
mod invites;
mod messages;
mod migrations;
mod push;
mod queries;
mod roles;
mod sessions;
mod sqlite;

pub use sqlite::SqliteStorage;

pub use access::AccessStore;
pub use accounts::AccountStore;
pub use bots::BotStore;
pub use channels::ChannelStore;
pub use dms::DmStore;
pub use files::FileStore;
pub use friends::FriendStore;
pub use guilds::GuildStore;
pub use instance::InstanceStore;
pub use invites::InviteStore;
pub use messages::MessageStore;
pub use push::PushStore;
pub use roles::RoleStore;
pub use sessions::SessionStore;

/// Storage backend abstraction: the union of one small trait per area of
/// the data model, each defined — with its SQLite implementation — in its
/// own file. Handlers hold an `Arc<dyn Storage>` and see every method;
/// only [`SqliteStorage`] implements it for now, but keeping the contract
/// separate leaves room for another backend without touching call sites.
#[async_trait::async_trait]
pub trait Storage:
    Send
    + Sync
    + AccessStore
    + AccountStore
    + BotStore
    + ChannelStore
    + DmStore
    + FileStore
    + FriendStore
    + GuildStore
    + InstanceStore
    + InviteStore
    + MessageStore
    + PushStore
    + RoleStore
    + SessionStore
{
    /// Cheap liveness check used by `/healthz`.
    async fn health_check(&self) -> anyhow::Result<()>;
}
