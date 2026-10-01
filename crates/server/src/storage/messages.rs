//! Messages: sending, editing, listing, searching, and reactions.
//! The contract (`MessageStore`) and its SQLite implementation live together.

use protocol::Id;

use super::queries;
use super::sqlite::SqliteStorage;
use crate::models::*;
use crate::time::now_ms;

#[async_trait::async_trait]
pub trait MessageStore: Send + Sync {
    async fn create_message(&self, msg: NewMessage) -> anyhow::Result<Message>;

    async fn get_message(&self, id: Id, viewer_id: Id) -> anyhow::Result<Option<Message>>;

    /// Full-text search: messages matching the FTS5 expression
    /// `match_query`, newest first, older than `before`, within `scope`.
    /// This only narrows by scope in SQL — the caller must still check
    /// the viewer's permission on each channel the hits are in (see
    /// `api::search`).
    async fn search_messages(
        &self,
        match_query: String,
        scope: SearchScope,
        before: Option<Id>,
        limit: i64,
        viewer_id: Id,
    ) -> anyhow::Result<Vec<Message>>;

    async fn list_messages(
        &self,
        channel_id: Id,
        window: MessageWindow,
        limit: i64,
        viewer_id: Id,
    ) -> anyhow::Result<Vec<Message>>;

    /// The channel a message belongs to — used to permission-check
    /// reaction endpoints, which only take a message id.
    async fn channel_for_message(&self, message_id: Id) -> anyhow::Result<Option<Id>>;

    async fn delete_message(&self, message_id: Id) -> anyhow::Result<()>;

    async fn edit_message(
        &self,
        message_id: Id,
        content: String,
        mentions: Vec<Id>,
        edited_at: i64,
    ) -> anyhow::Result<()>;

    async fn add_reaction(&self, message_id: Id, user_id: Id, emoji: &str) -> anyhow::Result<()>;

    async fn remove_reaction(&self, message_id: Id, user_id: Id, emoji: &str)
        -> anyhow::Result<()>;
}

#[async_trait::async_trait]
impl MessageStore for SqliteStorage {
    async fn create_message(&self, msg: NewMessage) -> anyhow::Result<Message> {
        let author_id = msg.author_id;
        self.with_conn(move |conn| {
            queries::messages::create(conn, &msg)?;
            queries::messages::by_id(conn, msg.id, author_id)
        })
        .await?
        .ok_or_else(|| anyhow::anyhow!("message vanished immediately after insert"))
    }

    async fn get_message(&self, id: Id, viewer_id: Id) -> anyhow::Result<Option<Message>> {
        self.with_conn(move |conn| queries::messages::by_id(conn, id, viewer_id)).await
    }

    async fn search_messages(
        &self,
        match_query: String,
        scope: SearchScope,
        before: Option<Id>,
        limit: i64,
        viewer_id: Id,
    ) -> anyhow::Result<Vec<Message>> {
        self.with_conn(move |conn| {
            let ids = queries::messages::search_ids(conn, &match_query, scope, before, limit)?;
            let mut messages = Vec::with_capacity(ids.len());
            for id in ids {
                if let Some(message) = queries::messages::by_id(conn, id, viewer_id)? {
                    messages.push(message);
                }
            }
            Ok(messages)
        })
        .await
    }

    async fn list_messages(
        &self,
        channel_id: Id,
        window: MessageWindow,
        limit: i64,
        viewer_id: Id,
    ) -> anyhow::Result<Vec<Message>> {
        self.with_conn(move |conn| {
            queries::messages::list_window(conn, channel_id, window, limit, viewer_id)
        })
        .await
    }

    async fn channel_for_message(&self, message_id: Id) -> anyhow::Result<Option<Id>> {
        self.with_conn(move |conn| queries::reactions::channel_for_message(conn, message_id)).await
    }

    async fn delete_message(&self, message_id: Id) -> anyhow::Result<()> {
        self.with_conn(move |conn| queries::messages::delete(conn, message_id)).await
    }

    async fn edit_message(
        &self,
        message_id: Id,
        content: String,
        mentions: Vec<Id>,
        edited_at: i64,
    ) -> anyhow::Result<()> {
        self.with_conn(move |conn| {
            queries::messages::edit(conn, message_id, &content, &mentions, edited_at)
        })
        .await
    }

    async fn add_reaction(&self, message_id: Id, user_id: Id, emoji: &str) -> anyhow::Result<()> {
        let emoji = emoji.to_string();
        let now = now_ms();
        self.with_conn(move |conn| queries::reactions::add(conn, message_id, user_id, &emoji, now))
            .await
    }

    async fn remove_reaction(
        &self,
        message_id: Id,
        user_id: Id,
        emoji: &str,
    ) -> anyhow::Result<()> {
        let emoji = emoji.to_string();
        self.with_conn(move |conn| queries::reactions::remove(conn, message_id, user_id, &emoji))
            .await
    }
}
