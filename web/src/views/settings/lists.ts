// Lists of people or servers in settings: one row each (avatar, name, a
// second line, a badge), and tapping a row opens an action sheet with
// what can be done to it, instead of every row carrying its own buttons.

import { pushBackLayer } from "../../back-stack";
import { icon } from "../../icons";
import { dragToDismiss } from "./widgets";

export function entityRow(opts: {
  avatar: HTMLElement;
  name: string;
  detail?: string;
  badge?: string;
  onClick?: () => void;
}): HTMLElement {
  const el = document.createElement(opts.onClick ? "button" : "div");
  if (el instanceof HTMLButtonElement) el.type = "button";
  el.className = "settings-row entity-row";
  if (opts.onClick) el.classList.add("clickable");
  const text = document.createElement("span");
  text.className = "entity-row-text";
  const name = document.createElement("span");
  name.className = "entity-row-name";
  name.textContent = opts.name;
  text.appendChild(name);
  if (opts.detail) {
    const detail = document.createElement("span");
    detail.className = "entity-row-detail";
    detail.textContent = opts.detail;
    text.appendChild(detail);
  }
  el.append(opts.avatar, text);
  if (opts.badge) {
    const badge = document.createElement("span");
    badge.className = "session-badge";
    badge.textContent = opts.badge;
    el.appendChild(badge);
  }
  if (opts.onClick) {
    const chevron = icon("chevron-right", 16);
    chevron.classList.add("settings-row-chevron");
    el.appendChild(chevron);
    el.addEventListener("click", opts.onClick);
  }
  return el;
}

export interface SheetAction {
  label: string;
  danger?: boolean;
  /** Runs after the sheet has closed (it may open a dialog of its own). */
  run: () => void;
}

/** What can be done to one person or server: a bottom sheet on a phone,
 * a small dialog on a wide screen. Back, Escape, the backdrop or a
 * downward drag close it. */
export function actionSheet(opts: {
  avatar: HTMLElement;
  title: string;
  detail?: string;
  actions: SheetAction[];
  /** Shown under the actions, e.g. a just-reset password. */
  extra?: HTMLElement;
}): { close: () => void; body: HTMLElement } {
  const previouslyFocused = document.activeElement as HTMLElement | null;
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop form-dialog-backdrop";
  const sheet = document.createElement("div");
  sheet.className = "modal form-dialog action-sheet";
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.setAttribute("aria-label", opts.title);

  const grabber = document.createElement("div");
  grabber.className = "sheet-grabber";
  grabber.setAttribute("aria-hidden", "true");

  const head = document.createElement("div");
  head.className = "action-sheet-head";
  const text = document.createElement("div");
  text.className = "entity-row-text";
  const title = document.createElement("span");
  title.className = "entity-row-name";
  title.textContent = opts.title;
  text.appendChild(title);
  if (opts.detail) {
    const detail = document.createElement("span");
    detail.className = "entity-row-detail";
    detail.textContent = opts.detail;
    text.appendChild(detail);
  }
  head.append(opts.avatar, text);

  const body = document.createElement("div");
  body.className = "action-sheet-body";
  const list = document.createElement("div");
  list.className = "settings-card";
  for (const action of opts.actions) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `settings-row clickable action${action.danger ? " danger" : ""}`;
    const label = document.createElement("span");
    label.className = "settings-row-label";
    label.textContent = action.label;
    btn.appendChild(label);
    btn.addEventListener("click", () => {
      close();
      action.run();
    });
    list.appendChild(btn);
  }
  body.appendChild(list);
  if (opts.extra) body.appendChild(opts.extra);
  sheet.append(grabber, head, body);
  backdrop.appendChild(sheet);

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
  const releaseBack = pushBackLayer(closeUi);
  function close(): void {
    closeUi();
    releaseBack();
  }
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });
  document.addEventListener("keydown", onKeyDown, true);
  document.body.appendChild(backdrop);
  dragToDismiss({
    handle: sheet,
    moving: sheet,
    axis: "y",
    onDismiss: close,
    canStart: () => sheet.scrollTop <= 0,
  });
  list.querySelector<HTMLElement>("button")?.focus();
  return { close, body };
}
