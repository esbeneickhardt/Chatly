// Server settings → Roles: one row per role; tapping it opens what can be
// changed (who has it, its permissions and position, deleting it), each in
// its own dialog. Creating a role asks only for a name, then goes straight
// to choosing who gets it.

import { ApiError, type Guild, type Role, type User, api } from "../../api";
import { confirmDialog, showNotice } from "../../ui";
import { actionSheet, type SheetAction } from "../settings/lists";
import { errorMessage, field, formDialog, group, row, switchRow, textField } from "../settings/widgets";

/** Every grantable bit from `protocol::permissions::Permissions`
 * (Rust) — kept in sync by hand since bitflags has no JSON schema to
 * generate this from. `ADMINISTRATOR` is deliberately included, not
 * hidden: the server's own `ensure_can_grant` (Rust) already stops
 * anyone from checking a box they don't hold themselves, so there's
 * no extra danger in just showing it here too. */
export const PERMISSION_NAMES = [
  "VIEW_CHANNEL",
  "SEND_MESSAGES",
  "MANAGE_MESSAGES",
  "MANAGE_CHANNELS",
  "MANAGE_ROLES",
  "MANAGE_GUILD",
  "KICK_MEMBERS",
  "BAN_MEMBERS",
  "CREATE_INVITE",
  "CONNECT",
  "SPEAK",
  "MUTE_MEMBERS",
  "ADMINISTRATOR",
] as const;

export const PERMISSION_LABELS: Record<string, string> = {
  VIEW_CHANNEL: "View channels",
  SEND_MESSAGES: "Send messages",
  MANAGE_MESSAGES: "Manage messages",
  MANAGE_CHANNELS: "Manage channels",
  MANAGE_ROLES: "Manage roles",
  MANAGE_GUILD: "Manage server",
  KICK_MEMBERS: "Kick members",
  BAN_MEMBERS: "Ban members",
  CREATE_INVITE: "Create invites",
  CONNECT: "Connect to voice",
  SPEAK: "Speak in voice",
  MUTE_MEMBERS: "Mute members",
  ADMINISTRATOR: "Server admin",
};

/** `Permissions` (Rust, via `bitflags`' own serde impl) round-trips
 * through JSON as a `" | "`-joined string of flag names, e.g.
 * `"VIEW_CHANNEL | SEND_MESSAGES"` — never a raw number, and `""`
 * (not `"0"`) for none. */
export function parsePermissions(raw: string): Set<string> {
  return new Set(
    raw
      .split("|")
      .map((p) => p.trim())
      .filter(Boolean),
  );
}

export function joinPermissions(set: Set<string>): string {
  return Array.from(set).join(" | ");
}

/** Custom roles and per-server permission overwrites — see
 * `api::roles` (Rust) for the full model (role hierarchy, the
 * "can't grant what you don't have" guard, etc.); this surfaces role
 * CRUD and member assignment. Channel-level overwrites don't have a
 * UI yet — they're reachable via the API `api::roles` exposes. */
export function renderRolesSection(
  guild: Guild,
  members: User[],
  roles: Role[],
  memberRoleIds: Map<string, Set<string>>,
): HTMLElement[] {
  const holders = (role: Role): number =>
    members.filter((m) => memberRoleIds.get(m.id)?.has(role.id) ?? false).length;
  const isEveryone = (role: Role): boolean => role.id === guild.id;
  const describe = (role: Role): string => {
    const n = holders(role);
    const who = isEveryone(role) ? "Everyone" : `${n} ${n === 1 ? "person" : "people"}`;
    return `${who} · position ${role.position}`;
  };

  const listCard = group(`Roles · ${roles.length}`);
  const card = listCard.querySelector<HTMLElement>(".settings-card");
  const title = listCard.querySelector<HTMLElement>(".settings-group-title");
  const refreshTitle = (): void => {
    if (title) title.textContent = `Roles · ${roles.length}`;
  };

  function roleRow(role: Role): { el: HTMLElement; refresh: () => void } {
    const refresh = (): void => r.setValue(describe(role));
    const r = row({
      label: isEveryone(role) ? "@everyone" : role.name,
      value: describe(role),
      onClick: () => openRole(role, r.el, refresh),
    });
    r.el.classList.add("role-row");
    r.el.dataset.roleId = role.id;
    return { el: r.el, refresh };
  }

  function openRole(role: Role, rowEl: HTMLElement, refresh: () => void): void {
    const name = isEveryone(role) ? "@everyone" : role.name;
    const actions: SheetAction[] = [];
    if (!isEveryone(role)) actions.push({ label: "People", run: () => editPeople(role, refresh) });
    actions.push({ label: "Permissions", run: () => editPermissions(role, refresh) });
    if (!isEveryone(role)) {
      actions.push({
        label: "Delete role",
        danger: true,
        run: async () => {
          const ok = await confirmDialog({
            title: `Delete ${role.name}?`,
            message: "It's taken away from everyone who has it.",
            confirmLabel: "Delete",
            danger: true,
          });
          if (!ok) return;
          try {
            await api.del(`/api/guilds/${guild.id}/roles/${role.id}`);
            roles.splice(roles.indexOf(role), 1);
            rowEl.remove();
            refreshTitle();
          } catch (err) {
            showNotice(errorMessage(err, "Couldn't delete that role."));
          }
        },
      });
    }
    const badge = document.createElement("div");
    badge.className = "avatar role-avatar";
    badge.textContent = "@";
    actionSheet({ avatar: badge, title: name, detail: describe(role), actions });
  }

  /** Who has the role: a switch per member, saved as it's flipped. */
  function peopleContent(role: Role, refresh: () => void): HTMLElement[] {
    const search = document.createElement("input");
    search.type = "search";
    search.placeholder = "Find a member";
    search.autocomplete = "off";
    search.setAttribute("aria-label", `Find a member to give ${role.name}`);
    const list = document.createElement("div");
    list.className = "settings-card role-people";
    const rows = members.map((member) => {
      const has = memberRoleIds.get(member.id)?.has(role.id) ?? false;
      const sw = switchRow(member.display_name, has, async (next) => {
        try {
          if (next) {
            await api.post(`/api/guilds/${guild.id}/members/${member.id}/roles/${role.id}`);
            const ids = memberRoleIds.get(member.id) ?? new Set<string>();
            ids.add(role.id);
            memberRoleIds.set(member.id, ids);
          } else {
            await api.del(`/api/guilds/${guild.id}/members/${member.id}/roles/${role.id}`);
            memberRoleIds.get(member.id)?.delete(role.id);
          }
          refresh();
          return true;
        } catch (err) {
          showNotice(err instanceof ApiError ? err.message : "Couldn't update that member's roles.");
          return false;
        }
      });
      list.appendChild(sw.el);
      return { el: sw.el, member };
    });
    search.addEventListener("input", () => {
      const q = search.value.trim().toLowerCase();
      for (const { el, member } of rows) {
        el.hidden = q !== "" && !`${member.display_name} ${member.username}`.toLowerCase().includes(q);
      }
    });
    return [search, list];
  }

  function editPeople(role: Role, refresh: () => void): void {
    const dialog = formDialog({
      title: `${role.name}: people`,
      content: peopleContent(role, refresh),
      submitLabel: "Done",
      focusField: false,
      onSubmit: async () => null,
    });
    dialog.actions.querySelector("button.secondary")?.remove();
  }

  /** What the role allows, and (except @everyone) where it ranks. */
  function editPermissions(role: Role, refresh: () => void): void {
    const granted = parsePermissions(role.permissions);
    const list = document.createElement("div");
    list.className = "settings-card";
    for (const perm of PERMISSION_NAMES) {
      const sw = switchRow(PERMISSION_LABELS[perm] ?? perm, granted.has(perm), (on) => {
        if (on) granted.add(perm);
        else granted.delete(perm);
      });
      sw.input.dataset.perm = perm;
      list.appendChild(sw.el);
    }
    const content: HTMLElement[] = [];
    let positionInput: HTMLInputElement | null = null;
    if (!isEveryone(role)) {
      const positionField = field("Position");
      positionInput = document.createElement("input");
      positionInput.type = "number";
      positionInput.inputMode = "numeric";
      positionInput.value = String(role.position);
      positionField.appendChild(positionInput);
      content.push(positionField);
    }
    content.push(list);
    formDialog({
      title: isEveryone(role) ? "@everyone" : role.name,
      content,
      submitLabel: "Save",
      focusField: false,
      onSubmit: async () => {
        try {
          const updated = await api.patch<Role>(`/api/guilds/${guild.id}/roles/${role.id}`, {
            permissions: joinPermissions(granted),
            position: positionInput ? Number(positionInput.value) : undefined,
          });
          role.permissions = updated.permissions;
          role.position = updated.position;
          refresh();
          return null;
        } catch (err) {
          return errorMessage(err, "Couldn't save that role.");
        }
      },
    });
  }

  card?.append(...roles.map((role) => roleRow(role).el));

  const createRow = row({
    label: "Create role",
    action: true,
    onClick: () => {
      const { el, input } = textField("Name");
      input.placeholder = "Moderator";
      let created = false;
      formDialog({
        title: "New role",
        content: [el],
        submitLabel: "Create",
        onSubmit: async (dialog) => {
          if (created) return null;
          const name = input.value.trim();
          if (!name) return "Give the role a name.";
          let role: Role;
          try {
            role = await api.post<Role>(`/api/guilds/${guild.id}/roles`, { name, permissions: "" });
          } catch (err) {
            return errorMessage(err, "Couldn't create that role.");
          }
          roles.push(role);
          const added = roleRow(role);
          card?.appendChild(added.el);
          refreshTitle();
          // Create, then assign: the same dialog moves on to who gets it.
          created = true;
          dialog.body.replaceChildren(...peopleContent(role, added.refresh));
          dialog.actions.querySelector("button.secondary")?.remove();
          dialog.submitBtn.textContent = "Done";
          return undefined;
        },
      });
    },
  });

  return [group(null, createRow.el), listCard];
}
