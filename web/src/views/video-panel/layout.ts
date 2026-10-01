// Video panel layout: which tiles show where (grid, spotlight with filmstrip, resizable columns and rows), focus, and the header icons that mirror camera/screen state.

import { icon } from "../../icons";
import { refreshSelfBubble } from "../../self-bubble";
import type { VideoPanelContext } from "./context";
import { chooseGrid } from "./grid";

export type LayoutApi = ReturnType<typeof createLayout>;

export function createLayout(ctx: VideoPanelContext) {
  const {
    globalCameraBtn,
    globalScreenBtn,
    headerCameraBtn,
    hideChatBtn,
    renderDmCallStage,
    rotateGridBtn,
    separateWebcamBtn,
    stageCameraBtn,
    stageScreenBtn,
    videoChatResizeHandle,
    videoTiles,
    videoTilesPanel,
    voiceClient,
  } = ctx;

  /** Your own camera or screen share (keys: see `createTiles`). */
  function isSelfTile(tile: HTMLElement): boolean {
    return tile.dataset.videoKey === "self" || tile.dataset.videoKey === "self-camera-tile";
  }

  function syncVideoIcons(): void {
    const camOn = voiceClient.hasLocalCamera;
    globalCameraBtn.classList.toggle("active", camOn);
    globalCameraBtn.title = camOn ? "Turn off camera" : "Turn on camera";
    headerCameraBtn.classList.toggle("active", camOn);
    headerCameraBtn.title = camOn ? "Turn off camera" : "Turn on camera";
    stageCameraBtn.classList.toggle("active", camOn);
    stageCameraBtn.title = camOn ? "Turn off camera" : "Turn on camera";
    const screenOn = voiceClient.hasLocalScreenShare;
    globalScreenBtn.classList.toggle("active", screenOn);
    globalScreenBtn.title = screenOn ? "Stop sharing your screen" : "Share your screen";
    stageScreenBtn.classList.toggle("active", screenOn);
    stageScreenBtn.title = screenOn ? "Stop sharing your screen" : "Share your screen";
    // Nothing to pop out once the camera's off — and if it *was*
    // popped out, turning the camera off tears down its stream/element
    // entirely, so there's no PiP window left to reflect here either.
    separateWebcamBtn.hidden = !camOn;
    if (!camOn) separateWebcamBtn.classList.remove("active");
  }

  let focusedVideoKey: string | null = null;

  // The best grid depends on the pane's size, which changes when the chat is
  // hidden or the divider is dragged, so re-lay-out when it does.
  new ResizeObserver(() => layoutVideoTiles()).observe(videoTiles);

  // Relative sizes (as CSS `fr` units) for the un-focused grid's
  // columns/rows — a plain user drag away from the equal split
  // `layoutResizableGrid` starts every shape at. Reset (by length
  // mismatch) whenever the grid's own shape changes, e.g. someone
  // joins and the grid goes from 2x1 to 2x2 — a stale 3-wide split
  // held over from a previous shape wouldn't mean anything against
  // the new one anyway.
  let videoColFractions: number[] = [];

  let videoRowFractions: number[] = [];

  function ensureVideoTilesVisible(): void {
    // Not just "any children at all" — a tile hidden because its
    // video popped out (see `setTilePoppedOut`)
    // still counts as a child, and popping out someone's *only* video
    // in the call shouldn't leave the whole panel sitting there empty.
    // Counts actual `.video-tile`s (descendants — in a focused layout
    // most sit inside `.video-filmstrip`), not every child: the
    // filmstrip container and its resize handle are children too, and
    // a leftover one with no tiles left kept this panel open as an
    // empty box after the call ended.
    const visibleTiles = Array.from(videoTiles.querySelectorAll<HTMLElement>(".video-tile")).filter(
      (tile) => !tile.classList.contains("tile-in-pip"),
    );
    const visible = visibleTiles.length > 0;
    videoTilesPanel.hidden = !visible;
    videoChatResizeHandle.hidden = !visible;
    // "Maximize/minimize chat" only means anything once there's a
    // video panel to expand into — hidden the rest of the time, same
    // scoping it had back when it lived inside that panel's own
    // toolbar instead of the channel header.
    hideChatBtn.hidden = !visible;
    if (!visible && ctx.chatHidden) hideChatBtn.click();
    // Rotating positions only means anything with 2+ tiles actually
    // on screen — with one (or zero, mid-transition) there's nothing
    // to swap places with.
    rotateGridBtn.hidden = visibleTiles.length < 2;
    renderDmCallStage();
  }

  /** Arranges tiles for the current focus state: flat grid when
   * nothing's focused, or one spotlighted tile plus the rest demoted
   * into a filmstrip strip when a tile's "focus" control was clicked.
   * Re-parents the existing tile elements rather than recreating them
   * so an active `<video>`'s playback is never interrupted. */
  function layoutVideoTiles(): void {
    // Popped-out tiles are hidden (`.tile-in-pip`), so the grid is sized
    // for what is actually still on screen.
    const tiles = Array.from(videoTiles.querySelectorAll<HTMLElement>(".video-tile:not(.tile-in-pip)"));
    if (focusedVideoKey && !tiles.some((t) => t.dataset.videoKey === focusedVideoKey)) {
      focusedVideoKey = null;
    }
    videoTiles.classList.toggle("focused", focusedVideoKey !== null);
    // Which tile is focused wasn't visible anywhere on the button
    // itself — clicking a *different* tile's Focus silently moved the
    // spotlight with no indication which one (if any) currently held
    // it, which read as arbitrary/inconsistent. The pressed-looking
    // button and swapped icon now make the current state legible.
    for (const t of tiles) {
      const btn = t.querySelector<HTMLElement>(".video-tile-focus-btn");
      if (!btn) continue;
      const isFocused = t.dataset.videoKey === focusedVideoKey;
      btn.classList.toggle("active", isFocused);
      btn.title = isFocused ? "Unfocus this video" : "Focus this video";
      btn.replaceChildren(icon(isFocused ? "minimize-2" : "maximize-2", 13));
    }
    let filmstrip = videoTiles.querySelector<HTMLElement>(".video-filmstrip");
    if (focusedVideoKey === null) {
      if (filmstrip) {
        while (filmstrip.firstChild) videoTiles.insertBefore(filmstrip.firstChild, filmstrip);
        filmstrip.remove();
      }
      // Its resize handle is a child of `videoTiles` too, and used to
      // outlive the filmstrip when a focused call ended (or the focused
      // person left) — a stray bar, and enough of a "child" to keep
      // the whole video panel open with no video in it.
      videoTiles.querySelector(".video-filmstrip-resize-handle")?.remove();
      for (const t of tiles) t.classList.remove("spotlight");
      // A grid shaped to the tile count — as square as possible, like
      // any video-conferencing app's grid — rather than a fixed
      // column count. Each cell then fills its own space fully (see
      // .video-tile's CSS) and the *video* letterboxes to preserve
      // its real proportions, instead of the tile's own box being
      // driven by aspect-ratio: that let one wide/tall stream grow
      // taller than the pane and get clipped or spill over the chat.
      // Shaped to the space actually there (see `chooseGrid`), not to a
      // square: two webcams in a tall pane stack instead of standing as slivers.
      const count = tiles.length;
      const padding = 16; // .video-tiles' own padding, both sides
      const { cols, rows } = chooseGrid(
        count,
        videoTiles.clientWidth - padding,
        videoTiles.clientHeight - padding,
      );
      // Exactly one other person: on a phone with chat hidden (see
      // `.pip-pair`'s own CSS), this reshapes into the "them full-
      // screen, you a small corner bubble" layout every native phone
      // call app uses instead of two equal-sized tiles splitting the
      // screen — a plain NxN grid reads as a video-conferencing app,
      // not a phone call. Harmless on desktop/with chat visible: the
      // class only does anything inside that specific CSS scope.
      const selfTiles = tiles.filter(isSelfTile);
      const isPair = count === 2 && selfTiles.length === 1;
      videoTiles.classList.toggle("pip-pair", isPair);
      // The local camera/screen tile is always keyed by the literal
      // string "self" (see `voiceClient.onLocalVideo` above), never by
      // the local user's own id — comparing against `user.id` here
      // never matched, so neither tile ever got `.self` and the
      // pip-pair CSS's 100%-width/height rule applied to *both* tiles
      // with no absolute positioning to tell them apart, stacking the
      // second one below the viewport instead of showing it as a
      // corner bubble. Confirmed live: this made whichever tile landed
      // second in the DOM invisible on a phone with chat hidden.
      for (const t of tiles) {
        t.classList.toggle("self", isPair && isSelfTile(t));
        if (isSelfTile(t)) refreshSelfBubble(t);
      }
      layoutResizableGrid(tiles, cols, rows);
      return;
    }
    videoTiles.style.gridTemplateColumns = "";
    videoTiles.style.gridTemplateRows = "";
    videoTiles.classList.remove("pip-pair");
    // Leftover column/row resize handles (and the per-tile grid-line
    // placement they went with) from the un-focused grid — meaningless
    // once `.focused` switches this to a flex spotlight+filmstrip
    // layout instead of a grid, and would otherwise render as stray
    // bars floating over it.
    for (const old of videoTiles.querySelectorAll(".video-grid-col-handle, .video-grid-row-handle")) {
      old.remove();
    }
    for (const t of tiles) {
      t.style.gridColumn = "";
      t.style.gridRow = "";
      t.classList.remove("self");
      if (isSelfTile(t)) refreshSelfBubble(t);
      t.classList.toggle("spotlight", t.dataset.videoKey === focusedVideoKey);
      if (t.dataset.videoKey === focusedVideoKey && videoTiles.firstChild !== t) {
        videoTiles.insertBefore(t, videoTiles.firstChild);
      }
    }
    // No filmstrip (or its resize handle) at all when the focused
    // tile is the only one — nothing to show a strip of.
    if (tiles.length <= 1) {
      filmstrip?.remove();
      videoTiles.querySelector(".video-filmstrip-resize-handle")?.remove();
      return;
    }
    if (!filmstrip) {
      filmstrip = document.createElement("div");
      filmstrip.className = "video-filmstrip";
    }
    for (const t of tiles) {
      if (t.dataset.videoKey !== focusedVideoKey && t.parentElement !== filmstrip) {
        filmstrip.appendChild(t);
      }
    }
    let filmstripHandle = videoTiles.querySelector<HTMLElement>(".video-filmstrip-resize-handle");
    if (!filmstripHandle) {
      filmstripHandle = document.createElement("div");
      filmstripHandle.className = "video-filmstrip-resize-handle";
      filmstripHandle.addEventListener("mousedown", (startEvent) => {
        startEvent.preventDefault();
        filmstripHandle?.classList.add("dragging");
        const onMove = (moveEvent: MouseEvent) => {
          const panelRect = videoTiles.getBoundingClientRect();
          const height = Math.min(panelRect.height - 100, Math.max(60, panelRect.bottom - moveEvent.clientY));
          videoTiles.style.setProperty("--filmstrip-height", `${height}px`);
        };
        const onUp = () => {
          filmstripHandle?.classList.remove("dragging");
          window.removeEventListener("mousemove", onMove);
          window.removeEventListener("mouseup", onUp);
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
      });
    }
    // Moving a node that is already in place still removes and re-inserts
    // it, and the browser leaves full screen when a full-screen video's
    // ancestor is removed — so only touch what is actually out of order.
    if (videoTiles.lastElementChild !== filmstrip || filmstrip.previousElementSibling !== filmstripHandle) {
      videoTiles.append(filmstripHandle, filmstrip);
    }
  }

  /** Lays `tiles` out on an explicit `cols`×`rows` grid with a thin
   * draggable handle between every adjacent pair of columns and every
   * adjacent pair of rows — the same idea as the existing video/chat
   * and sidebar resize handles, just generalized to a grid instead of
   * one fixed split. Each handle spans the *entire* opposite axis
   * (a column handle's `grid-row` covers every row) via extra
   * 1-line-per-handle grid tracks placed between the real tile
   * tracks, so dragging one boundary moves it for every row/column at
   * once, the way a spreadsheet's column/row resize does — not just
   * the two tiles nearest the handle. Hidden entirely on mobile (see
   * the `@media` block in style.css) since a phone call uses the
   * separate self-camera-PiP layout instead, not a resizable grid. */
  function layoutResizableGrid(tiles: HTMLElement[], cols: number, rows: number): void {
    for (const old of videoTiles.querySelectorAll(".video-grid-col-handle, .video-grid-row-handle")) {
      old.remove();
    }
    if (tiles.length < 2 || cols < 1 || rows < 1) {
      videoTiles.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
      videoTiles.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
      for (const t of tiles) {
        t.style.gridColumn = "";
        t.style.gridRow = "";
      }
      return;
    }

    if (videoColFractions.length !== cols) videoColFractions = new Array(cols).fill(1);
    if (videoRowFractions.length !== rows) videoRowFractions = new Array(rows).fill(1);

    const HANDLE_SIZE = "6px";
    function applyTemplate(): void {
      videoTiles.style.gridTemplateColumns = videoColFractions.map((f) => `${f}fr`).join(` ${HANDLE_SIZE} `);
      videoTiles.style.gridTemplateRows = videoRowFractions.map((f) => `${f}fr`).join(` ${HANDLE_SIZE} `);
    }
    applyTemplate();

    tiles.forEach((t, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      t.style.gridColumn = `${col * 2 + 1}`;
      t.style.gridRow = `${row * 2 + 1}`;
    });

    const MIN_FR = 0.25;
    function wireHandle(handle: HTMLElement, axis: "col" | "row", index: number): void {
      handle.addEventListener("mousedown", (startEvent) => {
        startEvent.preventDefault();
        handle.classList.add("dragging");
        const fractions = axis === "col" ? videoColFractions : videoRowFractions;
        const startPos = axis === "col" ? startEvent.clientX : startEvent.clientY;
        const startFractions = [...fractions];
        const rect = videoTiles.getBoundingClientRect();
        const totalFr = startFractions.reduce((a, b) => a + b, 0);
        const pxPerFr = (axis === "col" ? rect.width : rect.height) / totalFr;
        const onMove = (moveEvent: MouseEvent): void => {
          const pos = axis === "col" ? moveEvent.clientX : moveEvent.clientY;
          const deltaFr = (pos - startPos) / pxPerFr;
          let left = startFractions[index] + deltaFr;
          let right = startFractions[index + 1] - deltaFr;
          if (left < MIN_FR) {
            right -= MIN_FR - left;
            left = MIN_FR;
          }
          if (right < MIN_FR) {
            left -= MIN_FR - right;
            right = MIN_FR;
          }
          fractions[index] = Math.max(MIN_FR, left);
          fractions[index + 1] = Math.max(MIN_FR, right);
          applyTemplate();
        };
        const onUp = (): void => {
          handle.classList.remove("dragging");
          window.removeEventListener("mousemove", onMove);
          window.removeEventListener("mouseup", onUp);
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
      });
    }

    // One handle segment per row/column, not one spanning `1 / -1`: a
    // full-span column handle and a full-span row handle cross at every
    // interior intersection and the later one in the DOM wins the pointer
    // (a drag at a 2x2 row boundary resized the row instead). Segments of
    // one boundary share `axis`/`index`, so any of them resizes it, and
    // column and row segments never occupy the same cell.
    for (let c = 0; c < cols - 1; c++) {
      for (let r = 0; r < rows; r++) {
        const handle = document.createElement("div");
        handle.className = "video-grid-col-handle";
        handle.style.gridColumn = `${c * 2 + 2}`;
        handle.style.gridRow = `${r * 2 + 1}`;
        wireHandle(handle, "col", c);
        videoTiles.appendChild(handle);
      }
    }
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols; c++) {
        const handle = document.createElement("div");
        handle.className = "video-grid-row-handle";
        handle.style.gridRow = `${r * 2 + 2}`;
        handle.style.gridColumn = `${c * 2 + 1}`;
        wireHandle(handle, "row", r);
        videoTiles.appendChild(handle);
      }
    }
  }

  function toggleFocus(key: string): void {
    focusedVideoKey = focusedVideoKey === key ? null : key;
    layoutVideoTiles();
  }

  /** Hides a tile whose video is popped out (in the browser's
   * Picture-in-Picture window or a window of its own) so the rest of the
   * call gets its space; shows it again when the video comes back. The
   * tile stays in the DOM, so nothing about its stream is disturbed. */
  function setTilePoppedOut(tileKey: string, poppedOut: boolean): void {
    const tile = videoTiles.querySelector<HTMLElement>(`[data-video-key="${tileKey}"]`);
    if (!tile) return;
    tile.classList.toggle("tile-in-pip", poppedOut);
    layoutVideoTiles();
    ensureVideoTilesVisible();
  }

  return {
    syncVideoIcons,
    ensureVideoTilesVisible,
    layoutVideoTiles,
    toggleFocus,
    setTilePoppedOut,
  };
}
