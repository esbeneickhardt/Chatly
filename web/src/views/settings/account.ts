// Settings → Account, Logout and Danger: ownership transfer, sign-out, account deletion.

import { ApiError, type User, api } from "../../api";
import { icon } from "../../icons";
import { confirmDialog } from "../../ui";
import { field, passwordBox, passwordConfirmRow, section } from "./widgets";

/** Its own top-level tab rather than tucked inside Security — signing
 * out isn't a security setting, it's an action, and burying it one
 * level down under an unrelated heading just made it harder to find. */
export function renderLogoutSection(container: HTMLElement, onLoggedOut: () => void): void {
  const logoutBtn = document.createElement("button");
  logoutBtn.type = "button";
  logoutBtn.className = "secondary";
  logoutBtn.append(icon("log-out", 15), document.createTextNode("Log out"));
  logoutBtn.addEventListener("click", async () => {
    await api.post("/api/logout");
    onLoggedOut();
  });

  const logoutAllBtn = document.createElement("button");
  logoutAllBtn.type = "button";
  logoutAllBtn.className = "danger";
  logoutAllBtn.textContent = "Log out everywhere";
  logoutAllBtn.addEventListener("click", async () => {
    await api.post("/api/logout-all");
    onLoggedOut();
  });

  const logoutRow = document.createElement("div");
  logoutRow.className = "settings-button-row";
  logoutRow.append(logoutBtn, logoutAllBtn);

  container.append(section("Sessions", logoutRow));
}

/** Populates `select` with every real, non-deleted account other than
 * `excludeUserId` — the pool instance ownership can move to. Shared by
 * the Transfer Ownership panel and the "transfer, then delete" choices
 * in the Delete My Account panel below, both of which need the exact
 * same picker. Reuses `/api/admin/users` (the same list the Admin tab
 * already fetches) rather than a dedicated endpoint. */
async function loadOwnerCandidates(select: HTMLSelectElement, excludeUserId: string): Promise<void> {
  select.disabled = true;
  select.replaceChildren(
    Object.assign(document.createElement("option"), { textContent: "Loading accounts…" }),
  );
  try {
    const users = await api.get<User[]>("/api/admin/users");
    const eligible = users.filter((u) => !u.is_bot && !u.is_guest && u.id !== excludeUserId);
    if (eligible.length === 0) {
      select.replaceChildren(
        Object.assign(document.createElement("option"), { textContent: "No other accounts yet" }),
      );
      return;
    }
    select.replaceChildren(
      ...eligible.map((u) =>
        Object.assign(document.createElement("option"), {
          value: u.id,
          textContent: `${u.display_name} (@${u.username})`,
        }),
      ),
    );
    select.disabled = false;
  } catch {
    select.replaceChildren(
      Object.assign(document.createElement("option"), { textContent: "Couldn't load accounts" }),
    );
  }
}

/** The instance owner hands `is_owner` to another real account — the
 * only way out of `delete_account`'s own block on deleting yourself
 * while still holding it, short of the "delete without transferring"
 * choice in the Delete My Account panel below.
 *
 * Starts as just a button with no explanatory sentence — "what happens
 * if I click Transfer Ownership" doesn't need one, only *picking who*
 * does, so that (plus the password confirmation) is what the revealed
 * panel shows. Same click-to-reveal shape the Admin tab's own per-user
 * "Delete…" already uses (see `deletePanel` there). */
function renderTransferOwnershipSection(user: User): HTMLElement {
  const startBtn = document.createElement("button");
  startBtn.type = "button";
  startBtn.className = "secondary";
  startBtn.textContent = "Transfer Ownership";

  function buildPanel(): HTMLElement {
    const panel = document.createElement("div");
    panel.className = "reveal-panel";

    const ownerField = field("New owner");
    const select = document.createElement("select");
    ownerField.appendChild(select);
    void loadOwnerCandidates(select, user.id);

    const passwordField = field("Confirm your password");
    const { wrap: passwordWrap, input: passwordInput } = passwordBox();
    passwordField.appendChild(passwordWrap);

    const error = document.createElement("p");
    error.className = "error-text";
    error.hidden = true;

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "secondary";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", () => panel.replaceWith(startBtn));

    const confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    confirmBtn.className = "danger";
    confirmBtn.textContent = "Transfer Ownership";
    confirmBtn.addEventListener("click", async () => {
      if (!select.value || !passwordInput.value) return;
      const targetLabel = select.selectedOptions[0]?.textContent ?? "this account";
      const ok = await confirmDialog({
        title: "Transfer ownership?",
        message: `Make ${targetLabel} the instance owner? This can't be undone by yourself.`,
        confirmLabel: "Transfer Ownership",
        danger: true,
      });
      if (!ok) return;
      error.hidden = true;
      confirmBtn.disabled = true;
      try {
        await api.post("/api/me/transfer-ownership", {
          user_id: select.value,
          password: passwordInput.value,
        });
        panel.replaceWith(
          Object.assign(document.createElement("p"), {
            className: "muted-text",
            textContent: "Ownership transferred — reloading…",
          }),
        );
        setTimeout(() => window.location.reload(), 1200);
      } catch (err) {
        error.textContent = err instanceof ApiError ? err.message : "Something went wrong.";
        error.hidden = false;
        confirmBtn.disabled = false;
      }
    });

    const actions = document.createElement("div");
    actions.className = "reveal-panel-actions";
    actions.append(cancelBtn, confirmBtn);
    panel.append(ownerField, passwordField, actions, error);
    return panel;
  }

  startBtn.addEventListener("click", () => startBtn.replaceWith(buildPanel()));

  return section("Transfer ownership", startBtn);
}

/** Just the GDPR data-portability half — export used to share a tab
 * with transfer-ownership/delete, which is why the tab itself was
 * still called "Account" while everything actually destructive lived
 * in the new "Danger" tab instead (see `renderDangerSection`). */
export function renderAccountSection(container: HTMLElement): void {
  const exportBtn = document.createElement("button");
  exportBtn.type = "button";
  exportBtn.className = "secondary";
  exportBtn.textContent = "Export my data";
  const exportError = document.createElement("p");
  exportError.className = "error-text";
  exportError.hidden = true;
  exportBtn.addEventListener("click", async () => {
    exportError.hidden = true;
    exportBtn.disabled = true;
    try {
      const data = await api.get("/api/me/export");
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "chatly-data-export.json";
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      exportError.textContent = err instanceof ApiError ? err.message : "Couldn't export your data.";
      exportError.hidden = false;
    } finally {
      exportBtn.disabled = false;
    }
  });

  container.append(section("Export your data", exportBtn, exportError));
}

/** Transfer-ownership + delete-account — split out of the old
 * "Account" tab into its own nav item, red-accented like Logout (see
 * `renderSettings`'s `caution` tabs), since neither reads as "just
 * another settings pane" the way Profile/Devices/Security/Account do.
 *
 * Each headline is followed by exactly one button and nothing else —
 * no explanatory sentence sits between them. What each button *does*
 * only shows up once it's clicked.
 *
 * Deleting always erases every message the account ever sent and
 * removes the account itself outright — there's no more "anonymize
 * and leave a placeholder behind" choice to make (see
 * `Storage::delete_account`), so a plain member sees nothing beyond
 * the password field. The instance owner gets exactly one extra
 * choice: delete straight away (`force_guilds: true` — the server
 * otherwise refuses to delete the one account holding `is_owner` at
 * all, see `auth::delete_account`, and this also tears down every
 * guild they own in the same action) or transfer `is_owner` to
 * someone else first, then do the same delete — still with
 * `force_guilds: true`, since instance ownership and *guild* ownership
 * are separate things and transferring the former doesn't relinquish
 * the latter. */
export function renderDangerSection(container: HTMLElement, user: User, onLoggedOut: () => void): void {
  if (user.is_owner) container.append(renderTransferOwnershipSection(user));

  function buildDeletePanel(startBtn: HTMLElement): HTMLElement {
    const panel = document.createElement("div");
    panel.className = "reveal-panel";

    let transferFirst = false;

    const ownerField = field("New owner");
    const ownerSelect = document.createElement("select");
    ownerField.appendChild(ownerSelect);
    ownerField.hidden = true;
    void loadOwnerCandidates(ownerSelect, user.id);

    let modeWrap: HTMLElement | null = null;
    if (user.is_owner) {
      modeWrap = document.createElement("div");
      modeWrap.className = "radio-group";
      function radioRow(value: boolean, label: string): HTMLLabelElement {
        const row = document.createElement("label");
        row.className = "radio-row";
        const input = document.createElement("input");
        input.type = "radio";
        input.name = "delete-account-choice";
        input.checked = value === transferFirst;
        input.addEventListener("change", () => {
          if (!input.checked) return;
          transferFirst = value;
          ownerField.hidden = !transferFirst;
        });
        row.append(input, document.createTextNode(` ${label}`));
        return row;
      }
      modeWrap.append(
        radioRow(false, "Delete account"),
        radioRow(true, "Transfer ownership, then delete account"),
      );
    }

    const { passwordField, actions, error } = passwordConfirmRow({
      confirmLabel: "Delete Account",
      onCancel: () => panel.replaceWith(startBtn),
      onConfirm: async (password, confirmBtn, errorEl) => {
        if (transferFirst && !ownerSelect.value) {
          errorEl.textContent = "Choose who to transfer ownership to.";
          errorEl.hidden = false;
          return;
        }
        const ok = await confirmDialog({
          title: transferFirst ? "Transfer ownership and delete your account?" : "Delete your account?",
          message: "This can't be undone.",
          confirmLabel: "Delete Account",
          danger: true,
        });
        if (!ok) return;
        errorEl.hidden = true;
        confirmBtn.disabled = true;
        try {
          if (transferFirst) {
            await api.post("/api/me/transfer-ownership", { user_id: ownerSelect.value, password });
          }
          await api.del("/api/me", { password, force_guilds: user.is_owner });
          onLoggedOut();
        } catch (err) {
          errorEl.textContent = err instanceof ApiError ? err.message : "Something went wrong.";
          errorEl.hidden = false;
          confirmBtn.disabled = false;
        }
      },
    });

    panel.append(...(modeWrap ? [modeWrap] : []), ownerField, passwordField, actions, error);
    return panel;
  }

  const startBtn = document.createElement("button");
  startBtn.type = "button";
  startBtn.className = "danger";
  startBtn.textContent = "Delete Account";
  startBtn.addEventListener("click", () => startBtn.replaceWith(buildDeletePanel(startBtn)));

  container.append(section("Delete my account", startBtn));
}
