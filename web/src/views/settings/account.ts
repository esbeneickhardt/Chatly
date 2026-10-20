// Settings → Account, Logout and Danger: data export, sign-out,
// ownership transfer and account deletion.

import { type User, api } from "../../api";
import { confirmDialog } from "../../ui";
import { errorMessage, field, formDialog, group, passwordField, row } from "./widgets";

export function renderLogoutSection(container: HTMLElement, onLoggedOut: () => void): void {
  const logoutRow = row({
    label: "Log out",
    action: true,
    onClick: async () => {
      await api.post("/api/logout");
      onLoggedOut();
    },
  });
  const logoutAllRow = row({
    label: "Log out everywhere",
    action: true,
    danger: true,
    onClick: async () => {
      const ok = await confirmDialog({
        title: "Log out everywhere?",
        message: "Every device signed in to this account is logged out.",
        confirmLabel: "Log out everywhere",
        danger: true,
      });
      if (!ok) return;
      await api.post("/api/logout-all");
      onLoggedOut();
    },
  });
  container.append(group("Sessions", logoutRow.el, logoutAllRow.el));
}

/** Populates `select` with every real, non-deleted account other than
 * `excludeUserId` — the pool instance ownership can move to. Reuses
 * `/api/admin/users` (the same list the Admin tab already fetches)
 * rather than a dedicated endpoint. */
async function loadOwnerCandidates(select: HTMLSelectElement, excludeUserId: string): Promise<void> {
  select.disabled = true;
  select.replaceChildren(Object.assign(document.createElement("option"), { textContent: "Loading…" }));
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

function ownerPicker(user: User): { el: HTMLElement; select: HTMLSelectElement } {
  const el = field("New owner");
  const select = document.createElement("select");
  el.appendChild(select);
  void loadOwnerCandidates(select, user.id);
  return { el, select };
}

export function renderAccountSection(container: HTMLElement): void {
  const exportRow = row({
    label: "Export my data",
    action: true,
    onClick: async () => {
      const button = exportRow.el as HTMLButtonElement;
      button.disabled = true;
      button.classList.add("busy");
      exportRow.setValue("");
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
        exportRow.setValue(errorMessage(err, "Couldn't export"));
      } finally {
        button.disabled = false;
        button.classList.remove("busy");
      }
    },
  });

  container.append(group("Your data", exportRow.el));
}

/** The instance owner hands `is_owner` to another real account — the
 * only way out of `delete_account`'s own block on deleting yourself
 * while still holding it, short of deleting without transferring. */
function transferOwnershipDialog(user: User): void {
  const owner = ownerPicker(user);
  const password = passwordField("Your password", "current-password");
  formDialog({
    title: "Transfer ownership",
    content: [owner.el, password.el],
    submitLabel: "Transfer",
    danger: true,
    onSubmit: async () => {
      if (!owner.select.value || !password.input.value) return "Pick a new owner and enter your password.";
      const targetLabel = owner.select.selectedOptions[0]?.textContent ?? "this account";
      const ok = await confirmDialog({
        title: "Transfer ownership?",
        message: `${targetLabel} becomes the instance owner. You can't undo this yourself.`,
        confirmLabel: "Transfer",
        danger: true,
      });
      if (!ok) return undefined;
      try {
        await api.post("/api/me/transfer-ownership", {
          user_id: owner.select.value,
          password: password.input.value,
        });
      } catch (err) {
        return errorMessage(err);
      }
      window.location.reload();
      return null;
    },
  });
}

/** Deleting always erases every message the account ever sent and
 * removes the account outright (see `Storage::delete_account`). The
 * instance owner gets one extra choice: delete straight away
 * (`force_guilds: true`, which the server requires to delete the
 * `is_owner` account and which also tears down every guild they own)
 * or transfer `is_owner` to someone else first, then do the same
 * delete — still with `force_guilds: true`, since instance ownership
 * and guild ownership are separate things. */
function deleteAccountDialog(user: User, onLoggedOut: () => void): void {
  let transferFirst = false;
  const content: Node[] = [];
  const owner = user.is_owner ? ownerPicker(user) : null;
  if (owner) {
    owner.el.hidden = true;
    const choices = document.createElement("div");
    choices.className = "radio-group";
    const radioRow = (value: boolean, label: string): HTMLLabelElement => {
      const el = document.createElement("label");
      el.className = "radio-row";
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "delete-account-choice";
      input.checked = value === transferFirst;
      input.addEventListener("change", () => {
        if (!input.checked) return;
        transferFirst = value;
        owner.el.hidden = !transferFirst;
      });
      el.append(input, document.createTextNode(label));
      return el;
    };
    choices.append(radioRow(false, "Just delete"), radioRow(true, "Transfer ownership first"));
    content.push(choices, owner.el);
  }
  const password = passwordField("Your password", "current-password");
  content.push(password.el);

  formDialog({
    title: "Delete account",
    content,
    submitLabel: "Delete account",
    danger: true,
    onSubmit: async () => {
      if (!password.input.value) return "Enter your password.";
      if (transferFirst && !owner?.select.value) return "Pick a new owner.";
      const ok = await confirmDialog({
        title: "Delete your account?",
        message: "Your account and every message you've sent are gone for good.",
        confirmLabel: "Delete account",
        danger: true,
      });
      if (!ok) return undefined;
      try {
        if (transferFirst && owner) {
          await api.post("/api/me/transfer-ownership", {
            user_id: owner.select.value,
            password: password.input.value,
          });
        }
        await api.del("/api/me", { password: password.input.value, force_guilds: user.is_owner });
      } catch (err) {
        return errorMessage(err);
      }
      onLoggedOut();
      return null;
    },
  });
}

export function renderDangerSection(container: HTMLElement, user: User, onLoggedOut: () => void): void {
  const transferRow = user.is_owner
    ? row({ label: "Transfer ownership", onClick: () => transferOwnershipDialog(user) })
    : null;
  const deleteRow = row({
    label: "Delete account",
    danger: true,
    onClick: () => deleteAccountDialog(user, onLoggedOut),
  });
  container.append(group("Account", transferRow?.el ?? null, deleteRow.el));
}
