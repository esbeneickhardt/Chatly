use protocol::{Id, Permissions};
use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::models::Role;

pub(super) const SELECT_ROLE: &str =
    "SELECT id, guild_id, name, color, position, permissions, hoist, mentionable FROM roles";

pub(super) fn row_to_role(row: &Row) -> rusqlite::Result<Role> {
    let id: i64 = row.get(0)?;
    let guild_id: i64 = row.get(1)?;
    let permissions: i64 = row.get(5)?;
    Ok(Role {
        id: Id::from_raw(id as u64),
        guild_id: Id::from_raw(guild_id as u64),
        name: row.get(2)?,
        color: row.get(3)?,
        position: row.get(4)?,
        permissions: Permissions::from_bits_truncate(permissions as u64),
        hoist: row.get::<_, i64>(6)? != 0,
        mentionable: row.get::<_, i64>(7)? != 0,
    })
}

/// A brand-new role always starts at position 0 (the bottom of the
/// hierarchy, alongside `@everyone`) — see `api::roles::create` for why
/// that's the safe default rather than accepting a caller-chosen
/// position up front.
pub fn create(
    conn: &Connection,
    id: Id,
    guild_id: Id,
    name: &str,
    permissions: Permissions,
) -> rusqlite::Result<Role> {
    conn.execute(
        "INSERT INTO roles (id, guild_id, name, permissions, position) VALUES (?1, ?2, ?3, ?4, 0)",
        params![id.raw() as i64, guild_id.raw() as i64, name, permissions.bits() as i64],
    )?;
    by_id(conn, id)?.ok_or(rusqlite::Error::QueryReturnedNoRows)
}

pub fn by_id(conn: &Connection, id: Id) -> rusqlite::Result<Option<Role>> {
    conn.query_row(&format!("{SELECT_ROLE} WHERE id = ?1"), params![id.raw() as i64], row_to_role)
        .optional()
}

/// Every role in the guild, including the implicit `@everyone` one —
/// ordered lowest-ranked first, matching how `position` is compared
/// elsewhere (`protocol::permissions::can_manage_role`).
pub fn list_for_guild(conn: &Connection, guild_id: Id) -> rusqlite::Result<Vec<Role>> {
    let mut stmt =
        conn.prepare_cached(&format!("{SELECT_ROLE} WHERE guild_id = ?1 ORDER BY position, id"))?;
    let rows = stmt.query_map(params![guild_id.raw() as i64], row_to_role)?;
    rows.collect()
}

#[allow(clippy::too_many_arguments)]
pub fn update(
    conn: &Connection,
    id: Id,
    name: Option<&str>,
    permissions: Option<Permissions>,
    position: Option<i64>,
    color: Option<i64>,
    hoist: Option<bool>,
    mentionable: Option<bool>,
) -> rusqlite::Result<Role> {
    if let Some(name) = name {
        conn.execute("UPDATE roles SET name = ?1 WHERE id = ?2", params![name, id.raw() as i64])?;
    }
    if let Some(permissions) = permissions {
        conn.execute(
            "UPDATE roles SET permissions = ?1 WHERE id = ?2",
            params![permissions.bits() as i64, id.raw() as i64],
        )?;
    }
    if let Some(position) = position {
        conn.execute(
            "UPDATE roles SET position = ?1 WHERE id = ?2",
            params![position, id.raw() as i64],
        )?;
    }
    if let Some(color) = color {
        conn.execute("UPDATE roles SET color = ?1 WHERE id = ?2", params![color, id.raw() as i64])?;
    }
    if let Some(hoist) = hoist {
        conn.execute(
            "UPDATE roles SET hoist = ?1 WHERE id = ?2",
            params![hoist as i64, id.raw() as i64],
        )?;
    }
    if let Some(mentionable) = mentionable {
        conn.execute(
            "UPDATE roles SET mentionable = ?1 WHERE id = ?2",
            params![mentionable as i64, id.raw() as i64],
        )?;
    }
    by_id(conn, id)?.ok_or(rusqlite::Error::QueryReturnedNoRows)
}

/// Refuses to delete the implicit `@everyone` role (`id == guild_id`)
/// — callers check this before calling, this is just the last line of
/// defense against a stray direct call ever taking down a guild's base
/// permission row.
pub fn delete(conn: &Connection, id: Id, guild_id: Id) -> rusqlite::Result<()> {
    if id == guild_id {
        return Ok(());
    }
    conn.execute("DELETE FROM roles WHERE id = ?1", params![id.raw() as i64])?;
    Ok(())
}

pub fn assign(conn: &Connection, guild_id: Id, user_id: Id, role_id: Id) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT OR IGNORE INTO member_roles (guild_id, user_id, role_id) VALUES (?1, ?2, ?3)",
        params![guild_id.raw() as i64, user_id.raw() as i64, role_id.raw() as i64],
    )?;
    Ok(())
}

pub fn unassign(conn: &Connection, guild_id: Id, user_id: Id, role_id: Id) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM member_roles WHERE guild_id = ?1 AND user_id = ?2 AND role_id = ?3",
        params![guild_id.raw() as i64, user_id.raw() as i64, role_id.raw() as i64],
    )?;
    Ok(())
}

/// The roles `user_id` has been explicitly assigned in `guild_id` —
/// *not* including the implicit `@everyone` one (see
/// `queries::guilds::everyone_permissions` for that; callers union the
/// two, matching `protocol::permissions::resolve`'s expectation that
/// `base_permissions` already includes `@everyone`).
pub fn for_member(conn: &Connection, guild_id: Id, user_id: Id) -> rusqlite::Result<Vec<Role>> {
    let mut stmt = conn.prepare_cached(&format!(
        "{SELECT_ROLE} WHERE id IN (
            SELECT role_id FROM member_roles WHERE guild_id = ?1 AND user_id = ?2
         ) ORDER BY position, id"
    ))?;
    let rows = stmt.query_map(params![guild_id.raw() as i64, user_id.raw() as i64], row_to_role)?;
    rows.collect()
}

/// The highest `position` among `user_id`'s explicitly-assigned roles,
/// or `0` (the same baseline `@everyone` sits at) if they have none —
/// the value `protocol::permissions::can_manage_role` compares a
/// target role's position against.
pub fn highest_position_for_member(
    conn: &Connection,
    guild_id: Id,
    user_id: Id,
) -> rusqlite::Result<i64> {
    conn.query_row(
        "SELECT COALESCE(MAX(r.position), 0) FROM roles r
         JOIN member_roles mr ON mr.role_id = r.id
         WHERE mr.guild_id = ?1 AND mr.user_id = ?2",
        params![guild_id.raw() as i64, user_id.raw() as i64],
        |row| row.get(0),
    )
}

pub fn set_role_overwrite(
    conn: &Connection,
    channel_id: Id,
    role_id: Id,
    allow: Permissions,
    deny: Permissions,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO channel_overwrites (channel_id, role_id, allow, deny) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT (channel_id, role_id) WHERE role_id IS NOT NULL
         DO UPDATE SET allow = excluded.allow, deny = excluded.deny",
        params![
            channel_id.raw() as i64,
            role_id.raw() as i64,
            allow.bits() as i64,
            deny.bits() as i64
        ],
    )?;
    Ok(())
}

pub fn set_member_overwrite(
    conn: &Connection,
    channel_id: Id,
    user_id: Id,
    allow: Permissions,
    deny: Permissions,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO channel_overwrites (channel_id, user_id, allow, deny) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT (channel_id, user_id) WHERE user_id IS NOT NULL
         DO UPDATE SET allow = excluded.allow, deny = excluded.deny",
        params![
            channel_id.raw() as i64,
            user_id.raw() as i64,
            allow.bits() as i64,
            deny.bits() as i64
        ],
    )?;
    Ok(())
}

pub fn clear_role_overwrite(
    conn: &Connection,
    channel_id: Id,
    role_id: Id,
) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM channel_overwrites WHERE channel_id = ?1 AND role_id = ?2",
        params![channel_id.raw() as i64, role_id.raw() as i64],
    )?;
    Ok(())
}

pub fn clear_member_overwrite(
    conn: &Connection,
    channel_id: Id,
    user_id: Id,
) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM channel_overwrites WHERE channel_id = ?1 AND user_id = ?2",
        params![channel_id.raw() as i64, user_id.raw() as i64],
    )?;
    Ok(())
}

fn overwrite_for(
    conn: &Connection,
    channel_id: Id,
    column: &str,
    target_id: Id,
) -> rusqlite::Result<Option<protocol::permissions::Overwrite>> {
    conn.query_row(
        &format!(
            "SELECT allow, deny FROM channel_overwrites WHERE channel_id = ?1 AND {column} = ?2"
        ),
        params![channel_id.raw() as i64, target_id.raw() as i64],
        |row| {
            let allow: i64 = row.get(0)?;
            let deny: i64 = row.get(1)?;
            Ok(protocol::permissions::Overwrite {
                allow: Permissions::from_bits_truncate(allow as u64),
                deny: Permissions::from_bits_truncate(deny as u64),
            })
        },
    )
    .optional()
}

/// The three overwrite inputs `protocol::permissions::resolve` needs,
/// gathered for one member viewing one channel: the `@everyone`
/// overwrite (keyed by the guild's own id, same `id == guild_id` trick
/// as the role itself), the union of overwrites for every role
/// `role_ids` names, and this specific member's own overwrite.
pub fn overwrites_for_member(
    conn: &Connection,
    channel_id: Id,
    guild_id: Id,
    role_ids: &[Id],
    user_id: Id,
) -> rusqlite::Result<(
    Option<protocol::permissions::Overwrite>,
    Vec<protocol::permissions::Overwrite>,
    Option<protocol::permissions::Overwrite>,
)> {
    let everyone = overwrite_for(conn, channel_id, "role_id", guild_id)?;
    let mut roles = Vec::with_capacity(role_ids.len());
    for role_id in role_ids {
        if let Some(ow) = overwrite_for(conn, channel_id, "role_id", *role_id)? {
            roles.push(ow);
        }
    }
    let member = overwrite_for(conn, channel_id, "user_id", user_id)?;
    Ok((everyone, roles, member))
}
