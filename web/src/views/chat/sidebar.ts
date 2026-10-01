// The sidebar: the server rail, the sidebar header and its buttons, the
// channel/conversation list container, the mobile server list, and the
// footer with your profile chip and call buttons. Built once and handed
// back as a set of named elements for the rest of the screen to wire up.

import { type User } from "../../api";
import { icon } from "../../icons";
import { renderAvatarEl } from "../../ui";

/** What this part of the chat screen needs from the rest of it. */
export interface createSidebarContext {
  user: User;
  closeMobileNav: () => void;
}

export function createSidebar(ctx: createSidebarContext) {
  const { user, closeMobileNav } = ctx;

  const shell = document.createElement("div");
  shell.className = "app-shell";

  const guildRail = document.createElement("div");
  guildRail.className = "guild-rail";
  guildRail.setAttribute("role", "navigation");
  guildRail.setAttribute("aria-label", "Servers");
  // Deliberately *not* closing the mobile drawer on a guild-rail click
  // (unlike `channelList` below) — switching servers just refreshes
  // which channels are listed in the sidebar, still within the
  // drawer; the user hasn't actually navigated anywhere yet until
  // they pick one of those channels.

  const homeIcon = document.createElement("div");
  homeIcon.className = "guild-icon";
  homeIcon.appendChild(icon("message-circle", 22));
  homeIcon.title = "Direct messages";

  const addServerBtn = document.createElement("div");
  addServerBtn.className = "guild-icon action";
  addServerBtn.appendChild(icon("plus", 22));
  addServerBtn.title = "Add a server";

  const sidebar = document.createElement("div");
  sidebar.className = "sidebar";
  sidebar.setAttribute("role", "navigation");
  sidebar.setAttribute("aria-label", "Channels and conversations");

  const SIDEBAR_WIDTH_KEY = "chatty:sidebarWidth";
  const SIDEBAR_MIN_WIDTH = 180;
  const SIDEBAR_MAX_WIDTH = 480;
  const savedSidebarWidth = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY));
  if (savedSidebarWidth >= SIDEBAR_MIN_WIDTH && savedSidebarWidth <= SIDEBAR_MAX_WIDTH) {
    sidebar.style.setProperty("--sidebar-width", `${savedSidebarWidth}px`);
  }

  const sidebarResizeHandle = document.createElement("div");
  sidebarResizeHandle.className = "sidebar-resize-handle";
  sidebarResizeHandle.addEventListener("mousedown", (startEvent) => {
    startEvent.preventDefault();
    sidebarResizeHandle.classList.add("dragging");
    const onMove = (moveEvent: MouseEvent) => {
      const width = Math.min(
        SIDEBAR_MAX_WIDTH,
        Math.max(SIDEBAR_MIN_WIDTH, moveEvent.clientX - sidebar.getBoundingClientRect().left),
      );
      sidebar.style.setProperty("--sidebar-width", `${width}px`);
    };
    const onUp = () => {
      sidebarResizeHandle.classList.remove("dragging");
      localStorage.setItem(SIDEBAR_WIDTH_KEY, sidebar.getBoundingClientRect().width.toString());
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  });

  const sidebarHeader = document.createElement("div");
  sidebarHeader.className = "sidebar-header";

  const sidebarHeaderName = document.createElement("span");
  sidebarHeaderName.className = "sidebar-header-name";

  // Mobile only (see CSS): the desktop guild-rail's 76px column of
  // icon-only server switching, permanently docked beside a
  // correspondingly squeezed channel list, doesn't read as
  // "information" on a phone screen the way a name does — a classical
  // messenger app's "pick a conversation" screen shows one full-width
  // list, not two narrow columns side by side. Tapping this swaps the
  // drawer over to that full-width list (`mobileServerList` below)
  // instead; picking a server or Home there swaps back to the channel
  // list automatically.
  const mobileServerListBtn = document.createElement("button");
  mobileServerListBtn.type = "button";
  mobileServerListBtn.className = "icon-button mobile-server-list-btn";
  mobileServerListBtn.title = "Switch server";
  mobileServerListBtn.appendChild(icon("chevron-down", 14));

  const mobileServerListHeader = document.createElement("div");
  mobileServerListHeader.className = "mobile-server-list-header";
  const mobileServerListTitle = document.createElement("span");
  mobileServerListTitle.textContent = "Servers";
  const mobileServerListCloseBtn = document.createElement("button");
  mobileServerListCloseBtn.type = "button";
  mobileServerListCloseBtn.className = "icon-button";
  mobileServerListCloseBtn.title = "Close";
  mobileServerListCloseBtn.appendChild(icon("x", 16));
  mobileServerListHeader.append(mobileServerListTitle, mobileServerListCloseBtn);

  const mobileServerListItems = document.createElement("div");
  mobileServerListItems.className = "mobile-server-list-items";

  const mobileServerList = document.createElement("div");
  mobileServerList.className = "mobile-server-list";
  mobileServerList.hidden = true;
  mobileServerList.append(mobileServerListHeader, mobileServerListItems);

  const inviteBtn = document.createElement("button");
  inviteBtn.className = "icon-button icon-button-labeled";
  inviteBtn.append(icon("user-plus", 15), document.createTextNode("Invite"));
  inviteBtn.title = "Invite people to this server";

  const manageGuildBtn = document.createElement("button");
  manageGuildBtn.className = "icon-button";
  manageGuildBtn.appendChild(icon("settings", 16));
  manageGuildBtn.title = "Manage server";
  manageGuildBtn.hidden = true;

  const createChannelBtn = document.createElement("button");
  createChannelBtn.className = "icon-button";
  createChannelBtn.appendChild(icon("plus", 16));
  createChannelBtn.title = "Create a channel";
  createChannelBtn.hidden = true;

  const newDmBtn = document.createElement("button");
  newDmBtn.className = "icon-button";
  newDmBtn.appendChild(icon("plus", 16));
  newDmBtn.title = "Add a friend";
  newDmBtn.hidden = true;

  const friendRequestsBtn = document.createElement("button");
  friendRequestsBtn.className = "icon-button";
  friendRequestsBtn.appendChild(icon("users", 16));
  friendRequestsBtn.title = "Friend requests";
  friendRequestsBtn.hidden = true;
  const friendRequestsBadge = document.createElement("span");
  friendRequestsBadge.className = "badge";
  friendRequestsBadge.hidden = true;
  friendRequestsBtn.appendChild(friendRequestsBadge);

  // Grouped and pushed to the far right (see `.sidebar-header-right`'s
  // `margin-left: auto`), matching `.channel-header-right` — plain
  // `justify-content: space-between` on the header itself (the
  // previous approach) spaces out *every* flex child evenly, which
  // for more than two children (the name plus five buttons here)
  // spreads the buttons themselves apart from each other too, not
  // just the whole group away from the name.
  const sidebarHeaderRight = document.createElement("div");
  sidebarHeaderRight.className = "sidebar-header-right";
  sidebarHeaderRight.append(
    mobileServerListBtn,
    createChannelBtn,
    manageGuildBtn,
    inviteBtn,
    friendRequestsBtn,
    newDmBtn,
  );
  sidebarHeader.append(sidebarHeaderName, sidebarHeaderRight);

  const channelList = document.createElement("div");
  channelList.className = "channel-list";
  // Mobile only: picking anything from the drawer (see `hamburgerBtn`
  // below) navigates into it, so the drawer itself should get out of
  // the way rather than staying open over the freshly-selected chat.
  // A single delegated listener here covers every channel/DM row
  // without needing to touch each individual select* function.
  channelList.addEventListener("click", () => closeMobileNav());

  const avatarInitial = (name: string) => name.slice(0, 1).toUpperCase();

  let userAvatar = renderAvatarEl(user.display_name, user.avatar_file_id);
  const statusDot = document.createElement("span");
  statusDot.className = "status-dot online";
  const avatarWrap = document.createElement("div");
  avatarWrap.className = "avatar-wrap";
  avatarWrap.append(userAvatar, statusDot);

  function refreshUserAvatar(): void {
    const next = renderAvatarEl(user.display_name, user.avatar_file_id);
    userAvatar.replaceWith(next);
    userAvatar = next;
  }

  const nameEl = document.createElement("div");
  nameEl.className = "name";
  nameEl.textContent = user.display_name;
  const statusEl = document.createElement("div");
  statusEl.className = "username";
  statusEl.textContent = "Online";

  const identity = document.createElement("div");
  identity.className = "identity";
  identity.title = `@${user.username}`;
  identity.append(nameEl, statusEl);

  const userChip = document.createElement("button");
  userChip.type = "button";
  userChip.className = "user-chip";
  userChip.title = "Settings";
  userChip.append(avatarWrap, identity);

  // The one place every call control lives — mic, deafen, camera,
  // screen share — regardless of whether a call is even active (they
  // simply have nothing to do until you join one). Used to be
  // scattered across four separate copies (this footer, a sidebar
  // voice-status bar, a docked mobile bar, and a floating mobile
  // overlay), all kept in sync with the same `voiceClient` state via
  // parallel arrays — which read, correctly, as "too many repeat
  // controls" rather than one coherent set. "Leave call" and "hide/
  // show chat" are deliberately *not* here (see `endCallBtn`/
  // `hideChatBtn`, in the channel header) — those are about the
  // call/view you're currently in, not standing device toggles you'd
  // reach for the same way whether or not you're even in a call.
  const globalMuteBtn = document.createElement("button");
  globalMuteBtn.type = "button";
  globalMuteBtn.className = "icon-button voice-control";
  globalMuteBtn.appendChild(icon("mic", 16));
  globalMuteBtn.title = "Mute microphone";

  const globalDeafenBtn = document.createElement("button");
  globalDeafenBtn.type = "button";
  globalDeafenBtn.className = "icon-button voice-control";
  globalDeafenBtn.appendChild(icon("headphones", 16));
  globalDeafenBtn.title = "Deafen";

  const globalCameraBtn = document.createElement("button");
  globalCameraBtn.type = "button";
  globalCameraBtn.className = "icon-button voice-control";
  globalCameraBtn.appendChild(icon("video", 16));
  globalCameraBtn.title = "Turn on camera";

  const globalScreenBtn = document.createElement("button");
  globalScreenBtn.type = "button";
  globalScreenBtn.className = "icon-button voice-control";
  globalScreenBtn.appendChild(icon("monitor", 16));
  globalScreenBtn.title = "Share your screen";
  // Most phone browsers (mobile Safari, Chrome for Android) don't
  // implement `getDisplayMedia` at all — a real platform limitation,
  // not a bug — so this button would always fail there. Hiding it
  // outright avoids a dead-end tap; `voiceClient` still has its own
  // belt-and-suspenders check (see `toggleScreenShare`) in case a
  // browser somehow exposes the function but can't actually deliver a
  // stream.
  if (typeof navigator.mediaDevices.getDisplayMedia !== "function") {
    globalScreenBtn.hidden = true;
  }

  const footerButtons = document.createElement("div");
  footerButtons.className = "footer-buttons";
  footerButtons.append(globalMuteBtn, globalDeafenBtn, globalCameraBtn, globalScreenBtn);

  const sidebarFooter = document.createElement("div");

  return {
    addServerBtn,
    avatarInitial,
    channelList,
    createChannelBtn,
    footerButtons,
    friendRequestsBadge,
    friendRequestsBtn,
    globalCameraBtn,
    globalDeafenBtn,
    globalMuteBtn,
    globalScreenBtn,
    guildRail,
    homeIcon,
    identity,
    inviteBtn,
    manageGuildBtn,
    mobileServerList,
    mobileServerListBtn,
    mobileServerListCloseBtn,
    mobileServerListItems,
    nameEl,
    newDmBtn,
    refreshUserAvatar,
    shell,
    sidebar,
    sidebarFooter,
    sidebarHeader,
    sidebarHeaderName,
    sidebarResizeHandle,
    userChip,
  };
}

export type SidebarParts = ReturnType<typeof createSidebar>;
