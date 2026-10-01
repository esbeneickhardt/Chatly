// Small form widgets shared by the Settings sections.

import { icon } from "../../icons";

export function field(labelText: string): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.className = "field";
  const label = document.createElement("label");
  label.textContent = labelText;
  wrap.appendChild(label);
  return wrap;
}

/** A password `<input>` with an eye toggle to reveal what you typed —
 * every password field in Settings uses this, not just one of them,
 * since there's no reason a typo is easier to spot in one than
 * another. Defaults to masked; toggling never resubmits or clears
 * anything, just flips `type` between `password`/`text`. */
export function passwordBox(autocomplete?: "current-password" | "new-password"): {
  wrap: HTMLElement;
  input: HTMLInputElement;
} {
  const wrap = document.createElement("div");
  wrap.className = "password-input-row";

  const input = document.createElement("input");
  input.type = "password";
  if (autocomplete) input.autocomplete = autocomplete;

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "icon-button password-toggle";
  toggle.tabIndex = -1;
  toggle.setAttribute("aria-label", "Show password");
  toggle.appendChild(icon("eye"));
  toggle.addEventListener("click", () => {
    const nowVisible = input.type === "password";
    input.type = nowVisible ? "text" : "password";
    toggle.replaceChildren(icon(nowVisible ? "eye-off" : "eye"));
    toggle.setAttribute("aria-label", nowVisible ? "Hide password" : "Show password");
  });

  wrap.append(input, toggle);
  return { wrap, input };
}

/** A titled group with consistent spacing — the settings tabs are just
 * a handful of these stacked, so this is the one place controlling the
 * vertical rhythm between them instead of each section improvising its
 * own margins. */
export function section(heading: string, ...children: (Node | null)[]): HTMLElement {
  const el = document.createElement("section");
  el.className = "settings-section";
  const h = document.createElement("h3");
  h.textContent = heading;
  el.append(h, ...children.filter((c): c is Node => c !== null));
  return el;
}

/** One "field + save button + inline error" row, shared by the
 * display-name and username editors below — same shape, different
 * validation/endpoint. */
export function editableField(opts: {
  label: string;
  initialValue: string;
  save: (value: string) => Promise<{ ok: true; value: string } | { ok: false; message: string }>;
}): HTMLElement {
  const wrap = field(opts.label);
  const row = document.createElement("div");
  row.className = "editable-field-row";
  const input = document.createElement("input");
  input.type = "text";
  input.value = opts.initialValue;
  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.textContent = "Save";
  saveBtn.disabled = true;
  row.append(input, saveBtn);
  const error = document.createElement("p");
  error.className = "error-text";
  error.hidden = true;
  wrap.append(row, error);

  let currentValue = opts.initialValue;
  input.addEventListener("input", () => {
    saveBtn.disabled = input.value.trim() === currentValue || input.value.trim().length === 0;
    error.hidden = true;
  });
  saveBtn.addEventListener("click", async () => {
    saveBtn.disabled = true;
    error.hidden = true;
    const outcome = await opts.save(input.value.trim());
    if (outcome.ok) {
      currentValue = outcome.value;
      input.value = outcome.value;
      const original = saveBtn.textContent;
      saveBtn.textContent = "Saved";
      setTimeout(() => {
        saveBtn.textContent = original;
      }, 1200);
    } else {
      error.textContent = outcome.message;
      error.hidden = false;
      saveBtn.disabled = false;
    }
  });

  return wrap;
}

export function levelMeter(): { el: HTMLElement; fill: HTMLElement } {
  const el = document.createElement("div");
  el.className = "level-meter";
  const fill = document.createElement("div");
  fill.className = "level-meter-fill";
  el.appendChild(fill);
  return { el, fill };
}

/** A password field + Confirm/Cancel row — the tail end the Delete
 * Account panel shares with the pattern Transfer Ownership also uses. */
export function passwordConfirmRow(opts: {
  confirmLabel: string;
  onConfirm: (password: string, confirmBtn: HTMLButtonElement, errorEl: HTMLElement) => void;
  onCancel: () => void;
}): {
  passwordField: HTMLElement;
  actions: HTMLElement;
  error: HTMLElement;
  passwordInput: HTMLInputElement;
} {
  const passwordField = field("Confirm your password");
  const { wrap: passwordWrap, input: passwordInput } = passwordBox();
  passwordField.appendChild(passwordWrap);

  const error = document.createElement("p");
  error.className = "error-text";
  error.hidden = true;

  const confirmBtn = document.createElement("button");
  confirmBtn.type = "button";
  confirmBtn.className = "danger";
  confirmBtn.textContent = opts.confirmLabel;
  confirmBtn.addEventListener("click", () => {
    if (!passwordInput.value) return;
    opts.onConfirm(passwordInput.value, confirmBtn, error);
  });

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "secondary";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", opts.onCancel);

  const actions = document.createElement("div");
  actions.className = "reveal-panel-actions";
  actions.append(cancelBtn, confirmBtn);

  return { passwordField, actions, error, passwordInput };
}
