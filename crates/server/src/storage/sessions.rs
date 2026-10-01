//! Sessions and two-factor authentication.
//! The contract (`SessionStore`) and its SQLite implementation live together.

use protocol::Id;

use super::queries;
use super::sqlite::SqliteStorage;
use crate::models::*;
use crate::time::now_ms;

#[async_trait::async_trait]
pub trait SessionStore: Send + Sync {
    async fn create_session(&self, session: NewSession) -> anyhow::Result<Session>;

    async fn get_session_by_token_hash(
        &self,
        token_hash: &str,
        now: i64,
    ) -> anyhow::Result<Option<SessionWithUser>>;

    async fn touch_session_last_seen(&self, id: Id, now: i64) -> anyhow::Result<()>;

    async fn delete_session(&self, id: Id, user_id: Id) -> anyhow::Result<bool>;

    async fn delete_all_sessions_for_user(&self, user_id: Id) -> anyhow::Result<()>;

    async fn delete_other_sessions_for_user(
        &self,
        user_id: Id,
        except_id: Id,
    ) -> anyhow::Result<()>;

    async fn list_sessions_for_user(&self, user_id: Id) -> anyhow::Result<Vec<Session>>;

    async fn set_totp_pending(&self, user_id: Id, secret_enc: Vec<u8>) -> anyhow::Result<()>;

    async fn get_totp(&self, user_id: Id) -> anyhow::Result<Option<TotpRecord>>;

    async fn enable_totp(&self, user_id: Id, step: u64) -> anyhow::Result<()>;

    async fn disable_totp(&self, user_id: Id) -> anyhow::Result<()>;

    async fn update_totp_last_step(&self, user_id: Id, step: u64) -> anyhow::Result<()>;

    async fn replace_recovery_codes(&self, user_id: Id, hashes: Vec<String>) -> anyhow::Result<()>;

    async fn consume_recovery_code(&self, user_id: Id, code_hash: &str) -> anyhow::Result<bool>;
}

#[async_trait::async_trait]
impl SessionStore for SqliteStorage {
    async fn create_session(&self, session: NewSession) -> anyhow::Result<Session> {
        self.with_conn(move |conn| {
            queries::sessions::insert(conn, &session)?;
            Ok(Session {
                id: session.id,
                created_at: session.created_at,
                expires_at: session.expires_at,
                last_seen: session.created_at,
                user_agent: session.user_agent,
                is_current: false,
            })
        })
        .await
    }

    async fn get_session_by_token_hash(
        &self,
        token_hash: &str,
        now: i64,
    ) -> anyhow::Result<Option<SessionWithUser>> {
        let token_hash = token_hash.to_string();
        self.with_conn(move |conn| queries::sessions::by_token_hash(conn, &token_hash, now)).await
    }

    async fn touch_session_last_seen(&self, id: Id, now: i64) -> anyhow::Result<()> {
        self.with_conn(move |conn| queries::sessions::touch_last_seen(conn, id, now)).await
    }

    async fn delete_session(&self, id: Id, user_id: Id) -> anyhow::Result<bool> {
        self.with_conn(move |conn| queries::sessions::delete(conn, id, user_id)).await
    }

    async fn delete_all_sessions_for_user(&self, user_id: Id) -> anyhow::Result<()> {
        self.with_conn(move |conn| queries::sessions::delete_all_for_user(conn, user_id)).await
    }

    async fn delete_other_sessions_for_user(
        &self,
        user_id: Id,
        except_id: Id,
    ) -> anyhow::Result<()> {
        self.with_conn(move |conn| {
            queries::sessions::delete_all_for_user_except(conn, user_id, except_id)
        })
        .await
    }

    async fn list_sessions_for_user(&self, user_id: Id) -> anyhow::Result<Vec<Session>> {
        self.with_conn(move |conn| queries::sessions::list_for_user(conn, user_id)).await
    }

    async fn set_totp_pending(&self, user_id: Id, secret_enc: Vec<u8>) -> anyhow::Result<()> {
        let now = now_ms();
        self.with_conn(move |conn| queries::mfa::set_pending(conn, user_id, &secret_enc, now)).await
    }

    async fn get_totp(&self, user_id: Id) -> anyhow::Result<Option<TotpRecord>> {
        self.with_conn(move |conn| queries::mfa::get(conn, user_id)).await
    }

    async fn enable_totp(&self, user_id: Id, step: u64) -> anyhow::Result<()> {
        self.with_conn(move |conn| queries::mfa::enable(conn, user_id, step)).await
    }

    async fn disable_totp(&self, user_id: Id) -> anyhow::Result<()> {
        self.with_conn(move |conn| queries::mfa::disable(conn, user_id)).await
    }

    async fn update_totp_last_step(&self, user_id: Id, step: u64) -> anyhow::Result<()> {
        self.with_conn(move |conn| queries::mfa::update_last_step(conn, user_id, step)).await
    }

    async fn replace_recovery_codes(&self, user_id: Id, hashes: Vec<String>) -> anyhow::Result<()> {
        self.with_conn(move |conn| queries::mfa::replace_recovery_codes(conn, user_id, &hashes))
            .await
    }

    async fn consume_recovery_code(&self, user_id: Id, code_hash: &str) -> anyhow::Result<bool> {
        let code_hash = code_hash.to_string();
        self.with_conn(move |conn| queries::mfa::consume_recovery_code(conn, user_id, &code_hash))
            .await
    }
}
