// The phone call screen's small floating self-view: while chat is
// hidden and it's one-on-one, `layoutVideoTiles` (chat.ts) reshapes the
// call into "them full-screen, you a corner bubble" (see the
// `.video-tiles.pip-pair` rules in style.css). That bubble used to be
// pinned to the top-right with a fixed size; this makes it draggable
// anywhere in the screen and resizable — by a two-finger pinch, or by
// dragging its bottom-right grip — the way a native call app's is.
//
// Position and size are stored as percentages *between the container's
// edges* (the same convention as `PipPosition` in video-prefs.ts) so a
// rotation or a resized window can't leave the bubble off-screen, and
// are applied as CSS custom properties the bubble rule reads — never as
// plain inline `left/top/width`, which would leak into the normal grid
// layouts this same tile element is used in when it *isn't* a bubble.

const KEY = "chatty:selfBubble";
const MIN_WIDTH_PX = 84;
const MAX_WIDTH_FRACTION = 0.7;
/** Matches the `aspect-ratio: 3 / 4` on the bubble rule in style.css. */
const HEIGHT_PER_WIDTH = 4 / 3;

interface BubblePrefs {
  xPct: number;
  yPct: number;
  widthPct: number;
}

function loadPrefs(): BubblePrefs | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<BubblePrefs>;
    if (typeof p.xPct === "number" && typeof p.yPct === "number" && typeof p.widthPct === "number") {
      return { xPct: p.xPct, yPct: p.yPct, widthPct: p.widthPct };
    }
  } catch {
    /* corrupt or unavailable storage — fall back to the default corner */
  }
  return null;
}

function savePrefs(prefs: BubblePrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* private browsing or storage disabled — just won't persist */
  }
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

const refreshers = new WeakMap<HTMLElement, () => void>();

/** Re-applies the saved position/size (or clears it) — call whenever
 * the tile's `.self` class or its container's size may have changed. */
export function refreshSelfBubble(tile: HTMLElement): void {
  refreshers.get(tile)?.();
}

export function wireSelfBubble(tile: HTMLElement, container: HTMLElement): void {
  if (refreshers.has(tile)) return;

  // Only ever a bubble while the CSS says so — `.self` is set for any
  // one-on-one pair, but only positions absolutely on a phone with chat
  // hidden. Checking the computed style keeps this in step with that
  // rule instead of duplicating its media query here.
  const isBubble = (): boolean =>
    tile.classList.contains("self") && getComputedStyle(tile).position === "absolute";

  const handle = document.createElement("div");
  handle.className = "self-bubble-resize-handle";
  tile.appendChild(handle);

  const setBox = (left: number, top: number, width: number): void => {
    tile.style.setProperty("--self-left", `${left}px`);
    tile.style.setProperty("--self-top", `${top}px`);
    tile.style.setProperty("--self-right", "auto");
    tile.style.setProperty("--self-w", `${width}px`);
    tile.style.setProperty("--self-max-w", "none");
  };
  const clearBox = (): void => {
    for (const name of ["--self-left", "--self-top", "--self-right", "--self-w", "--self-max-w"]) {
      tile.style.removeProperty(name);
    }
  };

  const currentBox = (): { left: number; top: number; width: number } => {
    const t = tile.getBoundingClientRect();
    const c = container.getBoundingClientRect();
    return { left: t.left - c.left, top: t.top - c.top, width: t.width };
  };

  /** Keeps the whole bubble inside the container at `width`. */
  const place = (left: number, top: number, width: number): void => {
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const w = clamp(width, MIN_WIDTH_PX, Math.max(MIN_WIDTH_PX, cw * MAX_WIDTH_FRACTION));
    const h = w * HEIGHT_PER_WIDTH;
    setBox(clamp(left, 0, Math.max(0, cw - w)), clamp(top, 0, Math.max(0, ch - h)), w);
  };

  const persist = (): void => {
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const { left, top, width } = currentBox();
    const h = width * HEIGHT_PER_WIDTH;
    savePrefs({
      xPct: cw - width > 0 ? clamp((left / (cw - width)) * 100, 0, 100) : 0,
      yPct: ch - h > 0 ? clamp((top / (ch - h)) * 100, 0, 100) : 0,
      widthPct: (width / cw) * 100,
    });
  };

  const refresh = (): void => {
    const prefs = loadPrefs();
    if (!prefs || !isBubble()) {
      clearBox();
      return;
    }
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const w = clamp(
      (prefs.widthPct / 100) * cw,
      MIN_WIDTH_PX,
      Math.max(MIN_WIDTH_PX, cw * MAX_WIDTH_FRACTION),
    );
    const h = w * HEIGHT_PER_WIDTH;
    setBox((prefs.xPct / 100) * Math.max(0, cw - w), (prefs.yPct / 100) * Math.max(0, ch - h), w);
  };
  refreshers.set(tile, refresh);
  new ResizeObserver(refresh).observe(container);

  // --- drag (one finger) and pinch (two) on the bubble itself ---------
  const pointers = new Map<number, { x: number; y: number }>();
  let dragStart: { px: number; py: number; left: number; top: number; width: number } | null = null;
  let pinchStart: { dist: number; width: number; cx: number; cy: number; left: number; top: number } | null =
    null;

  const pinchDistance = (): number => {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  tile.addEventListener("pointerdown", (e) => {
    if (!isBubble()) return;
    // Let the tile's own buttons (focus, pop out, full screen) and the
    // resize grip do their own thing.
    if ((e.target as HTMLElement).closest("button, input")) return;
    if (e.target === handle) return;
    tile.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const box = currentBox();
    if (pointers.size === 1) {
      dragStart = { px: e.clientX, py: e.clientY, ...box };
      pinchStart = null;
    } else if (pointers.size === 2) {
      dragStart = null;
      const [a, b] = [...pointers.values()];
      pinchStart = {
        dist: pinchDistance(),
        width: box.width,
        cx: (a.x + b.x) / 2,
        cy: (a.y + b.y) / 2,
        left: box.left,
        top: box.top,
      };
    }
  });

  tile.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinchStart && pointers.size >= 2) {
      const scale = pinchDistance() / Math.max(1, pinchStart.dist);
      const width = pinchStart.width * scale;
      // Scales about the pinch's own midpoint's position in the
      // bubble, not its corner, so it grows out from under the fingers.
      const grow = width - pinchStart.width;
      place(pinchStart.left - grow / 2, pinchStart.top - (grow * HEIGHT_PER_WIDTH) / 2, width);
    } else if (dragStart) {
      place(
        dragStart.left + (e.clientX - dragStart.px),
        dragStart.top + (e.clientY - dragStart.py),
        dragStart.width,
      );
    }
  });

  const endPointer = (e: PointerEvent): void => {
    if (!pointers.delete(e.pointerId)) return;
    if (pointers.size === 0) {
      dragStart = null;
      pinchStart = null;
      persist();
    } else if (pointers.size === 1) {
      // One finger lifted mid-pinch: carry on as a drag from where the
      // remaining finger is, rather than the bubble jumping.
      const [p] = [...pointers.values()];
      pinchStart = null;
      dragStart = { px: p.x, py: p.y, ...currentBox() };
    }
  };
  tile.addEventListener("pointerup", endPointer);
  tile.addEventListener("pointercancel", endPointer);

  // --- resize grip (bottom-right corner) -------------------------------
  let resizing: { px: number; py: number; left: number; top: number; width: number } | null = null;
  handle.addEventListener("pointerdown", (e) => {
    if (!isBubble()) return;
    e.stopPropagation();
    handle.setPointerCapture(e.pointerId);
    resizing = { px: e.clientX, py: e.clientY, ...currentBox() };
  });
  handle.addEventListener("pointermove", (e) => {
    if (!resizing) return;
    // Whichever axis moved further wins, so a diagonal drag feels
    // natural for a fixed-aspect box.
    const dx = e.clientX - resizing.px;
    const dy = (e.clientY - resizing.py) / HEIGHT_PER_WIDTH;
    place(resizing.left, resizing.top, resizing.width + (Math.abs(dx) > Math.abs(dy) ? dx : dy));
  });
  const endResize = (): void => {
    if (!resizing) return;
    resizing = null;
    persist();
  };
  handle.addEventListener("pointerup", endResize);
  handle.addEventListener("pointercancel", endResize);
}
