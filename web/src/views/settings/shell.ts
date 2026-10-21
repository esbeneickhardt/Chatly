// The settings modal shell shared by your own Settings and a server's
// settings: a menu of pages beside the current page on a wide screen; on
// a phone a sheet (grab handle, no close button) that shows the menu
// first, then one page at a time with a back button. The phone's back
// gesture steps out a page, then the sheet (see back-stack.ts); dragging
// the sheet down or the menu right closes it, dragging a page right goes
// back.

import { pushBackLayer } from "../../back-stack";
import { icon, type IconName } from "../../icons";
import { dragToDismiss, PHONE_QUERY } from "./widgets";

export interface ShellTab<T extends string> {
  id: T;
  label: string;
  iconName: IconName;
  /** Exit/destructive pages (Log out, Danger): their own red group at the bottom. */
  caution?: boolean;
  /** Draws the page into `container` (below its title); may return a cleanup. */
  render: (container: HTMLElement) => (() => void) | void;
}

export interface SettingsShell<T extends string> {
  close: () => void;
  /** The avatar, name and second line at the top of the menu. */
  setIdentity: (avatar: HTMLElement, name: string, detail: string) => void;
  /** (Re)draws the menu; keeps the page that was showing if it still exists. */
  setTabs: (tabs: ShellTab<T>[], initialTab?: T) => void;
}

export function openSettingsShell<T extends string>(opts: {
  /** Called once the sheet is gone, however it closed. */
  onClose?: () => void;
}): SettingsShell<T> {
  // A page may hold something live (the Devices page's mic meter):
  // its cleanup runs when the page changes and when the sheet closes.
  let activeCleanup: (() => void) | undefined;
  let tabs: ShellTab<T>[] = [];
  let current: T | null = null;

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  function closeUi(): void {
    activeCleanup?.();
    activeCleanup = undefined;
    backdrop.remove();
    opts.onClose?.();
  }
  const releaseSheet = pushBackLayer(closeUi);
  let releasePage: (() => void) | null = null;
  function close(): void {
    closeUi();
    releasePage = null;
    releaseSheet();
  }
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });

  const modal = document.createElement("div");
  modal.className = "modal settings-modal settings-sheet";
  backdrop.appendChild(modal);

  const closeBtn = document.createElement("button");
  closeBtn.className = "icon-button settings-close";
  closeBtn.title = "Close";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.appendChild(icon("x", 16));
  closeBtn.addEventListener("click", close);
  const grabber = document.createElement("div");
  grabber.className = "sheet-grabber";
  grabber.setAttribute("aria-hidden", "true");
  modal.append(closeBtn, grabber);

  const body = document.createElement("div");
  body.className = "settings-body";
  const nav = document.createElement("nav");
  nav.className = "settings-nav";
  const content = document.createElement("div");
  content.className = "settings-content";
  body.append(nav, content);
  modal.appendChild(body);

  const spinner = document.createElement("div");
  spinner.className = "settings-spinner";
  spinner.setAttribute("aria-label", "Loading");
  nav.appendChild(spinner);

  const navIdentity = document.createElement("div");
  navIdentity.className = "settings-nav-identity";
  const identityAvatar = document.createElement("div");
  identityAvatar.className = "settings-nav-identity-avatar";
  const names = document.createElement("div");
  names.className = "settings-nav-identity-names";
  const identityName = document.createElement("div");
  identityName.className = "settings-nav-identity-name";
  const identityDetail = document.createElement("div");
  identityDetail.className = "settings-nav-identity-username";
  names.append(identityName, identityDetail);
  navIdentity.append(identityAvatar, names);

  const backBtn = document.createElement("button");
  backBtn.type = "button";
  backBtn.className = "icon-button settings-back";
  backBtn.setAttribute("aria-label", "Back");
  backBtn.appendChild(icon("chevron-left", 22));
  backBtn.addEventListener("click", () => showMenu());

  const isPhone = (): boolean => window.matchMedia(PHONE_QUERY).matches;

  function showMenuUi(): void {
    body.classList.remove("showing-page");
    nav.querySelector<HTMLElement>(".settings-nav-item.active")?.focus();
  }
  function showMenu(): void {
    showMenuUi();
    releasePage?.();
    releasePage = null;
  }

  function selectTab(id: T, opensPage = true): void {
    const tab = tabs.find((t) => t.id === id);
    if (!tab) return;
    current = id;
    activeCleanup?.();
    activeCleanup = undefined;
    for (const btn of Array.from(nav.querySelectorAll<HTMLElement>(".settings-nav-item"))) {
      btn.classList.toggle("active", btn.dataset.tab === id);
    }
    content.replaceChildren();
    content.scrollTop = 0;
    const header = document.createElement("div");
    header.className = "settings-page-header";
    const title = document.createElement("h2");
    title.className = "settings-page-title";
    title.textContent = tab.label;
    header.append(backBtn, title);
    content.appendChild(header);
    activeCleanup = tab.render(content) ?? undefined;
    if (!opensPage) {
      body.classList.remove("showing-page");
      return;
    }
    body.classList.add("showing-page");
    if (!releasePage && isPhone()) {
      releasePage = pushBackLayer(() => {
        releasePage = null;
        showMenuUi();
      });
    }
  }

  function navGroup(items: ShellTab<T>[]): HTMLElement {
    const groupEl = document.createElement("div");
    groupEl.className = "settings-nav-group";
    for (const tab of items) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = tab.caution ? "settings-nav-item caution" : "settings-nav-item";
      btn.dataset.tab = tab.id;
      const label = document.createElement("span");
      label.className = "settings-nav-item-label";
      label.textContent = tab.label;
      const chevron = icon("chevron-right", 16);
      chevron.classList.add("settings-nav-chevron");
      btn.append(icon(tab.iconName, 16), label, chevron);
      btn.addEventListener("click", () => selectTab(tab.id));
      groupEl.appendChild(btn);
    }
    return groupEl;
  }

  // Phone gestures (see the file comment).
  const fadeBackdrop = (p: number): void => {
    backdrop.style.backgroundColor = `rgba(8, 8, 10, ${0.7 * (1 - p)})`;
  };
  dragToDismiss({
    handle: modal,
    moving: modal,
    axis: "y",
    onDismiss: close,
    onProgress: fadeBackdrop,
    canStart: () => (body.classList.contains("showing-page") ? content : nav).scrollTop <= 0,
  });
  // A page with its own sideways swipe (Global admin's tabs) keeps it,
  // except where that swipe has nowhere further back to go.
  dragToDismiss({
    handle: content,
    moving: content,
    axis: "x",
    onDismiss: showMenu,
    canStart: (target) => !target.closest("[data-swipe-tabs]:not([data-first-tab])"),
  });
  dragToDismiss({ handle: nav, moving: modal, axis: "x", onDismiss: close, onProgress: fadeBackdrop });

  document.body.appendChild(backdrop);

  return {
    close,
    setIdentity: (avatar, name, detail) => {
      identityAvatar.replaceChildren(avatar);
      identityName.textContent = name;
      identityDetail.textContent = detail;
    },
    setTabs: (next, initialTab) => {
      const wasShowingPage = body.classList.contains("showing-page");
      tabs = next;
      nav.replaceChildren(
        navIdentity,
        navGroup(tabs.filter((t) => !t.caution)),
        navGroup(tabs.filter((t) => t.caution)),
      );
      const keep = current && tabs.some((t) => t.id === current) ? current : null;
      const target = keep ?? (tabs.some((t) => t.id === initialTab) ? initialTab : undefined);
      // A phone opens on the menu unless a page was asked for (or was
      // already showing); a wide screen always shows a page beside it.
      const opensPage = !isPhone() || (keep ? wasShowingPage : Boolean(target));
      if (tabs.length > 0) selectTab(target ?? tabs[0].id, opensPage);
    },
  };
}
