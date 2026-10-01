//! Deployment-wide operations for the global admin: every account, ownership, data export.
//! The contract (`InstanceStore`) and its SQLite implementation live together.

use protocol::Id;

use super::queries;
use super::sqlite::SqliteStorage;
use crate::models::*;

#[async_trait::async_trait]
pub trait InstanceStore: Send + Sync {
    /// Every account still on the instance — deleted accounts are
    /// hard-removed (see `delete_account`), so there's nothing to flag
    /// here anymore; the instance owner's "Admin" tab (`api::admin`).
    async fn list_all_users_for_admin(&self) -> anyhow::Result<Vec<User>>;

    /// Every message `user_id` has ever authored — `GET /api/me/export`.
    async fn export_messages_for_user(&self, user_id: Id) -> anyhow::Result<Vec<ExportedMessage>>;

    /// Hands the instance-owner flag to a different account, clearing
    /// it from the current holder in the same transaction — the only
    /// way a second account can ever hold `is_owner` (see
    /// `api::auth::register`'s doc comment for how the very first one
    /// gets it). See `api::auth::transfer_ownership`.
    async fn transfer_instance_ownership(
        &self,
        current_owner_id: Id,
        new_owner_id: Id,
    ) -> anyhow::Result<()>;
}

#[async_trait::async_trait]
impl InstanceStore for SqliteStorage {
    async fn list_all_users_for_admin(&self) -> anyhow::Result<Vec<User>> {
        self.with_conn(queries::users::list_all_for_admin).await
    }

    async fn export_messages_for_user(&self, user_id: Id) -> anyhow::Result<Vec<ExportedMessage>> {
        self.with_conn(move |conn| queries::messages::list_by_author(conn, user_id)).await
    }

    async fn transfer_instance_ownership(
        &self,
        current_owner_id: Id,
        new_owner_id: Id,
    ) -> anyhow::Result<()> {
        self.with_conn(move |conn| {
            let tx = conn.unchecked_transaction()?;
            queries::users::set_owner(&tx, current_owner_id, false)?;
            queries::users::set_owner(&tx, new_owner_id, true)?;
            tx.commit()?;
            Ok(())
        })
        .await
    }
}
