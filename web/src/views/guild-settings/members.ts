// Server settings → Members: invite policy, member list, make admin, remove.

import { ApiError, type Guild, type User, api } from "../../api";
import { confirmDialog, renderAvatarEl } from "../../ui";
import { section } from "./widgets";
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
    const row = document.createElement("label");
    row.className = "toggle-row";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = guild.invites_open;

    const slider = document.createElement("span");
    slider.className = "toggle-slider";

    const status = document.createElement("span");
    status.textContent = guild.invites_open
      ? "Anyone can create invites"
      : "Only server admins can create invites";

    row.append(checkbox, slider, status);

    const policyError = document.createElement("p");
    policyError.className = "error-text";
    policyError.hidden = true;

    checkbox.addEventListener("change", async () => {
      const open = checkbox.checked;
      policyError.hidden = true;
      checkbox.disabled = true;
      try {
        await api.patch(`/api/guilds/${guild.id}/invite-policy`, { open });
        guild.invites_open = open;
        status.textContent = open ? "Anyone can create invites" : "Only server admins can create invites";
      } catch (err) {
        checkbox.checked = guild.invites_open;
        policyError.textContent =
          err instanceof ApiError ? err.message : "Couldn't update the invite policy.";
        policyError.hidden = false;
      } finally {
        checkbox.disabled = false;
      }
    });

    sections.push(section("Invites", row, policyError));
  }

  const list = document.createElement("div");
  for (const member of members) {
    const row = document.createElement("div");
    row.className = "session-row";
    const identity = document.createElement("div");
    identity.className = "friend-identity";
    identity.append(renderAvatarEl(member.display_name, member.avatar_file_id));
    const name = document.createElement("span");
    name.textContent = member.display_name;
    identity.appendChild(name);
    if (member.id === guild.owner_id) {
      const badge = document.createElement("span");
      badge.className = "session-badge";
      badge.textContent = "Owner";
      identity.appendChild(badge);
    } else if (adminIds.has(member.id)) {
      const badge = document.createElement("span");
      badge.className = "session-badge";
      badge.textContent = "Server admin";
      identity.appendChild(badge);
    }
    row.appendChild(identity);

    const actions = document.createElement("div");
    actions.className = "member-row-actions";
    row.appendChild(actions);

    // Promote / demote. Anyone who's already a server admin can make
    // another; only the owner can take the role from someone else
    // (anyone can step *themselves* down) — the API enforces the same.
    if (member.id !== guild.owner_id) {
      const isAdminNow = adminIds.has(member.id);
      const canToggle = isAdminNow ? can.isOwner || member.id === ctx.opts.currentUserId : can.isAdmin;
      if (canToggle) {
        const adminBtn = document.createElement("button");
        adminBtn.className = "secondary";
        adminBtn.textContent = isAdminNow
          ? member.id === ctx.opts.currentUserId
            ? "Step down as admin"
            : "Remove admin"
          : "Make admin";
        adminBtn.addEventListener("click", async () => {
          const ok = await confirmDialog({
            title: isAdminNow ? "Remove server admin?" : "Make a server admin?",
            message: isAdminNow
              ? `${member.display_name} will no longer be able to manage ${guild.name}.`
              : `${member.display_name} will be able to manage everything in ${guild.name} — channels, roles, members and invites — except delete it or hand it to someone else.`,
            confirmLabel: isAdminNow ? "Remove admin" : "Make admin",
            danger: isAdminNow,
          });
          if (!ok) return;
          adminBtn.disabled = true;
          try {
            if (isAdminNow) await api.del(`/api/guilds/${guild.id}/admins/${member.id}`);
            else await api.put(`/api/guilds/${guild.id}/admins/${member.id}`);
            // Re-render from the server so the Roles tab (which holds
            // its own copy of who has which role) agrees.
            void ctx.reload();
          } catch (err) {
            const error = document.createElement("p");
            error.className = "error-text";
            error.textContent = err instanceof ApiError ? err.message : "Couldn't change that.";
            row.appendChild(error);
            adminBtn.disabled = false;
          }
        });
        actions.appendChild(adminBtn);
      }
    }

    const canKickThis =
      can.canKick &&
      member.id !== guild.owner_id &&
      member.id !== ctx.opts.currentUserId &&
      (can.isOwner || !adminIds.has(member.id));
    if (canKickThis) {
      const removeBtn = document.createElement("button");
      removeBtn.className = "secondary";
      removeBtn.textContent = "Remove";
      removeBtn.addEventListener("click", async () => {
        const ok = await confirmDialog({
          title: "Remove this member?",
          message: `${member.display_name} will be removed from ${guild.name}.`,
          confirmLabel: "Remove",
          danger: true,
        });
        if (!ok) return;
        removeBtn.disabled = true;
        try {
          await api.del(`/api/guilds/${guild.id}/members/${member.id}`);
          row.remove();
        } catch (err) {
          const error = document.createElement("p");
          error.className = "error-text";
          error.textContent = err instanceof ApiError ? err.message : "Couldn't remove that member.";
          row.appendChild(error);
          removeBtn.disabled = false;
        }
      });
      actions.appendChild(removeBtn);
    }

    list.appendChild(row);
  }
  sections.push(section("Members", list));

  return sections;
}
