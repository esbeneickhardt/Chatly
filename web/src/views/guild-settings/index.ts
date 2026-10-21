// The server-settings modal: data loading and its pages, in the shared
// settings shell (settings/shell.ts); each page lives in its own module.

import { type Guild, type Role, type User, api } from "../../api";
import { renderAvatarEl, showNotice } from "../../ui";
import { renderAuditLog } from "../audit-log";
import { openSettingsShell, type ShellTab } from "../settings/shell";
import { renderGeneralSection } from "./general";
import { renderMembersSection } from "./members";
import { renderRolesSection } from "./roles";
import { renderDangerZone, renderLeaveServerSection } from "./danger";
import { type Abilities } from "./members";
import { parsePermissions } from "./roles";
import type { ManageServerOptions, ServerSettingsContext } from "./context";

type Tab = "general" | "members" | "roles" | "audit" | "danger" | "leave";

export function renderManageServerModal(opts: ManageServerOptions): void {
  const shell = openSettingsShell<Tab>({});
  const ctx: ServerSettingsContext = { opts, reload: () => load(), close: () => shell.close() };
  void load();

  async function load(): Promise<void> {
    try {
      const [guild, members, roles] = await Promise.all([
        api.get<Guild>(`/api/guilds/${opts.guildId}`),
        api.get<User[]>(`/api/guilds/${opts.guildId}/members`),
        api.get<Role[]>(`/api/guilds/${opts.guildId}/roles`),
      ]);
      // One request per member, in parallel — fine at the member counts
      // this app targets (see docs/admin.md); there's no bulk
      // "every assignment in the guild" endpoint (see `Storage::
      // member_roles`, which is per-member by design).
      const memberRoleLists = await Promise.all(
        members.map((m) => api.get<Role[]>(`/api/guilds/${guild.id}/members/${m.id}/roles`)),
      );
      const memberRoleIds = new Map<string, Set<string>>(
        members.map((m, i) => [m.id, new Set(memberRoleLists[i].map((r) => r.id))]),
      );
      renderBody(guild, members, roles, memberRoleIds);
    } catch {
      showNotice("Couldn't load the server settings.");
      shell.close();
    }
  }

  // Every page is built once per load and just moved into view when
  // picked (not rebuilt), so each section's own live DOM patching after
  // a save (renaming, removing a member) survives switching pages.
  function renderBody(
    guild: Guild,
    members: User[],
    roles: Role[],
    memberRoleIds: Map<string, Set<string>>,
  ): void {
    const isOwner = guild.owner_id === opts.currentUserId;
    const owner = members.find((m) => m.id === guild.owner_id) ?? null;
    // What *this viewer* can do here, from the server's own resolution
    // (owner and `ADMINISTRATOR` holders get everything) — the UI only
    // offers what the API will accept. "Server admin" means exactly:
    // the owner, or anyone with `ADMINISTRATOR`.
    const perms = parsePermissions(guild.viewer_permissions ?? "");
    const viewerIsAdmin = isOwner || perms.has("ADMINISTRATOR");
    const abilities: Abilities = {
      isOwner,
      isAdmin: viewerIsAdmin,
      canManageGuild: viewerIsAdmin || perms.has("MANAGE_GUILD"),
      canKick: viewerIsAdmin || perms.has("KICK_MEMBERS"),
    };
    const adminRoleIds = new Set(
      roles
        .filter((r) => parsePermissions(r.permissions).has("ADMINISTRATOR") && r.id !== guild.id)
        .map((r) => r.id),
    );
    const adminIds = new Set(
      members
        .filter((m) => [...(memberRoleIds.get(m.id) ?? [])].some((id) => adminRoleIds.has(id)))
        .map((m) => m.id),
    );

    shell.setIdentity(
      renderAvatarEl(guild.name, guild.icon_file_id),
      guild.name,
      `${members.length} member${members.length === 1 ? "" : "s"}`,
    );

    const page = (nodes: HTMLElement[]) => (c: HTMLElement) => void c.append(...nodes);
    const tabs: ShellTab<Tab>[] = [
      {
        id: "general",
        label: "General",
        iconName: "hash",
        render: page(renderGeneralSection(ctx, guild, owner, abilities.canManageGuild)),
      },
      {
        id: "members",
        label: "Members",
        iconName: "users",
        render: page(renderMembersSection(ctx, guild, members, abilities, adminIds)),
      },
      {
        id: "roles",
        label: "Roles",
        iconName: "shield",
        render: page(renderRolesSection(guild, members, roles, memberRoleIds)),
      },
    ];
    if (abilities.canManageGuild) {
      // Who did what here — server admins only (the API requires MANAGE_GUILD).
      const log = renderAuditLog(`/api/guilds/${guild.id}/audit-log`);
      tabs.push({ id: "audit", label: "Audit log", iconName: "activity", render: page([log]) });
    }
    if (isOwner) {
      // Red and set apart, like Log out/Danger in your own Settings: the
      // one page that transfers ownership or deletes the server.
      tabs.push({
        id: "danger",
        label: "Danger Zone",
        iconName: "trash",
        caution: true,
        render: page(renderDangerZone(ctx, guild, members)),
      });
    } else {
      // A plain member's counterpart: leaving (the owner can't, without
      // handing the server on first, which is what Danger Zone is for).
      tabs.push({
        id: "leave",
        label: "Leave Server",
        iconName: "log-out",
        caution: true,
        render: page(renderLeaveServerSection(ctx, guild)),
      });
    }
    shell.setTabs(tabs);
  }
}
