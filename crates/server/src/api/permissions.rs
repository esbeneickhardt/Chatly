use protocol::{Id, Permissions};

use super::error::{AppError, AppResult};
use crate::gateway::DispatchEvent;
use crate::models::{Channel, Guild, Message};
use crate::state::SharedState;

/// The member's role-derived base permissions in `guild_id` — the
/// union of the implicit `@everyone` role and every role they've been
/// explicitly assigned (`protocol::permissions::resolve` expects this
/// already unioned together before it ever sees overwrites) — plus
/// those same assigned roles' own ids, so a channel-scoped caller can
/// look up overwrites for them without a second round trip.
async fn member_base_permissions(
    state: &SharedState,
    guild_id: Id,
    user_id: Id,
) -> AppResult<(Permissions, Vec<Id>)> {
    let everyone =
        state.storage.everyone_permissions(guild_id).await?.unwrap_or(Permissions::empty());
    let roles = state.storage.member_roles(guild_id, user_id).await?;
    let base = roles.iter().fold(everyone, |acc, role| acc | role.permissions);
    let role_ids = roles.into_iter().map(|r| r.id).collect();
    Ok((base, role_ids))
}

/// Resolves what `user_id` can do in `guild`, optionally narrowed to
/// one `channel_id`'s own overwrites (`None` for a guild-level check
/// with no specific channel in play, e.g. `CREATE_INVITE`).
async fn resolve_permissions(
    state: &SharedState,
    user_id: Id,
    guild: &Guild,
    channel_id: Option<Id>,
) -> AppResult<Permissions> {
    if !state.storage.is_guild_member(guild.id, user_id).await? {
        return Err(AppError::forbidden("forbidden", "not a member of this guild"));
    }
    let (base, role_ids) = member_base_permissions(state, guild.id, user_id).await?;

    let (everyone_ow, role_ows, member_ow) = match channel_id {
        Some(channel_id) => {
            state
                .storage
                .channel_overwrites_for_member(channel_id, guild.id, &role_ids, user_id)
                .await?
        }
        None => (None, Vec::new(), None),
    };

    Ok(protocol::permissions::resolve(
        guild.owner_id == user_id,
        base,
        everyone_ow,
        &role_ows,
        member_ow,
    ))
}

/// Fills in the per-viewer `can_manage` / `can_moderate` flags on a
/// guild's channel list — what the client uses to decide whether to
/// offer "manage channel" and "delete this message" at all (the server
/// re-checks on every actual request; these only drive the UI).
pub async fn annotate_channels(
    state: &SharedState,
    user_id: Id,
    guild: &Guild,
    channels: &mut [Channel],
) -> AppResult<()> {
    let can_manage = resolve_permissions(state, user_id, guild, None)
        .await?
        .contains(Permissions::MANAGE_CHANNELS);
    for channel in channels {
        channel.can_manage = can_manage;
        channel.can_moderate = resolve_permissions(state, user_id, guild, Some(channel.id))
            .await?
            .contains(Permissions::MANAGE_MESSAGES);
    }
    Ok(())
}

/// Guards against a `MANAGE_ROLES` holder handing out (via a role's
/// permissions, or a channel overwrite's `allow` bits) a permission
/// they don't themselves hold — matches Discord's own rule that you
/// can only ever grant what you already have. The guild owner (and
/// anyone with `ADMINISTRATOR`) bypasses this, same as every other
/// permission check.
pub fn ensure_can_grant(
    actor_is_owner: bool,
    actor_perms: Permissions,
    granting: Permissions,
) -> AppResult<()> {
    if actor_is_owner
        || actor_perms.contains(Permissions::ADMINISTRATOR)
        || actor_perms.contains(granting)
    {
        Ok(())
    } else {
        Err(AppError::forbidden(
            "cannot_grant",
            "you can't grant a permission you don't have yourself",
        ))
    }
}

/// Guards against editing/deleting/assigning a role at or above the
/// actor's own highest role — see
/// `protocol::permissions::can_manage_role`. The guild owner bypasses
/// this (they have no "highest role" to be outranked by).
pub async fn ensure_can_manage_role(
    state: &SharedState,
    actor_is_owner: bool,
    guild_id: Id,
    user_id: Id,
    target_position: i64,
) -> AppResult<()> {
    if actor_is_owner {
        return Ok(());
    }
    let actor_highest = state.storage.highest_role_position(guild_id, user_id).await?;
    if protocol::permissions::can_manage_role(actor_highest, target_position) {
        Ok(())
    } else {
        Err(AppError::forbidden(
            "role_hierarchy",
            "you can't manage a role at or above your own highest role",
        ))
    }
}

/// The actor's own fully-resolved guild-level permissions — for
/// `api::roles` to check a grant against everything the actor
/// themselves holds (see `ensure_can_grant`), not just a single
/// `needed` bit the way `require_guild_permission` checks.
pub async fn guild_permissions_for(
    state: &SharedState,
    user_id: Id,
    guild_id: Id,
) -> AppResult<Permissions> {
    let guild = state
        .storage
        .get_guild(guild_id)
        .await?
        .ok_or_else(|| AppError::not_found("not_found", "guild not found"))?;
    resolve_permissions(state, user_id, &guild, None).await
}

pub async fn require_guild_permission(
    state: &SharedState,
    user_id: Id,
    guild_id: Id,
    needed: Permissions,
) -> AppResult<Guild> {
    let guild = state
        .storage
        .get_guild(guild_id)
        .await?
        .ok_or_else(|| AppError::not_found("not_found", "guild not found"))?;
    let perms = resolve_permissions(state, user_id, &guild, None).await?;
    if !perms.contains(needed) {
        return Err(AppError::forbidden("forbidden", "missing permission for this guild"));
    }
    Ok(guild)
}

/// DMs have no roles or overwrites — any participant can view and send.
/// `needed` is accepted (rather than ignored) so call sites stay uniform
/// with the guild-channel path and don't need to know which kind of
/// channel they're touching.
pub async fn require_channel_permission(
    state: &SharedState,
    user_id: Id,
    channel_id: Id,
    needed: Permissions,
) -> AppResult<Channel> {
    let facts = state
        .storage
        .channel_access_facts(channel_id, user_id)
        .await?
        .ok_or_else(|| AppError::not_found("not_found", "channel not found"))?;

    let Some(guild) = &facts.guild else {
        if !facts.is_member {
            return Err(AppError::forbidden("forbidden", "not a participant in this conversation"));
        }
        return Ok(facts.channel);
    };
    if !facts.is_member {
        return Err(AppError::forbidden("forbidden", "not a member of this guild"));
    }
    let (everyone_ow, role_ows, member_ow) = &facts.overwrites;
    let perms = protocol::permissions::resolve(
        guild.owner_id == user_id,
        facts.base,
        *everyone_ow,
        role_ows,
        *member_ow,
    );
    if !perms.contains(needed) {
        return Err(AppError::forbidden("forbidden", "missing permission for this channel"));
    }
    // A restricted channel needs explicit access on top of the ordinary
    // guild permission check — a server admin (the owner, or anyone with
    // `ADMINISTRATOR`, which `resolve` reports as every permission) always
    // has it; anyone else needs a channel_members row. Not found (not
    // forbidden): a non-member shouldn't learn the channel exists at all.
    if facts.channel.restricted
        && !perms.contains(Permissions::ADMINISTRATOR)
        && !facts.has_restricted_access
    {
        return Err(AppError::not_found("not_found", "channel not found"));
    }
    Ok(facts.channel)
}

/// Requires `user_id` to be able to manage `channel_id` itself (delete
/// it, edit who's on its member list): the server-level
/// `MANAGE_CHANNELS` permission, which the owner and any server admin
/// hold implicitly. There is no per-channel admin — administration
/// lives at the server level (roles) and the instance level (the
/// global admin), never on an individual channel.
pub async fn require_channel_manager(
    state: &SharedState,
    user_id: Id,
    channel_id: Id,
) -> AppResult<Channel> {
    let channel = state
        .storage
        .get_channel(channel_id)
        .await?
        .ok_or_else(|| AppError::not_found("not_found", "channel not found"))?;
    let Some(guild_id) = channel.guild_id else {
        return Err(AppError::bad_request("invalid_channel", "DM channels have no admin"));
    };
    require_guild_permission(state, user_id, guild_id, Permissions::MANAGE_CHANNELS).await?;
    Ok(channel)
}

/// Which gateway "room" a channel's events fan out under: guild
/// channels use their guild's id (everyone in the guild subscribes to
/// that); DM channels have no guild, so they use their own channel id
/// (only the gateway subscribes participants to that).
pub fn broadcast_room(channel: &Channel) -> Id {
    channel.guild_id.unwrap_or(channel.id)
}

/// Whether `user_id` can moderate (delete) any message in `channel` —
/// not just their own: the `MANAGE_MESSAGES` permission as resolved for
/// this channel (so a channel overwrite can grant or withhold it), which
/// the owner and any server admin hold implicitly. DM channels have no
/// moderators beyond the author.
pub async fn can_moderate_channel(
    state: &SharedState,
    user_id: Id,
    channel: &Channel,
) -> AppResult<bool> {
    let Some(guild_id) = channel.guild_id else {
        return Ok(false);
    };
    let guild = state
        .storage
        .get_guild(guild_id)
        .await?
        .ok_or_else(|| AppError::internal("channel references a missing guild"))?;
    let perms = resolve_permissions(state, user_id, &guild, Some(channel.id)).await?;
    Ok(perms.contains(Permissions::MANAGE_MESSAGES))
}

/// Re-fetches a message (as seen by `viewer_id`) and re-publishes it as
/// a `MessageUpdate` — the shared tail end of "mutate a message, then
/// tell everyone its current state" (reactions, edits).
pub async fn broadcast_updated_message(
    state: &SharedState,
    message_id: Id,
    viewer_id: Id,
) -> AppResult<Message> {
    let message = state
        .storage
        .get_message(message_id, viewer_id)
        .await?
        .ok_or_else(|| AppError::internal("message vanished while updating it"))?;
    let channel = state
        .storage
        .get_channel(message.channel_id)
        .await?
        .ok_or_else(|| AppError::internal("message references a missing channel"))?;
    state.gateway.publish(broadcast_room(&channel), DispatchEvent::MessageUpdate(message.clone()));
    Ok(message)
}
