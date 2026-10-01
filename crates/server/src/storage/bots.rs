//! Bot accounts and their tokens.
//! The contract (`BotStore`) and its SQLite implementation live together.

use protocol::Id;

use super::queries;
use super::sqlite::SqliteStorage;
use crate::models::*;
use crate::time::now_ms;

#[async_trait::async_trait]
pub trait BotStore: Send + Sync {
    /// Creates a bot account, adds it to `guild_id` as a member, and
    /// stores its (already-hashed) bearer token — all in one
    /// transaction. See `api::bots`.
    async fn create_bot(&self, new_bot: NewBot) -> anyhow::Result<User>;

    /// Resolves a bot's bearer token straight to its `User` — the bot
    /// equivalent of resolving a session cookie.
    async fn get_user_by_bot_token(&self, token_hash: &str) -> anyhow::Result<Option<User>>;

    async fn list_bots_for_guild(&self, guild_id: Id) -> anyhow::Result<Vec<User>>;

    /// Revokes a bot's token (it can no longer authenticate) without
    /// touching the account itself — the guild owner can still remove
    /// it as a member separately, or leave the now-inert account in
    /// place.
    async fn revoke_bot_token(&self, bot_id: Id) -> anyhow::Result<bool>;
}

#[async_trait::async_trait]
impl BotStore for SqliteStorage {
    async fn create_bot(&self, new_bot: NewBot) -> anyhow::Result<User> {
        self.with_conn(move |conn| {
            let tx = conn.unchecked_transaction()?;
            queries::users::insert(
                &tx,
                &NewUser {
                    id: new_bot.bot_id,
                    username: new_bot.username,
                    display_name: new_bot.display_name,
                    password_hash: new_bot.password_hash,
                    is_owner: false,
                    is_bot: true,
                },
            )?;
            queries::guilds::add_member(&tx, new_bot.guild_id, new_bot.bot_id, now_ms())?;
            queries::bot_tokens::insert(
                &tx,
                &new_bot.token_hash,
                new_bot.bot_id,
                new_bot.created_by,
                now_ms(),
            )?;
            let user = queries::users::by_id(&tx, new_bot.bot_id)?
                .ok_or(rusqlite::Error::QueryReturnedNoRows)?;
            tx.commit()?;
            Ok(user)
        })
        .await
    }

    async fn get_user_by_bot_token(&self, token_hash: &str) -> anyhow::Result<Option<User>> {
        let token_hash = token_hash.to_string();
        self.with_conn(move |conn| {
            let Some(user_id) = queries::bot_tokens::user_id_for_token(conn, &token_hash)? else {
                return Ok(None);
            };
            queries::users::by_id(conn, user_id)
        })
        .await
    }

    async fn list_bots_for_guild(&self, guild_id: Id) -> anyhow::Result<Vec<User>> {
        self.with_conn(move |conn| queries::users::list_bots_for_guild(conn, guild_id)).await
    }

    async fn revoke_bot_token(&self, bot_id: Id) -> anyhow::Result<bool> {
        self.with_conn(move |conn| queries::bot_tokens::revoke(conn, bot_id)).await
    }
}
