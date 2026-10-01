//! Roles, role assignments, and per-channel permission overwrites.
//! The contract (`RoleStore`) and its SQLite implementation live together.

use protocol::{Id, Permissions};

use super::queries;
use super::sqlite::SqliteStorage;
use crate::models::*;

#[async_trait::async_trait]
pub trait RoleStore: Send + Sync {
    /// Creates a new custom role — always at `position` 0 (see
    /// `queries::roles::create`'s doc comment for why). Every guild
    /// already has an implicit `@everyone` role (`id == guild_id`,
    /// created alongside the guild itself); this is for anything
    /// beyond that.
    async fn create_role(
        &self,
        id: Id,
        guild_id: Id,
        name: String,
        permissions: Permissions,
    ) -> anyhow::Result<Role>;

    async fn get_role(&self, id: Id) -> anyhow::Result<Option<Role>>;

    /// Every role in the guild, including the implicit `@everyone` one.
    async fn list_roles(&self, guild_id: Id) -> anyhow::Result<Vec<Role>>;

    #[allow(clippy::too_many_arguments)]
    async fn update_role(
        &self,
        id: Id,
        name: Option<String>,
        permissions: Option<Permissions>,
        position: Option<i64>,
        color: Option<i64>,
        hoist: Option<bool>,
        mentionable: Option<bool>,
    ) -> anyhow::Result<Role>;

    /// No-ops (rather than erroring) if `id` is the guild's own
    /// implicit `@everyone` role — see `queries::roles::delete`.
    async fn delete_role(&self, id: Id, guild_id: Id) -> anyhow::Result<()>;

    async fn assign_role(&self, guild_id: Id, user_id: Id, role_id: Id) -> anyhow::Result<()>;

    async fn unassign_role(&self, guild_id: Id, user_id: Id, role_id: Id) -> anyhow::Result<()>;

    /// `user_id`'s explicitly-assigned roles in `guild_id` — *not*
    /// including the implicit `@everyone` one (see
    /// `everyone_permissions` for that). See `api::permissions` for how
    /// the two combine.
    async fn member_roles(&self, guild_id: Id, user_id: Id) -> anyhow::Result<Vec<Role>>;

    /// The highest `position` among `user_id`'s explicitly-assigned
    /// roles, or `0` if they have none — what
    /// `protocol::permissions::can_manage_role` compares a role being
    /// created/edited/assigned/deleted against, so nobody can touch a
    /// role at or above their own highest one (the guild owner bypasses
    /// this check entirely; see `api::roles`).
    async fn highest_role_position(&self, guild_id: Id, user_id: Id) -> anyhow::Result<i64>;

    async fn set_role_overwrite(
        &self,
        channel_id: Id,
        role_id: Id,
        allow: Permissions,
        deny: Permissions,
    ) -> anyhow::Result<()>;

    async fn set_member_overwrite(
        &self,
        channel_id: Id,
        user_id: Id,
        allow: Permissions,
        deny: Permissions,
    ) -> anyhow::Result<()>;

    async fn clear_role_overwrite(&self, channel_id: Id, role_id: Id) -> anyhow::Result<()>;

    async fn clear_member_overwrite(&self, channel_id: Id, user_id: Id) -> anyhow::Result<()>;

    /// The `(everyone_overwrite, role_overwrites, member_overwrite)`
    /// triple `protocol::permissions::resolve` needs for one member
    /// viewing one channel — see `api::permissions::resolve_permissions`
    /// for the only caller.
    async fn channel_overwrites_for_member(
        &self,
        channel_id: Id,
        guild_id: Id,
        role_ids: &[Id],
        user_id: Id,
    ) -> anyhow::Result<(
        Option<protocol::permissions::Overwrite>,
        Vec<protocol::permissions::Overwrite>,
        Option<protocol::permissions::Overwrite>,
    )>;
}

#[async_trait::async_trait]
impl RoleStore for SqliteStorage {
    async fn create_role(
        &self,
        id: Id,
        guild_id: Id,
        name: String,
        permissions: Permissions,
    ) -> anyhow::Result<Role> {
        self.with_conn(move |conn| queries::roles::create(conn, id, guild_id, &name, permissions))
            .await
    }

    async fn get_role(&self, id: Id) -> anyhow::Result<Option<Role>> {
        self.with_conn(move |conn| queries::roles::by_id(conn, id)).await
    }

    async fn list_roles(&self, guild_id: Id) -> anyhow::Result<Vec<Role>> {
        self.with_conn(move |conn| queries::roles::list_for_guild(conn, guild_id)).await
    }

    async fn update_role(
        &self,
        id: Id,
        name: Option<String>,
        permissions: Option<Permissions>,
        position: Option<i64>,
        color: Option<i64>,
        hoist: Option<bool>,
        mentionable: Option<bool>,
    ) -> anyhow::Result<Role> {
        self.with_conn(move |conn| {
            queries::roles::update(
                conn,
                id,
                name.as_deref(),
                permissions,
                position,
                color,
                hoist,
                mentionable,
            )
        })
        .await
    }

    async fn delete_role(&self, id: Id, guild_id: Id) -> anyhow::Result<()> {
        self.with_conn(move |conn| queries::roles::delete(conn, id, guild_id)).await
    }

    async fn assign_role(&self, guild_id: Id, user_id: Id, role_id: Id) -> anyhow::Result<()> {
        self.with_conn(move |conn| queries::roles::assign(conn, guild_id, user_id, role_id)).await
    }

    async fn unassign_role(&self, guild_id: Id, user_id: Id, role_id: Id) -> anyhow::Result<()> {
        self.with_conn(move |conn| queries::roles::unassign(conn, guild_id, user_id, role_id)).await
    }

    async fn member_roles(&self, guild_id: Id, user_id: Id) -> anyhow::Result<Vec<Role>> {
        self.with_conn(move |conn| queries::roles::for_member(conn, guild_id, user_id)).await
    }

    async fn highest_role_position(&self, guild_id: Id, user_id: Id) -> anyhow::Result<i64> {
        self.with_conn(move |conn| {
            queries::roles::highest_position_for_member(conn, guild_id, user_id)
        })
        .await
    }

    async fn set_role_overwrite(
        &self,
        channel_id: Id,
        role_id: Id,
        allow: Permissions,
        deny: Permissions,
    ) -> anyhow::Result<()> {
        self.with_conn(move |conn| {
            queries::roles::set_role_overwrite(conn, channel_id, role_id, allow, deny)
        })
        .await
    }

    async fn set_member_overwrite(
        &self,
        channel_id: Id,
        user_id: Id,
        allow: Permissions,
        deny: Permissions,
    ) -> anyhow::Result<()> {
        self.with_conn(move |conn| {
            queries::roles::set_member_overwrite(conn, channel_id, user_id, allow, deny)
        })
        .await
    }

    async fn clear_role_overwrite(&self, channel_id: Id, role_id: Id) -> anyhow::Result<()> {
        self.with_conn(move |conn| queries::roles::clear_role_overwrite(conn, channel_id, role_id))
            .await
    }

    async fn clear_member_overwrite(&self, channel_id: Id, user_id: Id) -> anyhow::Result<()> {
        self.with_conn(move |conn| {
            queries::roles::clear_member_overwrite(conn, channel_id, user_id)
        })
        .await
    }

    async fn channel_overwrites_for_member(
        &self,
        channel_id: Id,
        guild_id: Id,
        role_ids: &[Id],
        user_id: Id,
    ) -> anyhow::Result<(
        Option<protocol::permissions::Overwrite>,
        Vec<protocol::permissions::Overwrite>,
        Option<protocol::permissions::Overwrite>,
    )> {
        let role_ids = role_ids.to_vec();
        self.with_conn(move |conn| {
            queries::roles::overwrites_for_member(conn, channel_id, guild_id, &role_ids, user_id)
        })
        .await
    }
}
