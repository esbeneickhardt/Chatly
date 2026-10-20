// Settings → Profile: picture, names and password. Each value is a row;
// changing one opens a small dialog.

import { type User, api } from "../../api";
import { renderAvatarPicker } from "../../avatar-picker";
import { errorMessage, formDialog, group, passwordField, row, textField } from "./widgets";

export function renderProfileSection(
  container: HTMLElement,
  user: User,
  onUserUpdated: (user: User) => void,
): void {
  const header = document.createElement("div");
  header.className = "settings-profile-header";
  const pickerWrap = document.createElement("div");
  pickerWrap.className = "avatar-picker-wrap";
  const headerName = document.createElement("div");
  headerName.className = "settings-profile-name";
  const headerUsername = document.createElement("div");
  headerUsername.className = "settings-profile-username";
  header.append(pickerWrap, headerName, headerUsername);

  function editName(label: string, key: "display_name" | "username"): void {
    const { el, input } = textField(label, user[key]);
    if (key === "username") {
      input.autocapitalize = "none";
      input.spellcheck = false;
    }
    formDialog({
      title: `Change ${label.toLowerCase()}`,
      content: [el],
      submitLabel: "Save",
      onSubmit: async () => {
        const value = key === "username" ? input.value.trim().toLowerCase() : input.value.trim();
        if (!value) return `${label} can't be empty.`;
        if (value === user[key]) return null;
        try {
          updated(await api.patch<User>("/api/me", { [key]: value }));
          return null;
        } catch (err) {
          return errorMessage(err);
        }
      },
    });
    input.select();
  }

  const nameRow = row({
    label: "Display name",
    onClick: () => editName("Display name", "display_name"),
  });
  const usernameRow = row({
    label: "Username",
    onClick: () => editName("Username", "username"),
  });

  function showUser(): void {
    headerName.textContent = user.display_name;
    headerUsername.textContent = `@${user.username}`;
    nameRow.setValue(user.display_name);
    usernameRow.setValue(`@${user.username}`);
  }
  function updated(next: User): void {
    user = next;
    showUser();
    onUserUpdated(next);
  }
  showUser();
  renderAvatarPicker(pickerWrap, { user, onUpdated: updated });

  const passwordRow = row({
    label: "Password",
    value: "••••••••",
    onClick: () => {
      const current = passwordField("Current password", "current-password");
      const next = passwordField("New password", "new-password");
      formDialog({
        title: "Change password",
        content: [current.el, next.el],
        submitLabel: "Change password",
        onSubmit: async () => {
          if (!current.input.value || !next.input.value) return "Fill in both passwords.";
          try {
            await api.post("/api/me/password", {
              current_password: current.input.value,
              new_password: next.input.value,
            });
            return null;
          } catch (err) {
            return errorMessage(err);
          }
        },
      });
    },
  });

  container.append(header, group("Account", nameRow.el, usernameRow.el), group("Sign-in", passwordRow.el));
}
