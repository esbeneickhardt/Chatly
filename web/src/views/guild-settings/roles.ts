// Server settings → Roles: permission names and the role editor.

import { ApiError, type Guild, type Role, type User, api } from "../../api";
import { confirmDialog } from "../../ui";
import { field, section } from "./widgets";

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
  MANAGE_MESSAGES: "Manage messages (delete others')",
  MANAGE_CHANNELS: "Manage channels",
  MANAGE_ROLES: "Manage roles",
  MANAGE_GUILD: "Manage server",
  KICK_MEMBERS: "Kick members",
  BAN_MEMBERS: "Ban members",
  CREATE_INVITE: "Create invites",
  CONNECT: "Connect to voice",
  SPEAK: "Speak in voice",
  MUTE_MEMBERS: "Mute members",
  ADMINISTRATOR: "Server admin (full access, bypasses everything else)",
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

export function renderPermissionChecklist(initial: Set<string>): {
  el: HTMLElement;
  get: () => Set<string>;
} {
  const wrap = document.createElement("div");
  wrap.className = "role-permission-grid";
  const boxes: HTMLInputElement[] = [];
  for (const permName of PERMISSION_NAMES) {
    const row = document.createElement("label");
    row.className = "toggle-row";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = initial.has(permName);
    checkbox.dataset.perm = permName;
    const slider = document.createElement("span");
    slider.className = "toggle-slider";
    const text = document.createElement("span");
    text.textContent = PERMISSION_LABELS[permName] ?? permName;
    row.append(checkbox, slider, text);
    wrap.appendChild(row);
    boxes.push(checkbox);
  }
  return {
    el: wrap,
    get: () => new Set(boxes.filter((b) => b.checked).map((b) => b.dataset.perm as string)),
  };
}

/** Custom roles and per-server permission overwrites — see
 * `api::roles` (Rust) for the full model (role hierarchy, the
 * "can't grant what you don't have" guard, etc.); this surfaces role
 * CRUD and member assignment. Channel-level overwrites don't have a
 * UI yet — they're reachable via the API `api::roles` exposes, same
 * as bots shipped API-first with no UI in an earlier batch. */
export function renderRolesSection(
  guild: Guild,
  members: User[],
  roles: Role[],
  memberRoleIds: Map<string, Set<string>>,
): HTMLElement[] {
  const sections: HTMLElement[] = [];
  const list = document.createElement("div");

  /** Draws one role's row and returns its Assign button (none for @everyone). */
  function renderRoleRow(role: Role): HTMLButtonElement | null {
    const isEveryone = role.id === guild.id;
    const row = document.createElement("div");
    row.className = "session-row";

    const identity = document.createElement("div");
    identity.className = "friend-identity";
    const name = document.createElement("span");
    name.textContent = isEveryone ? "@everyone" : role.name;
    identity.appendChild(name);
    const posBadge = document.createElement("span");
    posBadge.className = "session-badge";
    posBadge.textContent = `position ${role.position}`;
    identity.appendChild(posBadge);
    const countBadge = document.createElement("span");
    countBadge.className = "session-badge role-count-badge";
    if (!isEveryone) identity.appendChild(countBadge);
    row.appendChild(identity);

    const actions = document.createElement("div");
    const peopleBtn = document.createElement("button");
    peopleBtn.type = "button";
    peopleBtn.className = "secondary role-people-btn";
    peopleBtn.textContent = "Assign";
    peopleBtn.title = `Choose who has ${role.name}`;
    peopleBtn.setAttribute("aria-label", `Assign people to ${role.name}`);
    // Everyone has @everyone; there is nobody to assign it to.
    if (!isEveryone) actions.appendChild(peopleBtn);
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "secondary";
    editBtn.textContent = "Edit";
    actions.appendChild(editBtn);
    if (!isEveryone) {
      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "secondary";
      deleteBtn.textContent = "Delete";
      deleteBtn.addEventListener("click", async () => {
        const ok = await confirmDialog({
          title: "Delete this role?",
          message: `"${role.name}" will be removed from everyone who has it.`,
          confirmLabel: "Delete",
          danger: true,
        });
        if (!ok) return;
        deleteBtn.disabled = true;
        try {
          await api.del(`/api/guilds/${guild.id}/roles/${role.id}`);
          row.remove();
        } catch (err) {
          error.textContent = err instanceof ApiError ? err.message : "Couldn't delete that role.";
          error.hidden = false;
          deleteBtn.disabled = false;
        }
      });
      actions.appendChild(deleteBtn);
    }
    row.appendChild(actions);

    const error = document.createElement("p");
    error.className = "error-text";
    error.hidden = true;

    const editPanel = document.createElement("div");
    editPanel.className = "role-detail role-edit-panel";
    editPanel.hidden = true;

    const checklist = renderPermissionChecklist(parsePermissions(role.permissions));
    editPanel.appendChild(checklist.el);

    const positionField = field("Position (higher can manage lower)");
    const positionInput = document.createElement("input");
    positionInput.type = "number";
    positionInput.value = String(role.position);
    positionField.appendChild(positionInput);
    if (!isEveryone) editPanel.appendChild(positionField);

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.textContent = "Save";
    saveBtn.addEventListener("click", async () => {
      error.hidden = true;
      saveBtn.disabled = true;
      try {
        const updated = await api.patch<Role>(`/api/guilds/${guild.id}/roles/${role.id}`, {
          permissions: joinPermissions(checklist.get()),
          position: isEveryone ? undefined : Number(positionInput.value),
        });
        role.permissions = updated.permissions;
        role.position = updated.position;
        posBadge.textContent = `position ${role.position}`;
      } catch (err) {
        error.textContent = err instanceof ApiError ? err.message : "Couldn't save that role.";
        error.hidden = false;
      } finally {
        saveBtn.disabled = false;
      }
    });
    editPanel.appendChild(saveBtn);
    editPanel.appendChild(error);

    // Who has this role: its own panel, so handing a role to someone
    // doesn't mean scrolling past every permission first.
    const peoplePanel = document.createElement("div");
    peoplePanel.className = "role-detail role-people-panel";
    peoplePanel.hidden = true;
    const peopleError = document.createElement("p");
    peopleError.className = "error-text";
    peopleError.hidden = true;

    const assigned = (): number =>
      members.filter((m) => memberRoleIds.get(m.id)?.has(role.id) ?? false).length;
    const refreshPeopleLabel = (): void => {
      const n = assigned();
      countBadge.textContent = `${n} ${n === 1 ? "person" : "people"}`;
    };
    refreshPeopleLabel();

    if (!isEveryone) {
      const filter = document.createElement("input");
      filter.type = "search";
      filter.placeholder = "Find a member";
      filter.setAttribute("aria-label", `Find a member to give ${role.name}`);
      filter.autocomplete = "off";
      peoplePanel.appendChild(filter);
      const rows: { row: HTMLElement; member: User }[] = [];
      for (const member of members) {
        const memberRow = document.createElement("label");
        memberRow.className = "toggle-row";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = memberRoleIds.get(member.id)?.has(role.id) ?? false;
        const slider = document.createElement("span");
        slider.className = "toggle-slider";
        const label = document.createElement("span");
        label.textContent = member.display_name;
        memberRow.append(checkbox, slider, label);
        checkbox.addEventListener("change", async () => {
          checkbox.disabled = true;
          peopleError.hidden = true;
          try {
            if (checkbox.checked) {
              await api.post(`/api/guilds/${guild.id}/members/${member.id}/roles/${role.id}`);
              const roleIds = memberRoleIds.get(member.id) ?? new Set<string>();
              roleIds.add(role.id);
              memberRoleIds.set(member.id, roleIds);
            } else {
              await api.del(`/api/guilds/${guild.id}/members/${member.id}/roles/${role.id}`);
              memberRoleIds.get(member.id)?.delete(role.id);
            }
            refreshPeopleLabel();
          } catch (err) {
            checkbox.checked = !checkbox.checked;
            peopleError.textContent =
              err instanceof ApiError ? err.message : "Couldn't update that member's roles.";
            peopleError.hidden = false;
          } finally {
            checkbox.disabled = false;
          }
        });
        rows.push({ row: memberRow, member });
        peoplePanel.appendChild(memberRow);
      }
      filter.addEventListener("input", () => {
        const q = filter.value.trim().toLowerCase();
        for (const { row: memberRow, member } of rows) {
          memberRow.hidden =
            q !== "" && !`${member.display_name} ${member.username}`.toLowerCase().includes(q);
        }
      });
      peoplePanel.appendChild(peopleError);
    }

    // One panel open at a time; the button that opened it closes it again.
    const panels: [HTMLButtonElement, HTMLElement][] = [
      [peopleBtn, peoplePanel],
      [editBtn, editPanel],
    ];
    for (const [btn, panel] of panels) {
      panel.id = `role-panel-${role.id}-${btn === peopleBtn ? "people" : "edit"}`;
      btn.setAttribute("aria-controls", panel.id);
      btn.setAttribute("aria-expanded", "false");
      btn.addEventListener("click", () => {
        const opening = panel.hidden;
        for (const [otherBtn, otherPanel] of panels) {
          otherPanel.hidden = otherPanel !== panel || !opening;
          otherBtn.setAttribute("aria-expanded", String(!otherPanel.hidden));
          if (otherBtn === editBtn) otherBtn.textContent = otherPanel.hidden ? "Edit" : "Close";
        }
        if (btn === peopleBtn) refreshPeopleLabel();
      });
    }
    const detail = document.createElement("div");
    detail.append(peoplePanel, editPanel);

    list.append(row, detail);
    return isEveryone ? null : peopleBtn;
  }

  for (const role of roles) renderRoleRow(role);
  sections.push(section("Roles", list));

  const createWrap = document.createElement("div");
  const nameField = field("New role name");
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.placeholder = "Moderator";
  nameField.appendChild(nameInput);
  createWrap.appendChild(nameField);

  const createChecklist = renderPermissionChecklist(new Set());
  createWrap.appendChild(createChecklist.el);

  const createError = document.createElement("p");
  createError.className = "error-text";
  createError.hidden = true;

  const createBtn = document.createElement("button");
  createBtn.type = "button";
  createBtn.textContent = "Create role";
  createBtn.addEventListener("click", async () => {
    const trimmed = nameInput.value.trim();
    if (!trimmed) {
      createError.textContent = "Give the role a name first.";
      createError.hidden = false;
      return;
    }
    createError.hidden = true;
    createBtn.disabled = true;
    try {
      const role = await api.post<Role>(`/api/guilds/${guild.id}/roles`, {
        name: trimmed,
        permissions: joinPermissions(createChecklist.get()),
      });
      roles.push(role);
      // Create, then assign: open the new role's people straight away.
      const assignBtn = renderRoleRow(role);
      assignBtn?.click();
      assignBtn?.scrollIntoView({ block: "center" });
      nameInput.value = "";
    } catch (err) {
      createError.textContent = err instanceof ApiError ? err.message : "Couldn't create that role.";
      createError.hidden = false;
    } finally {
      createBtn.disabled = false;
    }
  });
  createWrap.append(createBtn, createError);
  sections.push(section("Create a role", createWrap));

  return sections;
}
