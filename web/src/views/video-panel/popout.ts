// Pop-outs: taking one video out of the page so it can sit somewhere else
// on screen while you do something else with the rest of the call.
//
// Three ways, tried in this order for each video:
//   1. Document Picture-in-Picture (Chrome, Edge): one small always-on-top
//      window that holds every popped-out video together. On a Mac it floats
//      over a full-screen app, which is what makes "watch the movie full
//      screen and still see your friend" work with more than one video.
//   2. The browser's native video Picture-in-Picture (Safari, and Chrome
//      without the above): also always on top, but only one video at a time.
//   3. A real browser window of its own, for browsers with neither (Firefox).
//      It is an ordinary window, so a full-screen app hides it (macOS gives
//      a full-screen app its own Space); we say so instead of leaving people
//      to wonder.

import { showNotice } from "../../ui";

/** Called when a tile starts or stops being popped out, so the panel can
 * give its space to the other tiles (and bring it back). */
export type PopoutChange = (tileKey: string, poppedOut: boolean) => void;

export type PopoutApi = ReturnType<typeof createPopouts>;

/** Document Picture-in-Picture is too new for TypeScript's DOM types. */
interface DocumentPipApi {
  requestWindow(options?: { width?: number; height?: number }): Promise<Window>;
}

/** How long to wait for the browser to open the always-on-top window before
 * giving up on it and trying the next way. */
const DOC_PIP_TIMEOUT_MS = 2000;

const ON_A_MAC = /Mac/i.test(navigator.platform) && !/iPhone|iPad/i.test(navigator.userAgent);

export function createPopouts(onChange: PopoutChange) {
  /** Windows opened by way 3, by tile key. */
  const windows = new Map<string, Window>();

  const docPipApi = (window as unknown as { documentPictureInPicture?: DocumentPipApi })
    .documentPictureInPicture;
  /** The one always-on-top window of way 1, and which tile is in which cell. */
  let pipWindow: Window | null = null;
  const pipCells = new Map<string, HTMLElement>();
  let warnedAboutFullScreen = false;

  const nativeSupported =
    typeof HTMLVideoElement.prototype.requestPictureInPicture === "function" &&
    "pictureInPictureEnabled" in document &&
    document.pictureInPictureEnabled;

  // Popped-out windows belong to this page: leaving takes them with it.
  window.addEventListener("pagehide", () => {
    for (const win of windows.values()) win.close();
    pipWindow?.close();
  });

  /** Whether `tileKey` is currently out of the page, by either route. */
  function isPoppedOut(tileKey: string, video: HTMLVideoElement | null): boolean {
    return (
      windows.has(tileKey) ||
      pipCells.has(tileKey) ||
      (video !== null && document.pictureInPictureElement === video)
    );
  }

  /** Puts `video` in the shared always-on-top window, opening it if this is
   * the first. False if the browser has none or would not open it. */
  async function openInSharedWindow(
    tileKey: string,
    title: string,
    video: HTMLVideoElement,
  ): Promise<boolean> {
    if (!docPipApi) return false;
    try {
      if (!pipWindow || pipWindow.closed) {
        const opened = await Promise.race([
          docPipApi.requestWindow({ width: 360, height: 240 }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("timeout")), DOC_PIP_TIMEOUT_MS),
          ),
        ]);
        pipWindow = opened;
        prepareSharedWindow(opened);
      }
      addCell(pipWindow, tileKey, title, video);
      onChange(tileKey, true);
      return true;
    } catch {
      return false;
    }
  }

  function prepareSharedWindow(win: Window): void {
    win.document.title = "Chatly";
    win.document.body.style.cssText = "margin:0;background:#000;height:100vh;overflow:hidden";
    const grid = win.document.createElement("div");
    grid.id = "popouts";
    grid.style.cssText =
      "display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));grid-auto-rows:1fr;gap:2px;height:100%";
    win.document.body.appendChild(grid);
    win.addEventListener("pagehide", () => {
      const keys = [...pipCells.keys()];
      pipCells.clear();
      if (pipWindow === win) pipWindow = null;
      for (const key of keys) onChange(key, false);
    });
  }

  function addCell(win: Window, tileKey: string, title: string, video: HTMLVideoElement): void {
    const doc = win.document;
    const cell = doc.createElement("div");
    cell.style.cssText = "position:relative;min-width:0;min-height:0;background:#000";
    const copy = doc.createElement("video");
    copy.autoplay = true;
    copy.muted = true; // sound comes from the page's own audio elements
    copy.playsInline = true;
    copy.srcObject = video.srcObject;
    copy.style.cssText = "width:100%;height:100%;object-fit:contain;display:block";
    const label = doc.createElement("span");
    label.textContent = title;
    label.style.cssText =
      "position:absolute;left:6px;bottom:6px;padding:1px 8px;border-radius:99px;background:rgba(0,0,0,.6);color:#fff;font:12px system-ui,sans-serif";
    const close = doc.createElement("button");
    close.type = "button";
    close.textContent = "\u00d7";
    close.title = "Put back in the call window";
    close.setAttribute("aria-label", `Put ${title} back in the call window`);
    close.style.cssText =
      "position:absolute;right:6px;top:6px;width:24px;height:24px;border:0;border-radius:50%;background:rgba(0,0,0,.6);color:#fff;font:16px/1 system-ui,sans-serif;cursor:pointer";
    close.addEventListener("click", () => removeCell(tileKey));
    cell.append(copy, label, close);
    doc.getElementById("popouts")?.appendChild(cell);
    pipCells.set(tileKey, cell);
    void copy.play().catch(() => undefined);
  }

  function removeCell(tileKey: string): void {
    const cell = pipCells.get(tileKey);
    if (!cell) return;
    cell.remove();
    pipCells.delete(tileKey);
    onChange(tileKey, false);
    if (pipCells.size === 0) pipWindow?.close();
  }

  function openWindow(tileKey: string, title: string, video: HTMLVideoElement): boolean {
    const win = window.open("", `chatly-popout-${tileKey}`, "popup=yes,width=520,height=320");
    if (!win) return false;
    win.document.title = title;
    win.document.body.style.cssText = "margin:0;background:#000;overflow:hidden";
    const copy = win.document.createElement("video");
    copy.autoplay = true;
    copy.muted = true; // sound comes from the page's own audio elements
    copy.playsInline = true;
    copy.srcObject = video.srcObject;
    copy.style.cssText = "width:100vw;height:100vh;object-fit:contain;display:block";
    copy.addEventListener("dblclick", () => {
      if (win.document.fullscreenElement) void win.document.exitFullscreen();
      else void copy.requestFullscreen().catch(() => undefined);
    });
    win.document.body.replaceChildren(copy);
    void copy.play().catch(() => undefined);
    windows.set(tileKey, win);
    win.addEventListener("pagehide", () => {
      if (windows.get(tileKey) === win) {
        windows.delete(tileKey);
        onChange(tileKey, false);
      }
    });
    onChange(tileKey, true);
    return true;
  }

  /** Pops `video` out, or brings it back if it already is. */
  async function toggle(tileKey: string, title: string, video: HTMLVideoElement): Promise<void> {
    const open = windows.get(tileKey);
    if (open) {
      open.close();
      return;
    }
    if (pipCells.has(tileKey)) {
      removeCell(tileKey);
      return;
    }
    if (document.pictureInPictureElement === video) {
      await document.exitPictureInPicture().catch(() => undefined);
      return;
    }
    if (await openInSharedWindow(tileKey, title, video)) return;
    // Native next — unless another video already holds the one slot, in
    // which case taking it would silently throw that one back.
    if (nativeSupported && !document.pictureInPictureElement) {
      try {
        await video.requestPictureInPicture();
        return;
      } catch {
        // Not ready, or refused: a window still works.
      }
    }
    if (!openWindow(tileKey, title, video)) {
      showNotice("Your browser blocked the pop-out window. Allow pop-ups for this site and try again.");
      return;
    }
    if (ON_A_MAC && !warnedAboutFullScreen) {
      warnedAboutFullScreen = true;
      showNotice(
        "This browser can't keep a pop-out on top of a full-screen app. Use Focus and Hide chat instead of Full screen to keep it in view, or use Chrome, Edge or Safari for a window that stays on top.",
      );
    }
  }

  /** The tile's video changed (a new stream after a reconnect): keep an
   * open window showing the current one. */
  function refresh(tileKey: string, video: HTMLVideoElement): void {
    const copy =
      windows.get(tileKey)?.document.querySelector("video") ?? pipCells.get(tileKey)?.querySelector("video");
    if (copy && copy.srcObject !== video.srcObject) copy.srcObject = video.srcObject;
  }

  /** The tile is gone (the camera turned off, the person left). */
  function closeFor(tileKey: string): void {
    windows.get(tileKey)?.close();
    removeCell(tileKey);
  }

  return { toggle, isPoppedOut, refresh, closeFor, nativeSupported };
}
