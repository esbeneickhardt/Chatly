// Server settings → Danger Zone and Leave Server.

import { ApiError, type Guild, type User, api } from "../../api";
import { confirmDialog } from "../../ui";
import { field, section } from "./widgets";
import type { ServerSettingsContext } from "./context";

export function renderDangerZone(ctx: ServerSettingsContext, guild: Guild, members: User[]): HTMLElement[] {
  const others = members.filter((m) => m.id !== guild.owner_id);

  const transferStartBtn = document.createElement("button");
  transferStartBtn.type = "button";
  transferStartBtn.className = "secondary";
  transferStartBtn.textContent = "Transfer Ownership";
  transferStartBtn.disabled = others.length === 0;

  function buildTransferPanel(): HTMLElement {
    const panel = document.createElement("div");
    panel.className = "reveal-panel";

    const memberField = field("New owner");
    const select = document.createElement("select");
    for (const m of others) {
      const option = document.createElement("option");
      option.value = m.id;
      option.textContent = m.display_name;
      select.appendChild(option);
    }
    memberField.appendChild(select);

    const error = document.createElement("p");
    error.className = "error-text";
    error.hidden = true;

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "secondary";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", () => panel.replaceWith(transferStartBtn));

    const confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    confirmBtn.className = "danger";
    confirmBtn.textContent = "Transfer Ownership";
    confirmBtn.addEventListener("click", async () => {
      const target = others.find((m) => m.id === select.value);
      if (!target) return;
      const ok = await confirmDialog({
        title: "Transfer ownership?",
        message: `Make ${target.display_name} the owner of "${guild.name}"? You'll immediately lose all administrative control over this server — this can't be undone by yourself.`,
        confirmLabel: "Transfer Ownership",
        danger: true,
      });
      if (!ok) return;
      error.hidden = true;
      confirmBtn.disabled = true;
      try {
        const updated = await api.post<Guild>(`/api/guilds/${guild.id}/transfer-ownership`, {
          user_id: target.id,
        });
        ctx.opts.onUpdated(updated);
        ctx.close();
      } catch (err) {
        error.textContent = err instanceof ApiError ? err.message : "Couldn't transfer ownership.";
        error.hidden = false;
        confirmBtn.disabled = false;
      }
    });

    const actions = document.createElement("div");
    actions.className = "reveal-panel-actions";
    actions.append(cancelBtn, confirmBtn);
    panel.append(memberField, actions, error);
    return panel;
  }
  transferStartBtn.addEventListener("click", () => transferStartBtn.replaceWith(buildTransferPanel()));

  const deleteStartBtn = document.createElement("button");
  deleteStartBtn.type = "button";
  deleteStartBtn.className = "danger";
  deleteStartBtn.textContent = "Delete Server";

  function buildDeletePanel(): HTMLElement {
    const panel = document.createElement("div");
    panel.className = "reveal-panel";

    const hint = document.createElement("p");
    hint.className = "muted-text";
    hint.textContent = `Type "${guild.name}" to confirm. This deletes every channel and message in it and can't be undone.`;

    const confirmField = field(`Type "${guild.name}"`);
    const deleteInput = document.createElement("input");
    deleteInput.type = "text";
    confirmField.appendChild(deleteInput);

    const error = document.createElement("p");
    error.className = "error-text";
    error.hidden = true;

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "secondary";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", () => panel.replaceWith(deleteStartBtn));

    const confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    confirmBtn.className = "danger";
    confirmBtn.textContent = "Delete Server";
    confirmBtn.disabled = true;
    deleteInput.addEventListener("input", () => {
      confirmBtn.disabled = deleteInput.value !== guild.name;
    });
    confirmBtn.addEventListener("click", async () => {
      error.hidden = true;
      confirmBtn.disabled = true;
      try {
        await api.del(`/api/guilds/${guild.id}`);
        ctx.close();
        ctx.opts.onDeleted();
      } catch (err) {
        error.textContent = err instanceof ApiError ? err.message : "Couldn't delete the server.";
        error.hidden = false;
        confirmBtn.disabled = false;
      }
    });

    const actions = document.createElement("div");
    actions.className = "reveal-panel-actions";
    actions.append(cancelBtn, confirmBtn);
    panel.append(hint, confirmField, actions, error);
    return panel;
  }
  deleteStartBtn.addEventListener("click", () => deleteStartBtn.replaceWith(buildDeletePanel()));

  return [section("Transfer ownership", transferStartBtn), section("Delete server", deleteStartBtn)];
}

/** A plain member's own choice for what happens to their message
 * history here — distinct from deleting their whole account (which
 * now always erases everything, everywhere, with no choice — see
 * UX_FEEDBACK.md). Leaving is scoped to just this one server: the
 * account itself is untouched either way. */
export function renderLeaveServerSection(ctx: ServerSettingsContext, guild: Guild): HTMLElement[] {
  const leaveStartBtn = document.createElement("button");
  leaveStartBtn.type = "button";
  leaveStartBtn.className = "danger";
  leaveStartBtn.textContent = "Leave Server";

  function buildLeavePanel(): HTMLElement {
    const panel = document.createElement("div");
    panel.className = "reveal-panel";

    let mode: "erase" | "anonymize" = "erase";
    const modeWrap = document.createElement("div");
    modeWrap.className = "radio-group";
    function radioRow(value: "erase" | "anonymize", label: string): HTMLLabelElement {
      const row = document.createElement("label");
      row.className = "radio-row";
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "leave-server-mode";
      input.checked = value === mode;
      input.addEventListener("change", () => {
        if (input.checked) mode = value;
      });
      row.append(input, document.createTextNode(` ${label}`));
      return row;
    }
    modeWrap.append(
      radioRow("erase", "Delete my messages and reactions in this server"),
      radioRow("anonymize", 'Leave my messages behind as "Former member"'),
    );

    const error = document.createElement("p");
    error.className = "error-text";
    error.hidden = true;

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "secondary";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", () => panel.replaceWith(leaveStartBtn));

    const confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    confirmBtn.className = "danger";
    confirmBtn.textContent = "Leave Server";
    confirmBtn.addEventListener("click", async () => {
      const ok = await confirmDialog({
        title: "Leave this server?",
        message:
          mode === "erase"
            ? `You'll leave ${guild.name} and every message you've sent here will be deleted.`
            : `You'll leave ${guild.name}. Your messages stay, shown as "Former member" instead of your name.`,
        confirmLabel: "Leave Server",
        danger: true,
      });
      if (!ok) return;
      error.hidden = true;
      confirmBtn.disabled = true;
      try {
        await api.post(`/api/guilds/${guild.id}/leave`, { mode });
        ctx.close();
        ctx.opts.onLeft();
      } catch (err) {
        error.textContent = err instanceof ApiError ? err.message : "Couldn't leave the server.";
        error.hidden = false;
        confirmBtn.disabled = false;
      }
    });

    const actions = document.createElement("div");
    actions.className = "reveal-panel-actions";
    actions.append(cancelBtn, confirmBtn);
    panel.append(modeWrap, actions, error);
    return panel;
  }
  leaveStartBtn.addEventListener("click", () => leaveStartBtn.replaceWith(buildLeavePanel()));

  return [leaveStartBtn];
}
