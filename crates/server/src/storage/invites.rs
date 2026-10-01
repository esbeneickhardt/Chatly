//! Invites: creating, previewing, redeeming and revoking.
//! The contract (`InviteStore`) and its SQLite implementation live together.

use protocol::Id;

use super::queries;
use super::sqlite::SqliteStorage;
use crate::models::*;
use crate::time::now_ms;

#[async_trait::async_trait]
pub trait InviteStore: Send + Sync {
    /// Whether `code` is currently valid and, if so, whether it leads
    /// to a DM — read-only, doesn't touch the invite's use count. See
    /// `InvitePreview`.
    async fn preview_invite(&self, code: &str) -> anyhow::Result<InvitePreview>;

    /// The equivalent of `register_with_invite` for someone who
    /// already has an account — grants the same destination-implied
    /// access, without creating a user. Idempotent: redeeming a code
    /// you're already covered by just reports the same destination
    /// back rather than erroring.
    async fn redeem_invite(&self, code: &str, user_id: Id) -> anyhow::Result<RedeemOutcome>;

    async fn create_invite(&self, invite: NewInvite) -> anyhow::Result<Invite>;

    async fn list_invites(&self) -> anyhow::Result<Vec<Invite>>;

    async fn revoke_invite(&self, id: Id) -> anyhow::Result<bool>;
}

#[async_trait::async_trait]
impl InviteStore for SqliteStorage {
    async fn preview_invite(&self, code: &str) -> anyhow::Result<InvitePreview> {
        let code = code.to_string();
        self.with_conn(move |conn| {
            let Some(invite) = queries::invites::by_code(conn, &code)? else {
                return Ok(InvitePreview { valid: false, is_dm: false });
            };
            let valid = !invite.revoked
                && !invite.expires_at.is_some_and(|exp| exp <= now_ms())
                && !invite.max_uses.is_some_and(|max| invite.uses >= max);
            let is_dm = match invite.channel_id {
                Some(channel_id) => queries::channels::by_id(conn, channel_id)?
                    .is_some_and(|c| c.guild_id.is_none()),
                None => false,
            };
            Ok(InvitePreview { valid, is_dm })
        })
        .await
    }

    async fn redeem_invite(&self, code: &str, user_id: Id) -> anyhow::Result<RedeemOutcome> {
        let code = code.to_string();
        self.with_conn(move |conn| {
            let tx = conn.unchecked_transaction()?;

            let Some(invite) = queries::invites::by_code(&tx, &code)? else {
                return Ok(RedeemOutcome::InvalidInvite);
            };
            if invite.revoked {
                return Ok(RedeemOutcome::InvalidInvite);
            }
            if invite.expires_at.is_some_and(|exp| exp <= now_ms()) {
                return Ok(RedeemOutcome::InvalidInvite);
            }
            if invite.max_uses.is_some_and(|max| invite.uses >= max) {
                return Ok(RedeemOutcome::InvalidInvite);
            }

            let destination_channel = match invite.channel_id {
                Some(channel_id) => queries::channels::by_id(&tx, channel_id)?,
                None => None,
            };
            if let Some(channel) = &destination_channel {
                if channel.guild_id.is_none()
                    && !queries::dms::is_participant(&tx, channel.id, user_id)?
                    && queries::dms::participant_count(&tx, channel.id)? as usize
                        >= MAX_GROUP_DM_PARTICIPANTS
                {
                    return Ok(RedeemOutcome::DmFull);
                }
            }

            queries::invites::increment_use(&tx, invite.id)?;

            let (channel_id, guild_id) = match destination_channel {
                Some(channel) => {
                    match channel.guild_id {
                        Some(guild_id) => {
                            queries::guilds::add_member(&tx, guild_id, user_id, now_ms())?
                        }
                        None => queries::dms::add_participant(&tx, channel.id, user_id)?,
                    }
                    (Some(channel.id), channel.guild_id)
                }
                None => {
                    if let Some(guild_id) = queries::guilds::first_guild_id(&tx)? {
                        queries::guilds::add_member(&tx, guild_id, user_id, now_ms())?;
                    }
                    (None, None)
                }
            };

            tx.commit()?;
            Ok(RedeemOutcome::Ok { channel_id, guild_id })
        })
        .await
    }

    async fn create_invite(&self, invite: NewInvite) -> anyhow::Result<Invite> {
        self.with_conn(move |conn| {
            queries::invites::insert(conn, &invite)?;
            Ok(Invite {
                id: invite.id,
                code: invite.code,
                created_by: invite.created_by,
                created_at: invite.created_at,
                expires_at: invite.expires_at,
                max_uses: invite.max_uses,
                uses: 0,
                revoked: false,
                channel_id: invite.channel_id,
            })
        })
        .await
    }

    async fn list_invites(&self) -> anyhow::Result<Vec<Invite>> {
        self.with_conn(queries::invites::list).await
    }

    async fn revoke_invite(&self, id: Id) -> anyhow::Result<bool> {
        self.with_conn(move |conn| queries::invites::revoke(conn, id)).await
    }
}
