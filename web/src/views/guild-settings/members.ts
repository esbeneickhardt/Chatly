// Server settings → Members: invite policy, member list, make admin, remove.
// Each member is a row; tapping it opens what you may do to them.

import { ApiError, type Guild, type User, api } from "../../api";
import { confirmDialog, renderAvatarEl, showNotice } from "../../ui";
import { actionSheet, entityRow, type SheetAction } from "../settings/lists";
import { group, switchRow } from "../settings/widgets";
import type { ServerSettingsContext } from "./context";

/** What the viewing member may do in this server — see `renderBody`. */
export interface Abilities {
  isOwner: boolean;
  isAdmin: boolean;
  canManageGuild: boolean;
  canKick: boolean;
}

export function renderMembersSection(
  ctx: ServerSettingsContext,
  guild: Guild,
  members: User[],
  can: Abilities,
  adminIds: Set<string>,
): HTMLElement[] {
  const sections: HTMLElement[] = [];

  if (can.canManageGuild) {
    const invites = switchRow("Anyone can invite", guild.invites_open, async (open) => {
      try {
        await api.patch(`/api/guilds/${guild.id}/invite-policy`, { open });
        guild.invites_open = open;
        return true;
      } catch (err) {
        showNotice(err instanceof ApiError ? err.message : "Couldn't update the invite policy.");
        return false;
      }
    });
    sections.push(group("Invites", invites.el));
  }

  /** Promote / demote. Anyone who's already a server admin can make
   * another; only the owner can take the role from someone else (anyone
   * can step *themselves* down) — the API enforces the same. */
  function adminAction(member: User): SheetAction | null {
    if (member.id === guild.owner_id) return null;
    const isAdminNow = adminIds.has(member.id);
    const isSelf = member.id === ctx.opts.currentUserId;
    const allowed = isAdminNow ? can.isOwner || isSelf : can.isAdmin;
    if (!allowed) return null;
    const label = isAdminNow ? (isSelf ? "Step down as admin" : "Remove admin") : "Make admin";
    return {
      label,
      danger: isAdminNow,
      run: async () => {
        const ok = await confirmDialog({
          title: isAdminNow ? "Remove server admin?" : "Make a server admin?",
          message: isAdminNow
            ? `${member.display_name} will no longer be able to manage ${guild.name}.`
            : `${member.display_name} will be able to manage everything in ${guild.name} except delete it or hand it to someone else.`,
          confirmLabel: isAdminNow ? "Remove admin" : "Make admin",
          danger: isAdminNow,
        });
        if (!ok) return;
        try {
          if (isAdminNow) await api.del(`/api/guilds/${guild.id}/admins/${member.id}`);
          else await api.put(`/api/guilds/${guild.id}/admins/${member.id}`);
          // Redraw from the server so the Roles page (which holds its
          // own copy of who has which role) agrees.
          void ctx.reload();
        } catch (err) {
          showNotice(err instanceof ApiError ? err.message : "Couldn't change that.");
        }
      },
    };
  }

  function removeAction(member: User, rowEl: HTMLElement): SheetAction | null {
    const allowed =
      can.canKick &&
      member.id !== guild.owner_id &&
      member.id !== ctx.opts.currentUserId &&
      (can.isOwner || !adminIds.has(member.id));
    if (!allowed) return null;
    return {
      label: "Remove from server",
      danger: true,
      run: async () => {
        const ok = await confirmDialog({
          title: "Remove this member?",
          message: `${member.display_name} will be removed from ${guild.name}.`,
          confirmLabel: "Remove",
          danger: true,
        });
        if (!ok) return;
        try {
          await api.del(`/api/guilds/${guild.id}/members/${member.id}`);
          rowEl.remove();
        } catch (err) {
          showNotice(err instanceof ApiError ? err.message : "Couldn't remove that member.");
        }
      },
    };
  }

  const rows = members.map((member) => {
    const badge =
      member.id === guild.owner_id ? "Owner" : adminIds.has(member.id) ? "Server admin" : undefined;
    const actions: SheetAction[] = [];
    const rowEl = entityRow({
      avatar: renderAvatarEl(member.display_name, member.avatar_file_id),
      name: member.display_name,
      detail: `@${member.username}`,
      badge,
      onClick: () =>
        actionSheet({
          avatar: renderAvatarEl(member.display_name, member.avatar_file_id),
          title: member.display_name,
          detail: `@${member.username}`,
          actions,
        }),
    });
    actions.push(
      ...[adminAction(member), removeAction(member, rowEl)].filter((a): a is SheetAction => a !== null),
    );
    // Nothing you may do to them: a plain row, not a button.
    if (actions.length === 0) {
      return entityRow({
        avatar: renderAvatarEl(member.display_name, member.avatar_file_id),
        name: member.display_name,
        detail: `@${member.username}`,
        badge,
      });
    }
    return rowEl;
  });
  sections.push(group(`Members · ${members.length}`, ...rows));

  return sections;
}
