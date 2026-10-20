// The Settings modal: the menu and page shell that hosts the sections below.

import { type User } from "../../api";
import { icon } from "../../icons";
import { renderAvatarEl } from "../../ui";
import { type VoiceClient } from "../../voice";
import { renderGlobalAdminSection } from "../global-admin";
import { renderAccountSection, renderDangerSection, renderLogoutSection } from "./account";
import { renderDevicesSection } from "./devices";
import { renderProfileSection } from "./profile";
import { renderSecuritySection } from "./security";
import { dragToDismiss, PHONE_QUERY } from "./widgets";

export type SettingsTab = "profile" | "devices" | "security" | "account" | "admin" | "logout" | "danger";

export function renderSettings(opts: {
  user: User;
  isOwner: boolean;
  mfaEnabled: boolean;
  onMfaChanged: () => void;
  onUserUpdated: (user: User) => void;
  voiceClient: VoiceClient;
  onLoggedOut: () => void;
  /** The pane to open first (the first one by default). */
  initialTab?: SettingsTab;
}): void {
  // The Devices tab keeps a live mic stream open for its level meter —
  // `activeCleanup` is however the currently-shown tab wants to stop
  // that kind of thing, called both on tab switch and on closing the
  // whole modal, so a mic capture never keeps running once its meter
  // isn't even visible anymore.
  let activeCleanup: (() => void) | undefined;

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  function close(): void {
    activeCleanup?.();
    backdrop.remove();
  }
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });

  const modal = document.createElement("div");
  modal.className = "modal settings-modal user-settings";
  backdrop.appendChild(modal);

  const closeBtn = document.createElement("button");
  closeBtn.className = "icon-button settings-close";
  closeBtn.title = "Close";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.appendChild(icon("x", 16));
  closeBtn.addEventListener("click", close);
  modal.appendChild(closeBtn);

  // On a phone this is a two-level list, like a phone's own Settings
  // app: the menu first, then one page at a time with a back button
  // (`showing-page`). On a wider screen the menu stays beside the page
  // and the class does nothing.
  const body = document.createElement("div");
  body.className = "settings-body";
  modal.appendChild(body);

  const nav = document.createElement("nav");
  nav.className = "settings-nav";
  const content = document.createElement("div");
  content.className = "settings-content";
  body.append(nav, content);

  const navIdentity = document.createElement("div");
  navIdentity.className = "settings-nav-identity";
  const identityAvatar = document.createElement("div");
  identityAvatar.className = "settings-nav-identity-avatar";
  const names = document.createElement("div");
  names.className = "settings-nav-identity-names";
  const displayName = document.createElement("div");
  displayName.className = "settings-nav-identity-name";
  const username = document.createElement("div");
  username.className = "settings-nav-identity-username";
  names.append(displayName, username);
  navIdentity.append(identityAvatar, names);
  function showIdentity(user: User): void {
    identityAvatar.replaceChildren(renderAvatarEl(user.display_name, user.avatar_file_id));
    displayName.textContent = user.display_name;
    username.textContent = `@${user.username}`;
  }
  showIdentity(opts.user);
  nav.appendChild(navIdentity);

  // Logout and Danger sit in their own group at the bottom, red-tinted
  // (see `.settings-nav-item.caution`): they're exit/destructive
  // actions, not just another settings pane.
  const tabs: { id: SettingsTab; label: string; iconName: Parameters<typeof icon>[0]; caution?: boolean }[] =
    [
      { id: "profile", label: "Profile", iconName: "user" },
      { id: "devices", label: "Devices", iconName: "headphones" },
      { id: "security", label: "Security", iconName: "shield" },
      { id: "account", label: "Account", iconName: "external-link" },
      ...(opts.isOwner
        ? [
            {
              id: "admin" as SettingsTab,
              label: "Global admin",
              iconName: "users" as Parameters<typeof icon>[0],
            },
          ]
        : []),
      { id: "logout", label: "Log out", iconName: "log-out", caution: true },
      { id: "danger", label: "Danger", iconName: "trash", caution: true },
    ];

  const onUserUpdated = (user: User): void => {
    opts.user = user;
    showIdentity(user);
    opts.onUserUpdated(user);
  };
  const renderers: Record<SettingsTab, (container: HTMLElement) => (() => void) | void> = {
    profile: (c) => renderProfileSection(c, opts.user, onUserUpdated),
    devices: (c) => renderDevicesSection(c, opts.voiceClient),
    security: (c) =>
      renderSecuritySection(c, opts.mfaEnabled, opts.onMfaChanged, opts.user.accepts_friend_requests),
    admin: (c) => renderGlobalAdminSection(c),
    account: (c) => renderAccountSection(c),
    logout: (c) => renderLogoutSection(c, opts.onLoggedOut),
    danger: (c) => renderDangerSection(c, opts.user, opts.onLoggedOut),
  };

  const backBtn = document.createElement("button");
  backBtn.type = "button";
  backBtn.className = "icon-button settings-back";
  backBtn.setAttribute("aria-label", "Back");
  backBtn.appendChild(icon("chevron-left", 22));
  backBtn.addEventListener("click", () => showMenu());

  function showMenu(): void {
    body.classList.remove("showing-page");
    nav.querySelector<HTMLElement>(".settings-nav-item.active")?.focus();
  }

  function selectTab(tab: SettingsTab): void {
    activeCleanup?.();
    activeCleanup = undefined;
    for (const btn of Array.from(nav.querySelectorAll<HTMLElement>(".settings-nav-item"))) {
      btn.classList.toggle("active", btn.dataset.tab === tab);
    }
    content.replaceChildren();
    content.scrollTop = 0;
    const header = document.createElement("div");
    header.className = "settings-page-header";
    const title = document.createElement("h2");
    title.className = "settings-page-title";
    title.textContent = tabs.find((t) => t.id === tab)?.label ?? "";
    header.append(backBtn, title);
    content.appendChild(header);
    activeCleanup = renderers[tab](content) ?? undefined;
    body.classList.add("showing-page");
  }

  function navGroup(items: typeof tabs): HTMLElement {
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
  nav.append(navGroup(tabs.filter((t) => !t.caution)), navGroup(tabs.filter((t) => t.caution)));

  // A phone opens on the menu (unless asked for a specific page); a
  // wide screen always shows a page next to it.
  const phone = window.matchMedia(PHONE_QUERY).matches;
  const initial = tabs.find((t) => t.id === opts.initialTab)?.id;
  selectTab(initial ?? tabs[0].id);
  if (phone && !initial) body.classList.remove("showing-page");

  // Phone gestures: drag a page to the right to go back to the menu,
  // and drag the menu to the right to close Settings.
  dragToDismiss({ handle: content, moving: content, axis: "x", onDismiss: showMenu });
  dragToDismiss({
    handle: nav,
    moving: modal,
    axis: "x",
    onDismiss: close,
    onProgress: (p) => (backdrop.style.backgroundColor = `rgba(8, 8, 10, ${0.7 * (1 - p)})`),
  });

  document.body.appendChild(backdrop);
}
