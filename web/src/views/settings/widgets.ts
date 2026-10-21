// Building blocks shared by the Settings sections: grouped lists of
// rows (a value on the right, tap to change), switches, and a small
// form dialog that only appears once something is actually edited.

import { ApiError } from "../../api";
import { pushBackLayer } from "../../back-stack";
import { icon } from "../../icons";

export function field(labelText: string): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.className = "field";
  const label = document.createElement("label");
  label.textContent = labelText;
  wrap.appendChild(label);
  return wrap;
}

/** A password `<input>` with an eye toggle to reveal what you typed.
 * Defaults to masked; toggling only flips `type`. */
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

/** A titled card of rows, the unit every settings page is built from. */
export function group(heading: string | null, ...children: (Node | null)[]): HTMLElement {
  const el = document.createElement("section");
  el.className = "settings-group";
  if (heading) {
    const h = document.createElement("h3");
    h.className = "settings-group-title";
    h.textContent = heading;
    el.appendChild(h);
  }
  const card = document.createElement("div");
  card.className = "settings-card";
  card.append(...children.filter((c): c is Node => c !== null));
  el.appendChild(card);
  return el;
}

export interface SettingsRow {
  el: HTMLElement;
  setValue: (text: string) => void;
}

/** One row: label on the left, an optional value on the right. With
 * `onClick` the whole row is a button with a chevron, unless it's an
 * `action` row (a plain command like "Log out"). */
export function row(opts: {
  label: string;
  value?: string;
  onClick?: () => void;
  danger?: boolean;
  action?: boolean;
}): SettingsRow {
  const el = document.createElement(opts.onClick ? "button" : "div");
  if (el instanceof HTMLButtonElement) el.type = "button";
  el.className = "settings-row";
  if (opts.onClick) el.classList.add("clickable");
  if (opts.danger) el.classList.add("danger");
  if (opts.action) el.classList.add("action");

  const label = document.createElement("span");
  label.className = "settings-row-label";
  label.textContent = opts.label;
  const value = document.createElement("span");
  value.className = "settings-row-value";
  value.textContent = opts.value ?? "";
  el.append(label, value);
  if (opts.onClick && !opts.action) {
    const chevron = icon("chevron-right", 16);
    chevron.classList.add("settings-row-chevron");
    el.appendChild(chevron);
  }
  if (opts.onClick) el.addEventListener("click", opts.onClick);
  return { el, setValue: (text) => (value.textContent = text) };
}

/** A label + switch row. `onChange` gets the new state; returning
 * false (or throwing) puts the switch back. */
export function switchRow(
  label: string,
  checked: boolean,
  onChange: (next: boolean) => void | boolean | Promise<void | boolean>,
): { el: HTMLLabelElement; input: HTMLInputElement } {
  const el = document.createElement("label");
  el.className = "settings-row switch-row";
  const text = document.createElement("span");
  text.className = "settings-row-label";
  text.textContent = label;
  const input = document.createElement("input");
  input.type = "checkbox";
  input.setAttribute("role", "switch");
  input.checked = checked;
  const slider = document.createElement("span");
  slider.className = "toggle-slider";
  el.append(text, input, slider);
  input.addEventListener("change", async () => {
    const next = input.checked;
    input.disabled = true;
    try {
      const ok = await onChange(next);
      if (ok === false) input.checked = !next;
    } catch {
      input.checked = !next;
    } finally {
      input.disabled = false;
    }
  });
  return { el, input };
}

/** A label with a native `<select>` styled as the row's value. */
export function selectRow(label: string, select: HTMLSelectElement): HTMLElement {
  const el = document.createElement("label");
  el.className = "settings-row select-row";
  const text = document.createElement("span");
  text.className = "settings-row-label";
  text.textContent = label;
  el.append(text, select);
  return el;
}

/** A label + slider with a % readout, stacked in one row. */
export function sliderRow(
  label: string,
  value: number,
  onInput: (value: number) => void,
  max = 1,
): { el: HTMLElement; slider: HTMLInputElement } {
  const el = document.createElement("div");
  el.className = "settings-row slider-row";
  const top = document.createElement("div");
  top.className = "slider-row-top";
  const text = document.createElement("span");
  text.className = "settings-row-label";
  text.textContent = label;
  const readout = document.createElement("span");
  readout.className = "settings-row-value";
  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = "0";
  slider.max = String(Math.round(max * 100));
  slider.step = "5";
  slider.value = String(Math.round(value * 100));
  slider.setAttribute("aria-label", label);
  readout.textContent = `${slider.value}%`;
  top.append(text, readout);
  el.append(top, slider);
  slider.addEventListener("input", () => {
    readout.textContent = `${slider.value}%`;
    onInput(Number(slider.value) / 100);
  });
  return { el, slider };
}

export function levelMeter(): { el: HTMLElement; fill: HTMLElement } {
  const el = document.createElement("div");
  el.className = "level-meter";
  const fill = document.createElement("div");
  fill.className = "level-meter-fill";
  el.appendChild(fill);
  return { el, fill };
}

export interface FormDialog {
  body: HTMLElement;
  actions: HTMLElement;
  submitBtn: HTMLButtonElement;
  close: () => void;
  showError: (message: string) => void;
}

/** A small dialog over Settings for one edit (a name, a password, a
 * delete). `onSubmit` resolves to an error message to show, null to
 * close, or undefined to stay open (a multi-step flow that swapped the
 * dialog's own content). Enter submits; Escape and the backdrop cancel;
 * focus starts on the first input. */
export function formDialog(opts: {
  title: string;
  content: Node[];
  submitLabel: string;
  danger?: boolean;
  /** Put the cursor in the first field (default). Off for a dialog of
   * switches, where it would only pop up a phone's keyboard. */
  focusField?: boolean;
  onSubmit: (dialog: FormDialog) => Promise<string | null | undefined>;
}): FormDialog {
  const previouslyFocused = document.activeElement as HTMLElement | null;
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop form-dialog-backdrop";
  const modal = document.createElement("form");
  modal.className = "modal form-dialog";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-label", opts.title);
  modal.noValidate = true;

  const title = document.createElement("h3");
  title.className = "form-dialog-title";
  title.textContent = opts.title;

  const body = document.createElement("div");
  body.className = "form-dialog-body";
  body.append(...opts.content);

  const error = document.createElement("p");
  error.className = "error-text";
  error.hidden = true;
  error.setAttribute("aria-live", "polite");

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "secondary";
  cancelBtn.textContent = "Cancel";

  const submitBtn = document.createElement("button");
  submitBtn.type = "submit";
  if (opts.danger) submitBtn.className = "danger";
  submitBtn.textContent = opts.submitLabel;

  const actions = document.createElement("div");
  actions.className = "modal-actions";
  actions.append(cancelBtn, submitBtn);

  const grabber = document.createElement("div");
  grabber.className = "sheet-grabber";
  grabber.setAttribute("aria-hidden", "true");
  modal.append(grabber, title, body, error, actions);
  backdrop.appendChild(modal);

  function onKeyDown(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  }
  function closeUi(): void {
    document.removeEventListener("keydown", onKeyDown, true);
    backdrop.remove();
    previouslyFocused?.focus?.();
  }
  // The phone's back button/gesture cancels it too.
  const releaseBack = pushBackLayer(closeUi);
  function close(): void {
    closeUi();
    releaseBack();
  }

  const dialog: FormDialog = {
    body,
    actions,
    submitBtn,
    close,
    showError: (message) => {
      error.textContent = message;
      error.hidden = false;
    },
  };

  cancelBtn.addEventListener("click", close);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });
  modal.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (submitBtn.disabled) return;
    error.hidden = true;
    submitBtn.disabled = true;
    try {
      const message = await opts.onSubmit(dialog);
      if (message) dialog.showError(message);
      else if (message === null) close();
    } finally {
      submitBtn.disabled = false;
    }
  });
  document.addEventListener("keydown", onKeyDown, true);
  document.body.appendChild(backdrop);
  // On a phone it's a bottom sheet: drag it down to cancel.
  dragToDismiss({
    handle: modal,
    moving: modal,
    axis: "y",
    onDismiss: close,
    canStart: () => modal.scrollTop <= 0,
  });
  const firstField = (opts.focusField ?? true) ? modal.querySelector<HTMLElement>("input, select") : null;
  (firstField ?? submitBtn).focus();
  return dialog;
}

/** A labelled text input for a `formDialog`. */
export function textField(label: string, value = ""): { el: HTMLElement; input: HTMLInputElement } {
  const el = field(label);
  const input = document.createElement("input");
  input.type = "text";
  input.value = value;
  el.appendChild(input);
  return { el, input };
}

/** A labelled password input for a `formDialog`. */
export function passwordField(
  label: string,
  autocomplete?: "current-password" | "new-password",
): { el: HTMLElement; input: HTMLInputElement } {
  const el = field(label);
  const { wrap, input } = passwordBox(autocomplete);
  el.appendChild(wrap);
  return { el, input };
}

/** "Something went wrong" from any thrown API error. */
export function errorMessage(err: unknown, fallback = "Something went wrong."): string {
  return err instanceof ApiError ? err.message : fallback;
}

export const PHONE_QUERY = "(max-width: 768px)";

/** Lets a finger drag `moving` away (right on `x`, down on `y`) by
 * touching `handle`: it follows the finger, and past a quarter of its
 * size (or on a quick flick) it slides the rest of the way out and
 * calls `onDismiss`; otherwise it springs back. Only on the phone
 * layout, and never from a slider, a select or a text field, whose own
 * drags mean something else. */
export function dragToDismiss(opts: {
  handle: HTMLElement;
  moving: HTMLElement;
  axis: "x" | "y";
  onDismiss: () => void;
  /** Extra gate, checked as the touch starts (e.g. "scrolled to the top"). */
  canStart?: (target: HTMLElement) => boolean;
  /** Called with 0..1 while dragging, for a fading backdrop. */
  onProgress?: (progress: number) => void;
}): void {
  const { handle, moving, axis } = opts;
  let startX = 0;
  let startY = 0;
  let startTime = 0;
  let state: "idle" | "pending" | "dragging" = "idle";
  let offset = 0;

  const size = (): number => (axis === "x" ? moving.offsetWidth : moving.offsetHeight) || 1;
  const place = (px: number, animate: boolean): void => {
    moving.style.transition = animate ? "transform 0.2s ease" : "none";
    moving.style.transform = px ? (axis === "x" ? `translateX(${px}px)` : `translateY(${px}px)`) : "";
    opts.onProgress?.(Math.min(1, px / size()));
  };

  handle.addEventListener(
    "touchstart",
    (e) => {
      state = "idle";
      if (e.touches.length !== 1 || !window.matchMedia(PHONE_QUERY).matches) return;
      const target = e.target as HTMLElement;
      if (target.closest("input, select, textarea, .segmented")) return;
      if (opts.canStart && !opts.canStart(target)) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      startTime = performance.now();
      offset = 0;
      state = "pending";
    },
    { passive: true },
  );
  handle.addEventListener(
    "touchmove",
    (e) => {
      if (state === "idle") return;
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;
      const along = axis === "x" ? dx : dy;
      const across = axis === "x" ? dy : dx;
      if (state === "pending") {
        if (Math.abs(along) < 8 && Math.abs(across) < 8) return;
        // The other direction (or backwards) is a scroll, not a dismiss.
        if (Math.abs(across) > Math.abs(along) || along < 0) {
          state = "idle";
          return;
        }
        state = "dragging";
      }
      offset = Math.max(0, along);
      place(offset, false);
    },
    { passive: true },
  );
  const end = (): void => {
    if (state !== "dragging") {
      state = "idle";
      return;
    }
    state = "idle";
    const velocity = offset / Math.max(1, performance.now() - startTime);
    if (offset > size() / 4 || (velocity > 0.6 && offset > 30)) {
      place(size(), true);
      window.setTimeout(() => {
        opts.onDismiss();
        place(0, false);
      }, 200);
    } else {
      place(0, true);
    }
  };
  handle.addEventListener("touchend", end);
  handle.addEventListener("touchcancel", end);
}
