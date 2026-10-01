// Settings → Security: two-factor authentication and friend-request privacy.

import { ApiError, api } from "../../api";
import { section } from "./widgets";

export function renderSecuritySection(
  container: HTMLElement,
  mfaEnabled: boolean,
  onMfaChanged: () => void,
  acceptsFriendRequests: boolean,
): void {
  const mfaBody = document.createElement("div");
  renderMfaSection(mfaBody, mfaEnabled, onMfaChanged);

  const friendRequestsBody = document.createElement("div");
  renderFriendRequestsSetting(friendRequestsBody, acceptsFriendRequests);

  container.append(
    section("Two-factor authentication", mfaBody),
    section("Friend requests", friendRequestsBody),
  );
}

function renderFriendRequestsSetting(container: HTMLElement, accepts: boolean): void {
  const row = document.createElement("label");
  row.className = "toggle-row";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = accepts;

  const slider = document.createElement("span");
  slider.className = "toggle-slider";

  const status = document.createElement("span");
  status.textContent = accepts ? "Accepting friend requests" : "Not accepting friend requests";

  row.append(checkbox, slider, status);
  container.replaceChildren(row);

  checkbox.addEventListener("change", async () => {
    const next = checkbox.checked;
    checkbox.disabled = true;
    try {
      await api.patch("/api/friends/settings", { accepts_friend_requests: next });
      status.textContent = next ? "Accepting friend requests" : "Not accepting friend requests";
    } catch {
      checkbox.checked = !next;
    } finally {
      checkbox.disabled = false;
    }
  });
}

function renderMfaSection(container: HTMLElement, enabled: boolean, onChanged: () => void): void {
  const row = document.createElement("label");
  row.className = "toggle-row";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = enabled;

  const slider = document.createElement("span");
  slider.className = "toggle-slider";

  const status = document.createElement("span");
  status.textContent = enabled ? "Enabled" : "Not enabled";

  row.append(checkbox, slider, status);
  container.replaceChildren(row);

  // Flipping the switch only *starts* the enroll/disable flow (both
  // need a confirmation code) — it doesn't commit anything by itself,
  // so the box always snaps back to the last real state until that
  // flow actually finishes.
  checkbox.addEventListener("change", () => {
    checkbox.checked = enabled;
    if (enabled) {
      renderDisableForm(container, onChanged);
    } else {
      void startEnrollment(container, onChanged);
    }
  });
}

async function startEnrollment(container: HTMLElement, onChanged: () => void): Promise<void> {
  const enroll = await api.post<{ secret_base32: string; otpauth_uri: string; qr_svg: string }>(
    "/api/mfa/totp/enroll",
  );

  const wrap = document.createElement("div");

  const qrBox = document.createElement("div");
  qrBox.className = "qr-box";
  const svgDoc = new DOMParser().parseFromString(enroll.qr_svg, "image/svg+xml");
  qrBox.appendChild(document.importNode(svgDoc.documentElement, true));

  const secretLabel = document.createElement("p");
  secretLabel.className = "muted-text";
  secretLabel.textContent = "Or enter this code manually in your authenticator app:";

  const secretCode = document.createElement("div");
  secretCode.className = "secret-code";
  secretCode.textContent = enroll.secret_base32;

  const codeInput = document.createElement("input");
  codeInput.type = "text";
  codeInput.autocomplete = "one-time-code";
  codeInput.placeholder = "6-digit code";

  const error = document.createElement("p");
  error.className = "error-text";
  error.hidden = true;

  const confirmBtn = document.createElement("button");
  confirmBtn.textContent = "Confirm";
  confirmBtn.addEventListener("click", async () => {
    error.hidden = true;
    confirmBtn.disabled = true;
    try {
      const result = await api.post<{ recovery_codes: string[] }>("/api/mfa/totp/confirm", {
        code: codeInput.value.trim(),
      });
      showRecoveryCodes(container, result.recovery_codes, onChanged);
    } catch (err) {
      error.textContent = err instanceof ApiError ? err.message : "Something went wrong.";
      error.hidden = false;
    } finally {
      confirmBtn.disabled = false;
    }
  });

  wrap.append(qrBox, secretLabel, secretCode, codeInput, error, confirmBtn);
  container.replaceChildren(wrap);
}

function showRecoveryCodes(container: HTMLElement, codes: string[], onChanged: () => void): void {
  const wrap = document.createElement("div");

  const note = document.createElement("p");
  note.textContent =
    "Save these recovery codes somewhere safe. Each one works once if you lose access to your authenticator.";

  const grid = document.createElement("div");
  grid.className = "recovery-codes";
  for (const code of codes) {
    const span = document.createElement("span");
    span.textContent = code;
    grid.appendChild(span);
  }

  const doneBtn = document.createElement("button");
  doneBtn.textContent = "I've saved these";
  doneBtn.addEventListener("click", () => {
    onChanged();
    renderMfaSection(container, true, onChanged);
  });

  wrap.append(note, grid, doneBtn);
  container.replaceChildren(wrap);
}

function renderDisableForm(container: HTMLElement, onChanged: () => void): void {
  const wrap = document.createElement("div");

  const hint = document.createElement("p");
  hint.className = "muted-text";
  hint.textContent = "Enter your current 6-digit code to disable 2FA.";

  const codeInput = document.createElement("input");
  codeInput.type = "text";
  codeInput.placeholder = "6-digit code";

  const error = document.createElement("p");
  error.className = "error-text";
  error.hidden = true;

  const confirmBtn = document.createElement("button");
  confirmBtn.className = "danger";
  confirmBtn.textContent = "Disable";
  confirmBtn.addEventListener("click", async () => {
    error.hidden = true;
    confirmBtn.disabled = true;
    try {
      await api.post("/api/mfa/totp/disable", { code: codeInput.value.trim() || undefined });
      onChanged();
      renderMfaSection(container, false, onChanged);
    } catch (err) {
      error.textContent = err instanceof ApiError ? err.message : "Something went wrong.";
      error.hidden = false;
    } finally {
      confirmBtn.disabled = false;
    }
  });

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "secondary";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", () => renderMfaSection(container, true, onChanged));

  wrap.append(hint, codeInput, error, confirmBtn, cancelBtn);
  container.replaceChildren(wrap);
}
