// The channel header: the title, the call and search buttons, the mobile
// navigation drawer (open/close and swipe), the sidebar collapse toggle,
// and the voice controls that live in the header while a call is on.

import { icon } from "../../icons";

/** What this part of the chat screen needs from the rest of it. */
export interface createHeaderContext {
  channelList: HTMLDivElement;
  mobileServerList: HTMLDivElement;
  shell: HTMLDivElement;
  sidebar: HTMLDivElement;
  sidebarFooter: HTMLDivElement;
  sidebarHeader: HTMLDivElement;
  readonly layoutVideoTiles: () => void;
}

export function createHeader(ctx: createHeaderContext) {
  const { channelList, mobileServerList, shell, sidebar, sidebarFooter, sidebarHeader } = ctx;

  const videoTiles = document.createElement("div");
  videoTiles.className = "video-tiles";

  const videoTilesPanel = document.createElement("div");
  videoTilesPanel.className = "video-tiles-panel";
  videoTilesPanel.append(videoTiles);
  videoTilesPanel.hidden = true;

  sidebar.append(sidebarHeader, channelList, sidebarFooter, mobileServerList);

  const channelHeader = document.createElement("div");
  channelHeader.className = "channel-header";

  // Mobile only (see the `max-width: 768px` block in style.css) — the
  // guild rail + sidebar have nowhere to fit permanently alongside the
  // chat at phone width, so they become one off-canvas drawer this
  // opens/closes instead. Hidden outright on a wide screen, where
  // everything's already visible side by side.
  const hamburgerBtn = document.createElement("button");
  hamburgerBtn.type = "button";
  hamburgerBtn.className = "icon-button hamburger-btn";
  hamburgerBtn.title = "Show channels";
  hamburgerBtn.appendChild(icon("menu", 18));

  const mobileNavBackdrop = document.createElement("div");
  mobileNavBackdrop.className = "mobile-nav-backdrop";

  function closeMobileNav(): void {
    shell.classList.remove("mobile-nav-open");
    // Reset back to the channel list — otherwise reopening the drawer
    // later could land back on the server-switcher screen instead of
    // wherever the user actually is.
    mobileServerList.hidden = true;
  }
  function toggleMobileNav(): void {
    shell.classList.toggle("mobile-nav-open");
  }
  hamburgerBtn.addEventListener("click", toggleMobileNav);
  mobileNavBackdrop.addEventListener("click", closeMobileNav);

  // Swipe-to-close for the mobile drawer — consolidating every call
  // control down to just the sidebar-footer (see the `voice-control`
  // buttons below) means the hamburger drawer is now how mobile
  // reaches them mid-call, so opening/closing it needs to be quick,
  // not just a tap target at the very top corner. Only cares about a
  // mostly-horizontal drag starting from a reasonably open drawer (a
  // vertical scroll inside the channel list shouldn't fight this) and
  // only ever closes — there's still the hamburger button/backdrop tap
  // to open it, no swipe-to-open gesture added here.
  let navSwipeStartX = 0;
  let navSwipeStartY = 0;
  let navSwipeTracking = false;
  sidebar.addEventListener(
    "touchstart",
    (e) => {
      if (!shell.classList.contains("mobile-nav-open") || e.touches.length !== 1) return;
      navSwipeStartX = e.touches[0].clientX;
      navSwipeStartY = e.touches[0].clientY;
      navSwipeTracking = true;
      sidebar.classList.add("nav-swiping");
    },
    { passive: true },
  );
  sidebar.addEventListener(
    "touchmove",
    (e) => {
      if (!navSwipeTracking) return;
      const dx = e.touches[0].clientX - navSwipeStartX;
      const dy = e.touches[0].clientY - navSwipeStartY;
      if (Math.abs(dy) > Math.abs(dx)) {
        // Reads as a vertical scroll, not a swipe — bail out for the
        // rest of this touch rather than fighting the channel list's
        // own scrolling.
        navSwipeTracking = false;
        sidebar.classList.remove("nav-swiping");
        sidebar.style.transform = "";
        return;
      }
      const clamped = Math.min(0, dx);
      sidebar.style.transform = `translateX(${clamped}px)`;
    },
    { passive: true },
  );
  function endNavSwipe(e: TouchEvent): void {
    if (!navSwipeTracking) return;
    navSwipeTracking = false;
    sidebar.classList.remove("nav-swiping");
    sidebar.style.transform = "";
    const dx = (e.changedTouches[0]?.clientX ?? navSwipeStartX) - navSwipeStartX;
    // A quarter of the drawer's own width is "clearly a deliberate
    // swipe," not an accidental brush — matches how far a real drag
    // already visually pulled the drawer toward closed via the
    // `transform` above.
    if (dx < -sidebar.getBoundingClientRect().width / 4) {
      closeMobileNav();
    }
  }
  sidebar.addEventListener("touchend", endNavSwipe);
  sidebar.addEventListener("touchcancel", endNavSwipe);

  const channelHeaderLabel = document.createElement("div");
  channelHeaderLabel.className = "channel-header-label";

  const dmCallBtn = document.createElement("button");
  dmCallBtn.type = "button";
  dmCallBtn.className = "icon-button";
  dmCallBtn.appendChild(icon("phone", 16));
  dmCallBtn.title = "Call";
  dmCallBtn.hidden = true;

  const dmOptionsBtn = document.createElement("button");
  dmOptionsBtn.type = "button";
  dmOptionsBtn.className = "icon-button";
  dmOptionsBtn.appendChild(icon("more-horizontal", 16));
  dmOptionsBtn.title = "Conversation options";
  dmOptionsBtn.hidden = true;

  // Mirrors "hide chat" for the *other* side of the layout — the
  // guild rail and channel/DM list together, same as the mobile
  // hamburger drawer collapses them into. Unlike the three call
  // controls below, this isn't tied to `voiceClient` state at all —
  // it's just reclaiming width for whatever's in the main column
  // (chat, or a wide video call), always available regardless of
  // whether a call is happening. Desktop-only (see the mobile media
  // query in style.css): on a phone the rail/sidebar are already
  // off-canvas by default, so there's nothing for this to do there.
  const toggleSidebarBtn = document.createElement("button");
  toggleSidebarBtn.type = "button";
  toggleSidebarBtn.className = "icon-button toggle-sidebar-btn";
  toggleSidebarBtn.appendChild(icon("sidebar", 16));
  toggleSidebarBtn.title = "Hide server list";
  let sidebarCollapsed = false;
  toggleSidebarBtn.addEventListener("click", () => {
    sidebarCollapsed = !sidebarCollapsed;
    shell.classList.toggle("sidebar-collapsed", sidebarCollapsed);
    toggleSidebarBtn.title = sidebarCollapsed ? "Show server list" : "Hide server list";
    toggleSidebarBtn.classList.toggle("active", sidebarCollapsed);
  });

  // These three used to live in two separate places — a
  // `voice-status-bar` tucked at the very bottom of the sidebar (off-
  // canvas on mobile, easy to miss even on desktop) for "end call", and
  // a `video-tiles-toolbar` floating over the video panel itself for
  // "hide chat" — neither reliably in view depending on what else was
  // on screen. Grouped here instead, in the one header bar that's
  // always visible regardless of what you're looking at, right next to
  // the connection-status indicator. All three are call-state-driven,
  // not tied to whichever channel/DM the header happens to be showing
  // right now — visibility for each is kept in sync with `voiceClient`
  // wherever its own state already gets synced (`onStateChange`/
  // `syncVideoIcons`), not by a separate poll of their own.
  const endCallBtn = document.createElement("button");
  endCallBtn.type = "button";
  endCallBtn.className = "icon-button danger-icon end-call-btn";
  endCallBtn.appendChild(icon("phone-off", 16));
  endCallBtn.title = "Disconnect";
  endCallBtn.hidden = true;

  // "Hide chat" is the cam-to-cam-only option Discord doesn't quite
  // have a direct equivalent for but that's an obvious complement to
  // having chat beside the video at all: collapses `.chat-column` to
  // nothing and lets the video panel fill the freed width. Only
  // meaningful once there's actually a video panel to expand into —
  // hidden otherwise, same as before.
  const hideChatBtn = document.createElement("button");
  hideChatBtn.type = "button";
  hideChatBtn.className = "icon-button";
  hideChatBtn.title = "Hide chat";
  hideChatBtn.appendChild(icon("message-circle", 16));
  hideChatBtn.hidden = true;

  // A one-click shortcut for popping your own camera out (wired by the
  // video panel, which knows the tile). Shown only while the camera is on.
  const separateWebcamBtn = document.createElement("button");
  separateWebcamBtn.type = "button";
  separateWebcamBtn.className = "icon-button separate-webcam-btn";
  separateWebcamBtn.appendChild(icon("external-link", 16));
  separateWebcamBtn.title = "Show webcam in a separate window";
  separateWebcamBtn.hidden = true;

  // "Rotate which video is where in the grid" — cycles who's in which
  // grid cell (or which position in the focused view's filmstrip) by
  // one step. `layoutVideoTiles`/`layoutResizableGrid` assign cells in
  // plain DOM order, so moving one tile to the end of that order (a
  // re-parent, not a recreate — an already-playing stream is never
  // interrupted) is the entire implementation; no separate "grid
  // position" concept to track anywhere else. Requested specifically
  // for mobile, where there's no drag-and-drop-sized handle to grab a
  // specific tile with the way the desktop grid's own resize handles
  // work — a single tap-to-cycle control needs no precision aim at
  // all, at the cost of only ever rotating one direction. Shown
  // wherever it would actually do something: hidden outright below
  // two tiles, since there's nothing to rearrange with just one.
  const rotateGridBtn = document.createElement("button");
  rotateGridBtn.type = "button";
  rotateGridBtn.className = "icon-button";
  rotateGridBtn.appendChild(icon("shuffle", 16));
  rotateGridBtn.title = "Rotate video positions";
  rotateGridBtn.hidden = true;
  rotateGridBtn.addEventListener("click", () => {
    const tiles = Array.from(videoTiles.querySelectorAll<HTMLElement>(".video-tile"));
    const first = tiles[0];
    if (!first) return;
    // Moving an already-in-the-DOM element via appendChild re-parents
    // it (to the same parent, at the end) rather than cloning — the
    // exact same "never recreate a live video element" rule every
    // other reconciliation in this file already follows.
    videoTiles.appendChild(first);
    ctx.layoutVideoTiles();
  });

  // Mobile-only mirrors of the sidebar footer's mic/camera toggles
  // (see the mobile media query in style.css) — reachable directly in
  // the header during a call instead of needing the hamburger drawer
  // open, once the channel name/network-status/webcam-popout controls
  // (all rarely useful while a phone call already has your full
  // attention) step aside to make room for them. `.hidden` (updated
  // alongside `endCallBtn`'s in `onStateChange`) keeps them gone
  // outside a call; the CSS then confines them to mobile specifically,
  // since the footer versions already cover desktop.
  const headerCameraBtn = document.createElement("button");
  headerCameraBtn.type = "button";
  headerCameraBtn.className = "icon-button voice-control header-camera-btn";
  headerCameraBtn.appendChild(icon("video", 16));
  headerCameraBtn.title = "Turn on camera";
  headerCameraBtn.hidden = true;

  const headerMuteBtn = document.createElement("button");
  headerMuteBtn.type = "button";
  headerMuteBtn.className = "icon-button voice-control header-mic-btn";
  headerMuteBtn.appendChild(icon("mic", 16));
  headerMuteBtn.title = "Mute microphone";
  headerMuteBtn.hidden = true;

  const searchBtn = document.createElement("button");
  searchBtn.type = "button";
  searchBtn.className = "icon-button";
  searchBtn.title = "Search messages (Ctrl+Shift+F)";
  searchBtn.setAttribute("aria-label", "Search messages");
  searchBtn.appendChild(icon("search", 16));

  const channelHeaderRight = document.createElement("div");

  return {
    channelHeader,
    channelHeaderLabel,
    channelHeaderRight,
    closeMobileNav,
    dmCallBtn,
    dmOptionsBtn,
    endCallBtn,
    hamburgerBtn,
    headerCameraBtn,
    headerMuteBtn,
    hideChatBtn,
    mobileNavBackdrop,
    rotateGridBtn,
    searchBtn,
    separateWebcamBtn,
    toggleSidebarBtn,
    videoTiles,
    videoTilesPanel,
  };
}

export type HeaderParts = ReturnType<typeof createHeader>;
