use protocol::{Id, Permissions};
use rusqlite::{params, Connection, OptionalExtension};

use crate::models::{AdminGuildSummary, Guild};

pub fn create(
    conn: &Connection,
    id: Id,
    name: &str,
    owner_id: Id,
    created_at: i64,
    icon_file_id: Option<Id>,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO guilds (id, name, owner_id, created_at, icon_file_id) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            id.raw() as i64,
            name,
            owner_id.raw() as i64,
            created_at,
            icon_file_id.map(|i| i.raw() as i64)
        ],
    )?;
    Ok(())
}

/// Creates the implicit `@everyone` role (`id == guild_id`, per Discord's
/// own trick — it lets permission resolution always find a base role).
pub fn create_everyone_role(
    conn: &Connection,
    guild_id: Id,
    permissions: Permissions,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO roles (id, guild_id, name, permissions) VALUES (?1, ?1, '@everyone', ?2)",
        params![guild_id.raw() as i64, permissions.bits() as i64],
    )?;
    Ok(())
}

pub fn everyone_permissions(
    conn: &Connection,
    guild_id: Id,
) -> rusqlite::Result<Option<Permissions>> {
    conn.query_row(
        "SELECT permissions FROM roles WHERE id = ?1",
        params![guild_id.raw() as i64],
        |row| row.get::<_, i64>(0),
    )
    .optional()
    .map(|opt| opt.map(|bits| Permissions::from_bits_truncate(bits as u64)))
}

/// This is a single-guild MVP: every registrant joins the one guild the
/// owner's registration created. Multi-guild creation/joining is future
/// work (see `PLAN.md` Phase 2.4).
pub fn first_guild_id(conn: &Connection) -> rusqlite::Result<Option<Id>> {
    conn.query_row("SELECT id FROM guilds ORDER BY id LIMIT 1", [], |row| row.get::<_, i64>(0))
        .optional()
        .map(|opt| opt.map(|id| Id::from_raw(id as u64)))
}

pub fn by_id(conn: &Connection, id: Id) -> rusqlite::Result<Option<Guild>> {
    conn.query_row(
        "SELECT id, name, owner_id, created_at, icon_file_id FROM guilds WHERE id = ?1",
        params![id.raw() as i64],
        row_to_guild,
    )
    .optional()
}

/// Guilds `user_id` owns — checked before deleting their account
/// (self-service or admin-triggered): an owned guild with other
/// members needs a transfer or deletion first, since there's no
/// automatic "pick a new owner" flow (see `api::auth::delete_account`).
pub fn owned_by(conn: &Connection, user_id: Id) -> rusqlite::Result<Vec<Guild>> {
    let mut stmt = conn.prepare_cached(
        "SELECT id, name, owner_id, created_at, icon_file_id FROM guilds WHERE owner_id = ?1",
    )?;
    let rows = stmt.query_map(params![user_id.raw() as i64], row_to_guild)?;
    rows.collect()
}

pub fn list_for_user(conn: &Connection, user_id: Id) -> rusqlite::Result<Vec<Guild>> {
    let mut stmt = conn.prepare_cached(
        "SELECT g.id, g.name, g.owner_id, g.created_at, g.icon_file_id FROM guilds g
         JOIN members m ON m.guild_id = g.id WHERE m.user_id = ?1 ORDER BY g.id",
    )?;
    let rows = stmt.query_map(params![user_id.raw() as i64], row_to_guild)?;
    rows.collect()
}

/// Which guild (if any) uses this file as its icon — lets the download
/// endpoint serve icon files without a message/channel in the picture.
pub fn guild_for_icon_file(conn: &Connection, file_id: Id) -> rusqlite::Result<Option<Id>> {
    conn.query_row(
        "SELECT id FROM guilds WHERE icon_file_id = ?1",
        params![file_id.raw() as i64],
        |row| row.get::<_, i64>(0),
    )
    .optional()
    .map(|opt| opt.map(|id| Id::from_raw(id as u64)))
}

fn row_to_guild(row: &rusqlite::Row) -> rusqlite::Result<Guild> {
    let id: i64 = row.get(0)?;
    let owner_id: i64 = row.get(2)?;
    let icon_file_id: Option<i64> = row.get(4)?;
    Ok(Guild {
        id: Id::from_raw(id as u64),
        name: row.get(1)?,
        owner_id: Id::from_raw(owner_id as u64),
        created_at: row.get(3)?,
        icon_file_id: icon_file_id.map(|i| Id::from_raw(i as u64)),
        invites_open: false,
        viewer_permissions: Permissions::empty(),
    })
}

pub fn add_member(
    conn: &Connection,
    guild_id: Id,
    user_id: Id,
    joined_at: i64,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT OR IGNORE INTO members (guild_id, user_id, joined_at) VALUES (?1, ?2, ?3)",
        params![guild_id.raw() as i64, user_id.raw() as i64, joined_at],
    )?;
    Ok(())
}

pub fn is_member(conn: &Connection, guild_id: Id, user_id: Id) -> rusqlite::Result<bool> {
    conn.query_row(
        "SELECT 1 FROM members WHERE guild_id = ?1 AND user_id = ?2",
        params![guild_id.raw() as i64, user_id.raw() as i64],
        |_| Ok(()),
    )
    .optional()
    .map(|o| o.is_some())
}

pub fn remove_member(conn: &Connection, guild_id: Id, user_id: Id) -> rusqlite::Result<bool> {
    let affected = conn.execute(
        "DELETE FROM members WHERE guild_id = ?1 AND user_id = ?2",
        params![guild_id.raw() as i64, user_id.raw() as i64],
    )?;
    Ok(affected > 0)
}

pub fn update(
    conn: &Connection,
    id: Id,
    name: Option<&str>,
    icon_file_id: Option<Id>,
) -> rusqlite::Result<()> {
    if let Some(name) = name {
        conn.execute("UPDATE guilds SET name = ?1 WHERE id = ?2", params![name, id.raw() as i64])?;
    }
    if let Some(icon_file_id) = icon_file_id {
        conn.execute(
            "UPDATE guilds SET icon_file_id = ?1 WHERE id = ?2",
            params![icon_file_id.raw() as i64, id.raw() as i64],
        )?;
    }
    Ok(())
}

pub fn transfer_ownership(conn: &Connection, guild_id: Id, new_owner: Id) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE guilds SET owner_id = ?1 WHERE id = ?2",
        params![new_owner.raw() as i64, guild_id.raw() as i64],
    )?;
    Ok(())
}

pub fn delete(conn: &Connection, id: Id) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM guilds WHERE id = ?1", params![id.raw() as i64])?;
    Ok(())
}

/// Flips the @everyone role's `CREATE_INVITE` bit — the one knob this
/// MVP's single-role permission model exposes for "can anyone besides
/// the owner send invites, or just the owner." See `protocol::Permissions`
/// resolution: the owner always has every permission regardless of this.
pub fn set_invites_open(conn: &Connection, guild_id: Id, open: bool) -> rusqlite::Result<()> {
    let current = everyone_permissions(conn, guild_id)?.unwrap_or(Permissions::empty());
    let updated = if open {
        current | Permissions::CREATE_INVITE
    } else {
        current & !Permissions::CREATE_INVITE
    };
    conn.execute(
        "UPDATE roles SET permissions = ?1 WHERE id = ?2",
        params![updated.bits() as i64, guild_id.raw() as i64],
    )?;
    Ok(())
}

/// Every guild on the instance with its owner and headline counts — the
/// global admin's "All servers" view. Deliberately not scoped to the
/// caller's memberships.
pub fn list_all_for_admin(conn: &Connection) -> rusqlite::Result<Vec<AdminGuildSummary>> {
    let mut stmt = conn.prepare_cached(
        "SELECT g.id, g.name, g.icon_file_id, g.created_at,
                g.owner_id, u.username, u.display_name,
                (SELECT COUNT(*) FROM members m WHERE m.guild_id = g.id),
                (SELECT COUNT(*) FROM channels c WHERE c.guild_id = g.id AND c.kind != 'category')
         FROM guilds g JOIN users u ON u.id = g.owner_id
         ORDER BY g.created_at DESC",
    )?;
    let rows = stmt.query_map([], |row| {
        let id: i64 = row.get(0)?;
        let icon: Option<i64> = row.get(2)?;
        let owner: i64 = row.get(4)?;
        Ok(AdminGuildSummary {
            id: Id::from_raw(id as u64),
            name: row.get(1)?,
            icon_file_id: icon.map(|i| Id::from_raw(i as u64)),
            created_at: row.get(3)?,
            owner_id: Id::from_raw(owner as u64),
            owner_username: row.get(5)?,
            owner_display_name: row.get(6)?,
            member_count: row.get(7)?,
            channel_count: row.get(8)?,
        })
    })?;
    rows.collect()
}
