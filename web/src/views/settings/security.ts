// Settings → Security: two-factor authentication and friend-request privacy.

import { api } from "../../api";
import { errorMessage, field, formDialog, group, switchRow } from "./widgets";

export function renderSecuritySection(
  container: HTMLElement,
  mfaEnabled: boolean,
  onMfaChanged: () => void,
  acceptsFriendRequests: boolean,
): void {
  // Flipping the switch only *starts* the enroll/disable flow (both
  // need a confirmation code), so it snaps back until that flow
  // actually finishes.
  const mfaRow = switchRow("Two-factor authentication", mfaEnabled, (next) => {
    const done = (): void => {
      mfaEnabled = next;
      mfaRow.input.checked = next;
      onMfaChanged();
    };
    if (next) void startEnrollment(done);
    else disableDialog(done);
    return false;
  });

  const friendRow = switchRow("Accept friend requests", acceptsFriendRequests, async (next) => {
    await api.patch("/api/friends/settings", { accepts_friend_requests: next });
  });

  container.append(group("Sign-in", mfaRow.el), group("Privacy", friendRow.el));
}

function codeInput(): { el: HTMLElement; input: HTMLInputElement } {
  const el = field("Code from your authenticator app");
  const input = document.createElement("input");
  input.type = "text";
  input.inputMode = "numeric";
  input.autocomplete = "one-time-code";
  input.placeholder = "123456";
  el.appendChild(input);
  return { el, input };
}

async function startEnrollment(onEnabled: () => void): Promise<void> {
  let enroll: { secret_base32: string; otpauth_uri: string; qr_svg: string };
  try {
    enroll = await api.post("/api/mfa/totp/enroll");
  } catch {
    return;
  }

  const qrBox = document.createElement("div");
  qrBox.className = "qr-box";
  const svgDoc = new DOMParser().parseFromString(enroll.qr_svg, "image/svg+xml");
  qrBox.appendChild(document.importNode(svgDoc.documentElement, true));

  const secretCode = document.createElement("div");
  secretCode.className = "secret-code";
  secretCode.textContent = enroll.secret_base32;

  const code = codeInput();
  let codes: string[] | null = null;

  formDialog({
    title: "Set up two-factor authentication",
    content: [qrBox, secretCode, code.el],
    submitLabel: "Enable",
    onSubmit: async (dialog) => {
      if (codes) return null;
      try {
        const result = await api.post<{ recovery_codes: string[] }>("/api/mfa/totp/confirm", {
          code: code.input.value.trim(),
        });
        codes = result.recovery_codes;
      } catch (err) {
        return errorMessage(err);
      }
      onEnabled();
      // Second step in the same dialog: the one-time recovery codes.
      const heading = field("Recovery codes");
      const grid = document.createElement("div");
      grid.className = "recovery-codes";
      for (const recovery of codes) {
        const span = document.createElement("span");
        span.textContent = recovery;
        grid.appendChild(span);
      }
      heading.appendChild(grid);
      dialog.body.replaceChildren(heading);
      dialog.actions.querySelector<HTMLButtonElement>("button.secondary")?.remove();
      dialog.submitBtn.textContent = "I've saved these";
      return undefined;
    },
  });
}

function disableDialog(onDisabled: () => void): void {
  const code = codeInput();
  formDialog({
    title: "Turn off two-factor authentication",
    content: [code.el],
    submitLabel: "Turn off",
    danger: true,
    onSubmit: async () => {
      try {
        await api.post("/api/mfa/totp/disable", { code: code.input.value.trim() || undefined });
      } catch (err) {
        return errorMessage(err);
      }
      onDisabled();
      return null;
    },
  });
}
