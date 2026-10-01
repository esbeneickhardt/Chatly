// The split between the call video and the chat: the draggable divider,
// its remembered size, and the containers everything else is placed in.

/** What this part of the chat screen needs from the rest of it. */
export interface createPanesContext {
  chatColumn: HTMLDivElement;
  videoTilesPanel: HTMLDivElement;
  readonly MOBILE_BREAKPOINT_PX: number;
}

export function createPanes(ctx: createPanesContext) {
  const { chatColumn, videoTilesPanel } = ctx;

  const VIDEO_PANE_WIDTH_KEY = "chatty:videoPaneWidth";
  const VIDEO_PANE_MIN_WIDTH = 240;
  const savedVideoPaneWidth = Number(localStorage.getItem(VIDEO_PANE_WIDTH_KEY));
  if (savedVideoPaneWidth >= VIDEO_PANE_MIN_WIDTH) {
    videoTilesPanel.style.setProperty("--video-pane-width", `${savedVideoPaneWidth}px`);
  }

  // Mobile's counterpart to the width above — `.content-split` stacks
  // video above chat there instead of side by side (see the
  // `max-width: 768px` block in style.css), so the divider drags
  // *height* rather than width. 120px is enough to still see a small
  // row of tiles/filmstrip rather than a sliver too thin to be useful.
  const VIDEO_PANE_HEIGHT_KEY = "chatty:videoPaneHeight";
  const VIDEO_PANE_MIN_HEIGHT = 120;
  const savedVideoPaneHeight = Number(localStorage.getItem(VIDEO_PANE_HEIGHT_KEY));
  if (savedVideoPaneHeight >= VIDEO_PANE_MIN_HEIGHT) {
    videoTilesPanel.style.setProperty("--video-pane-height", `${savedVideoPaneHeight}px`);
  }

  const videoChatResizeHandle = document.createElement("div");
  videoChatResizeHandle.className = "video-chat-resize-handle";
  videoChatResizeHandle.hidden = true;

  /** Drags the video/chat divider — horizontally (`--video-pane-width`)
   * when the two sit side by side, or vertically
   * (`--video-pane-height`) once `.content-split` stacks them instead
   * on mobile. Checked fresh at the *start* of every drag (not baked
   * into which listener fired) so a desktop window narrowed past the
   * breakpoint mid-session still drags whichever axis it's actually
   * laid out on right now, regardless of mouse vs. touch input. */
  function startVideoChatDrag(clientX: number, clientY: number): void {
    const stacked = window.innerWidth <= ctx.MOBILE_BREAKPOINT_PX;
    const contentRect = contentSplit.getBoundingClientRect();
    videoChatResizeHandle.classList.add("dragging");

    function apply(x: number, y: number): void {
      if (stacked) {
        const height = Math.min(
          contentRect.height - VIDEO_PANE_MIN_HEIGHT,
          Math.max(VIDEO_PANE_MIN_HEIGHT, y - contentRect.top),
        );
        videoTilesPanel.style.setProperty("--video-pane-height", `${height}px`);
      } else {
        const width = Math.min(
          contentRect.width - VIDEO_PANE_MIN_WIDTH,
          Math.max(VIDEO_PANE_MIN_WIDTH, x - contentRect.left),
        );
        videoTilesPanel.style.setProperty("--video-pane-width", `${width}px`);
      }
    }
    apply(clientX, clientY);

    function finish(): void {
      videoChatResizeHandle.classList.remove("dragging");
      const rect = videoTilesPanel.getBoundingClientRect();
      if (stacked) {
        localStorage.setItem(VIDEO_PANE_HEIGHT_KEY, rect.height.toString());
      } else {
        localStorage.setItem(VIDEO_PANE_WIDTH_KEY, rect.width.toString());
      }
    }

    const onMouseMove = (moveEvent: MouseEvent) => apply(moveEvent.clientX, moveEvent.clientY);
    const onMouseUp = () => {
      finish();
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
    const onTouchMove = (moveEvent: TouchEvent) => {
      const touch = moveEvent.touches[0];
      if (touch) apply(touch.clientX, touch.clientY);
    };
    const onTouchEnd = () => {
      finish();
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("touchmove", onTouchMove);
    window.addEventListener("touchend", onTouchEnd);
    window.addEventListener("touchcancel", onTouchEnd);
  }

  videoChatResizeHandle.addEventListener("mousedown", (startEvent) => {
    startEvent.preventDefault();
    startVideoChatDrag(startEvent.clientX, startEvent.clientY);
  });
  videoChatResizeHandle.addEventListener(
    "touchstart",
    (startEvent) => {
      const touch = startEvent.touches[0];
      if (!touch) return;
      // Not `passive` — needs to actually call `preventDefault` so
      // dragging the divider doesn't also scroll the page underneath it.
      startEvent.preventDefault();
      startVideoChatDrag(touch.clientX, touch.clientY);
    },
    { passive: false },
  );

  const contentSplit = document.createElement("div");
  contentSplit.className = "content-split";
  contentSplit.append(videoTilesPanel, videoChatResizeHandle, chatColumn);

  const mainColumn = document.createElement("div");

  return {
    contentSplit,
    mainColumn,
    videoChatResizeHandle,
  };
}

export type PanesParts = ReturnType<typeof createPanes>;
