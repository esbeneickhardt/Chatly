// Settings → Profile.

import { ApiError, type User, api } from "../../api";
import { renderAvatarPicker } from "../../avatar-picker";
import { editableField, field, passwordBox, section } from "./widgets";

export function renderProfileSection(
  container: HTMLElement,
  user: User,
  onUserUpdated: (user: User) => void,
): void {
  const pickerWrap = document.createElement("div");
  pickerWrap.className = "avatar-picker-wrap";
  renderAvatarPicker(pickerWrap, { user, onUpdated: onUserUpdated });

  const nameField = editableField({
    label: "Display name",
    initialValue: user.display_name,
    save: async (value) => {
      try {
        const updated = await api.patch<User>("/api/me", { display_name: value });
        onUserUpdated(updated);
        return { ok: true, value: updated.display_name };
      } catch (err) {
        return { ok: false, message: err instanceof ApiError ? err.message : "Something went wrong." };
      }
    },
  });

  const usernameField = editableField({
    label: "Username",
    initialValue: user.username,
    save: async (value) => {
      try {
        const updated = await api.patch<User>("/api/me", { username: value.toLowerCase() });
        onUserUpdated(updated);
        return { ok: true, value: updated.username };
      } catch (err) {
        return { ok: false, message: err instanceof ApiError ? err.message : "Something went wrong." };
      }
    },
  });

  const changePwStartBtn = document.createElement("button");
  changePwStartBtn.type = "button";
  changePwStartBtn.className = "secondary";
  changePwStartBtn.textContent = "Change Password";

  function buildChangePasswordPanel(): HTMLElement {
    const panel = document.createElement("div");
    panel.className = "reveal-panel";

    const currentPwField = field("Current password");
    const { wrap: currentPwWrap, input: currentPwInput } = passwordBox("current-password");
    currentPwField.appendChild(currentPwWrap);

    const newPwField = field("New password");
    const { wrap: newPwWrap, input: newPwInput } = passwordBox("new-password");
    newPwField.appendChild(newPwWrap);

    const error = document.createElement("p");
    error.className = "error-text";
    error.hidden = true;

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "secondary";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", () => panel.replaceWith(changePwStartBtn));

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.textContent = "Change Password";
    saveBtn.addEventListener("click", async () => {
      if (!currentPwInput.value || !newPwInput.value) return;
      error.hidden = true;
      saveBtn.disabled = true;
      try {
        await api.post("/api/me/password", {
          current_password: currentPwInput.value,
          new_password: newPwInput.value,
        });
        const original = changePwStartBtn.textContent;
        panel.replaceWith(changePwStartBtn);
        changePwStartBtn.textContent = "Password changed";
        setTimeout(() => {
          changePwStartBtn.textContent = original;
        }, 1500);
      } catch (err) {
        error.textContent = err instanceof ApiError ? err.message : "Something went wrong.";
        error.hidden = false;
        saveBtn.disabled = false;
      }
    });

    const actions = document.createElement("div");
    actions.className = "reveal-panel-actions";
    actions.append(cancelBtn, saveBtn);

    panel.append(currentPwField, newPwField, actions, error);
    return panel;
  }

  changePwStartBtn.addEventListener("click", () => changePwStartBtn.replaceWith(buildChangePasswordPanel()));

  container.append(
    section("Identity", pickerWrap, nameField, usernameField),
    section("Password", changePwStartBtn),
  );
}
