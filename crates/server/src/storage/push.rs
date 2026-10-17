//! Web Push subscriptions (see `crate::push`).
//! The contract (`PushStore`) and its SQLite implementation live together.

use protocol::Id;

use super::queries;
use super::sqlite::SqliteStorage;
use crate::models::PushSubscription;
use crate::time::now_ms;

#[async_trait::async_trait]
pub trait PushStore: Send + Sync {
    async fn save_push_subscription(
        &self,
        user_id: Id,
        session_id: Id,
        sub: PushSubscription,
    ) -> anyhow::Result<()>;

    /// Removes one of `user_id`'s own subscriptions; false if it wasn't theirs.
    async fn delete_push_subscription(&self, user_id: Id, endpoint: &str) -> anyhow::Result<bool>;

    /// Forgets an endpoint the push service says is gone.
    async fn forget_push_endpoint(&self, endpoint: &str) -> anyhow::Result<()>;

    async fn push_subscriptions_for(
        &self,
        user_ids: Vec<Id>,
    ) -> anyhow::Result<Vec<PushSubscription>>;
}

#[async_trait::async_trait]
impl PushStore for SqliteStorage {
    async fn save_push_subscription(
        &self,
        user_id: Id,
        session_id: Id,
        sub: PushSubscription,
    ) -> anyhow::Result<()> {
        let now = now_ms();
        self.with_conn(move |conn| queries::push::upsert(conn, user_id, session_id, &sub, now))
            .await
    }

    async fn delete_push_subscription(&self, user_id: Id, endpoint: &str) -> anyhow::Result<bool> {
        let endpoint = endpoint.to_string();
        self.with_conn(move |conn| queries::push::delete_for_user(conn, user_id, &endpoint)).await
    }

    async fn forget_push_endpoint(&self, endpoint: &str) -> anyhow::Result<()> {
        let endpoint = endpoint.to_string();
        self.with_conn(move |conn| queries::push::delete_endpoint(conn, &endpoint)).await
    }

    async fn push_subscriptions_for(
        &self,
        user_ids: Vec<Id>,
    ) -> anyhow::Result<Vec<PushSubscription>> {
        let now = now_ms();
        self.with_conn(move |conn| queries::push::for_users(conn, &user_ids, now)).await
    }
}
