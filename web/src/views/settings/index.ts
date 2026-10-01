// The Settings modal: the tab shell that hosts the sections below.

import { type User } from "../../api";
import { icon } from "../../icons";
import { renderAvatarEl } from "../../ui";
import { type VoiceClient } from "../../voice";
import { renderGlobalAdminSection } from "../global-admin";
import { renderAccountSection, renderDangerSection, renderLogoutSection } from "./account";
import { renderDevicesSection } from "./devices";
import { renderProfileSection } from "./profile";
import { renderSecuritySection } from "./security";

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
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) {
      activeCleanup?.();
      backdrop.remove();
    }
  });

  const modal = document.createElement("div");
  modal.className = "modal settings-modal";
  backdrop.appendChild(modal);

  const closeBtn = document.createElement("button");
  closeBtn.className = "icon-button settings-close";
  closeBtn.title = "Close";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.appendChild(icon("x", 16));
  closeBtn.addEventListener("click", () => {
    activeCleanup?.();
    backdrop.remove();
  });
  modal.appendChild(closeBtn);

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
  navIdentity.append(
    renderAvatarEl(opts.user.display_name, opts.user.avatar_file_id),
    (() => {
      const names = document.createElement("div");
      const displayName = document.createElement("div");
      displayName.className = "settings-nav-identity-name";
      displayName.textContent = opts.user.display_name;
      const username = document.createElement("div");
      username.className = "settings-nav-identity-username";
      username.textContent = `@${opts.user.username}`;
      names.append(displayName, username);
      return names;
    })(),
  );
  nav.appendChild(navIdentity);

  // Logout and Danger sit apart from the rest, at the very bottom of
  // the nav, and get a red-tinted treatment (see `.settings-nav-item.
  // caution` below) — neither is "just another settings pane," they're
  // exit/destructive actions, and grouping + coloring them apart from
  // Profile/Devices/Security/Account is what actually signals that.
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
      { id: "logout", label: "Logout", iconName: "log-out", caution: true },
      { id: "danger", label: "Danger", iconName: "trash", caution: true },
    ];

  const renderers: Record<SettingsTab, (container: HTMLElement) => (() => void) | void> = {
    profile: (c) => renderProfileSection(c, opts.user, opts.onUserUpdated),
    devices: (c) => renderDevicesSection(c, opts.voiceClient),
    security: (c) =>
      renderSecuritySection(c, opts.mfaEnabled, opts.onMfaChanged, opts.user.accepts_friend_requests),
    admin: (c) => renderGlobalAdminSection(c),
    account: (c) => renderAccountSection(c),
    logout: (c) => renderLogoutSection(c, opts.onLoggedOut),
    danger: (c) => renderDangerSection(c, opts.user, opts.onLoggedOut),
  };

  let currentTabId: SettingsTab = tabs[0].id;
  function selectTab(tab: SettingsTab): void {
    currentTabId = tab;
    activeCleanup?.();
    activeCleanup = undefined;
    for (const btn of Array.from(nav.children)) {
      (btn as HTMLElement).classList.toggle("active", (btn as HTMLElement).dataset.tab === tab);
    }
    content.replaceChildren();
    // Each pane gets its own page title instead of one modal-wide
    // "Settings" heading that never said which pane you were even
    // looking at — the nav's own highlighted item already did that
    // job redundantly once you're actually inside a pane.
    const title = document.createElement("h2");
    title.className = "settings-page-title";
    title.textContent = tabs.find((t) => t.id === tab)?.label ?? "";
    content.appendChild(title);
    activeCleanup = renderers[tab](content) ?? undefined;
  }

  const firstCautionId = tabs.find((t) => t.caution)?.id;
  const navButtons = tabs.map((tab) => {
    const btn = document.createElement("button");
    btn.type = "button";
    let className = tab.caution ? "settings-nav-item caution" : "settings-nav-item";
    if (tab.id === firstCautionId) className += " caution-first";
    btn.className = className;
    btn.dataset.tab = tab.id;
    btn.append(icon(tab.iconName, 15), document.createTextNode(tab.label));
    btn.addEventListener("click", () => selectTab(tab.id));
    return btn;
  });
  nav.append(...navButtons);
  selectTab(tabs.find((t) => t.id === opts.initialTab)?.id ?? tabs[0].id);

  // Swipe left/right to move between adjacent tabs — see the matching
  // gesture (and its fuller comment) in guild-settings.ts's own
  // `renderManageServerModal`, which this mirrors exactly.
  let tabSwipeStartX = 0;
  let tabSwipeStartY = 0;
  let tabSwiping = false;
  content.addEventListener(
    "touchstart",
    (e) => {
      if (e.touches.length !== 1) return;
      tabSwipeStartX = e.touches[0].clientX;
      tabSwipeStartY = e.touches[0].clientY;
      tabSwiping = true;
    },
    { passive: true },
  );
  content.addEventListener(
    "touchmove",
    (e) => {
      if (!tabSwiping) return;
      const dx = e.touches[0].clientX - tabSwipeStartX;
      const dy = e.touches[0].clientY - tabSwipeStartY;
      if (Math.abs(dy) > Math.abs(dx)) {
        tabSwiping = false;
      }
    },
    { passive: true },
  );
  content.addEventListener("touchend", (e) => {
    if (!tabSwiping) return;
    tabSwiping = false;
    const dx = (e.changedTouches[0]?.clientX ?? tabSwipeStartX) - tabSwipeStartX;
    const SWIPE_THRESHOLD_PX = 60;
    if (Math.abs(dx) < SWIPE_THRESHOLD_PX) return;
    const index = tabs.findIndex((t) => t.id === currentTabId);
    if (dx < 0 && index < tabs.length - 1) selectTab(tabs[index + 1].id);
    else if (dx > 0 && index > 0) selectTab(tabs[index - 1].id);
  });

  document.body.appendChild(backdrop);
}
