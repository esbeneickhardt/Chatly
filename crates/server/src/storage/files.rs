//! Uploaded files.
//! The contract (`FileStore`) and its SQLite implementation live together.

use protocol::Id;

use super::queries;
use super::sqlite::SqliteStorage;
use crate::models::*;

#[async_trait::async_trait]
pub trait FileStore: Send + Sync {
    async fn file_is_avatar(&self, file_id: Id) -> anyhow::Result<bool>;

    async fn create_file(&self, file: NewFile) -> anyhow::Result<FileMeta>;

    async fn get_file(&self, id: Id) -> anyhow::Result<Option<FileMeta>>;

    async fn file_uploader(&self, id: Id) -> anyhow::Result<Option<Id>>;

    /// The channel a file is servable through (the channel of a message
    /// it's attached to, if any) — see `queries::files::channel_for_file`.
    async fn channel_for_file(&self, file_id: Id) -> anyhow::Result<Option<Id>>;
}

#[async_trait::async_trait]
impl FileStore for SqliteStorage {
    async fn file_is_avatar(&self, file_id: Id) -> anyhow::Result<bool> {
        self.with_conn(move |conn| queries::users::is_avatar(conn, file_id)).await
    }

    async fn create_file(&self, file: NewFile) -> anyhow::Result<FileMeta> {
        self.with_conn(move |conn| {
            queries::files::create(conn, &file)?;
            queries::files::by_id(conn, file.id)
        })
        .await?
        .ok_or_else(|| anyhow::anyhow!("file vanished immediately after insert"))
    }

    async fn get_file(&self, id: Id) -> anyhow::Result<Option<FileMeta>> {
        self.with_conn(move |conn| queries::files::by_id(conn, id)).await
    }

    async fn file_uploader(&self, id: Id) -> anyhow::Result<Option<Id>> {
        self.with_conn(move |conn| queries::files::uploader_of(conn, id)).await
    }

    async fn channel_for_file(&self, file_id: Id) -> anyhow::Result<Option<Id>> {
        self.with_conn(move |conn| queries::files::channel_for_file(conn, file_id)).await
    }
}
