// Video tiles: one tile per person and stream (camera or screen share), each with its own controls.

import { icon } from "../../icons";
import { wireSelfBubble } from "../../self-bubble";
import { MAX_REMOTE_VOLUME, videoKey } from "../../voice";
import type { VideoPanelContext } from "./context";
import type { LayoutApi } from "./layout";
import { createPopouts } from "./popout";

export type TilesApi = ReturnType<typeof createTiles>;

/** What a tile shows. A tile holds exactly one of these; the other stays null. */
export interface VideoTileStreams {
  camera: HTMLVideoElement | null;
  screen: HTMLVideoElement | null;
}

export function createTiles(ctx: VideoPanelContext, layout: LayoutApi) {
  const { videoTiles, voiceClient, wireRemoteVolumeSlider } = ctx;
  const { ensureVideoTilesVisible, layoutVideoTiles, setTilePoppedOut, toggleFocus } = layout;

  const popouts = createPopouts((tileKey, poppedOut) => {
    setTilePoppedOut(tileKey, poppedOut);
    if (tileKey === cameraTileKey("self")) ctx.separateWebcamBtn.classList.toggle("active", poppedOut);
  });

  /** `autoplay` alone leaves some mobile browsers with a black local
   * preview when the stream was attached before the element entered the
   * document; an explicit `play()` (retried once a frame later) fixes it. */
  function playVideoResilient(el: HTMLVideoElement): void {
    el.play().catch((err) => {
      console.log("[video] initial play() failed, retrying next frame:", err);
      requestAnimationFrame(() => {
        el.play().catch((err2) => console.log("[video] retried play() also failed:", err2));
      });
    });
  }

  const videoTileStreams = new Map<string, VideoTileStreams>();

  /** People whose screen share is carrying audio, so the screen-volume
   * slider only shows when it would do something. */
  const screenAudioActive = new Set<string>();

  /** A person's screen share keeps their plain key; their camera gets its
   * own tile under this one. (A plain, printable separator: this ends up
   * in a `data-*` attribute inside a selector, and a NUL did not survive
   * that round trip.) */
  function cameraTileKey(personKey: string): string {
    return `${personKey}-camera-tile`;
  }

  function tileKeyFor(personKey: string, purpose: "camera" | "screen"): string {
    return purpose === "camera" ? cameraTileKey(personKey) : personKey;
  }

  function makeButton(
    title: string,
    iconName: Parameters<typeof icon>[0],
    className = "",
  ): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `icon-button ${className}`.trim();
    btn.title = title;
    btn.setAttribute("aria-label", title);
    btn.appendChild(icon(iconName, 13));
    return btn;
  }

  function createTile(tileKey: string, personKey: string): HTMLElement {
    const tile = document.createElement("div");
    tile.className = "video-tile";
    tile.dataset.videoKey = tileKey;
    if (tileKey === "self" || tileKey === cameraTileKey("self")) wireSelfBubble(tile, videoTiles);

    // Only the video lives in this wrapper (not the label or controls):
    // it is what goes full screen, and being a plain box with no grid or
    // flex placement of its own it doesn't fight the browser's sizing.
    const mediaWrap = document.createElement("div");
    mediaWrap.className = "video-tile-media";
    tile.appendChild(mediaWrap);

    const labelEl = document.createElement("span");
    labelEl.className = "video-tile-label";
    const controls = document.createElement("div");
    controls.className = "video-tile-controls";

    const focusBtn = makeButton("Focus this video", "maximize-2", "video-tile-focus-btn");
    focusBtn.addEventListener("click", () => toggleFocus(tileKey));
    controls.appendChild(focusBtn);

    const popOutBtn = makeButton("Pop out this video", "external-link", "video-tile-popout-btn");
    popOutBtn.addEventListener("click", () => {
      const video = mediaWrap.querySelector("video");
      if (video) void popouts.toggle(tileKey, labelEl.textContent ?? "Video", video);
    });
    controls.appendChild(popOutBtn);

    if (document.fullscreenEnabled) {
      const fsBtn = makeButton("Full screen", "maximize");
      fsBtn.addEventListener("click", () => {
        if (document.fullscreenElement === mediaWrap) void document.exitFullscreen();
        else void mediaWrap.requestFullscreen();
      });
      controls.appendChild(fsBtn);
    }

    if (personKey !== "self") {
      const volumeSlider = document.createElement("input");
      volumeSlider.type = "range";
      volumeSlider.className = "video-tile-volume";
      volumeSlider.min = "0";
      volumeSlider.max = String(Math.round(MAX_REMOTE_VOLUME * 100));
      volumeSlider.title = "Their volume";
      volumeSlider.value = String(Math.round(voiceClient.getRemoteVolume(personKey) * 100));
      wireRemoteVolumeSlider(volumeSlider, personKey);
      controls.appendChild(volumeSlider);

      // Independent of the voice slider: shared media is often wanted at
      // a different level than the sharer's own voice. Shown only on the
      // screen tile, and only while that share has an audio track.
      if (tileKey === personKey) {
        const screenVolumeSlider = document.createElement("input");
        screenVolumeSlider.type = "range";
        screenVolumeSlider.className = "video-tile-volume video-tile-screen-volume";
        screenVolumeSlider.min = "0";
        screenVolumeSlider.max = String(Math.round(MAX_REMOTE_VOLUME * 100));
        screenVolumeSlider.title = "Screen share audio volume";
        screenVolumeSlider.hidden = true;
        const screenAudioKey = videoKey(personKey, "screen");
        screenVolumeSlider.value = String(Math.round(voiceClient.getRemoteVolume(screenAudioKey) * 100));
        wireRemoteVolumeSlider(screenVolumeSlider, screenAudioKey);
        controls.appendChild(screenVolumeSlider);
      }
    }

    tile.append(labelEl, controls);
    return tile;
  }

  /** @param tileKey Identifies this tile (`data-video-key`, focus, lookup).
   * @param personKey The person the video belongs to — their id, or
   * `"self"` — for volume controls, which are about them, not the tile. */
  function renderVideoTile(
    tileKey: string,
    label: string,
    streams: VideoTileStreams,
    personKey: string,
  ): void {
    const video = streams.screen ?? streams.camera;
    if (!video) return;

    let tile = videoTiles.querySelector<HTMLElement>(`[data-video-key="${tileKey}"]`);
    if (!tile) {
      tile = createTile(tileKey, personKey);
      videoTiles.appendChild(tile);
      layoutVideoTiles();
    }
    const mediaWrap = tile.querySelector<HTMLElement>(".video-tile-media");
    if (!mediaWrap) return;

    // Re-parent the existing element, never recreate it, so a playing
    // stream is not interrupted.
    for (const other of Array.from(mediaWrap.querySelectorAll("video"))) {
      if (other !== video) other.remove();
    }
    if (video.parentElement !== mediaWrap) {
      video.classList.add("video-tile-main");
      mediaWrap.appendChild(video);
      playVideoResilient(video);
    }
    if (!video.dataset.popoutWired) {
      video.dataset.popoutWired = "1";
      video.addEventListener("enterpictureinpicture", () => onNativeChange(tileKey, true));
      video.addEventListener("leavepictureinpicture", () => onNativeChange(tileKey, false));
    }
    popouts.refresh(tileKey, video);

    const labelEl = tile.querySelector(".video-tile-label");
    if (labelEl) labelEl.textContent = streams.camera ? label : `${label} · screen`;
    const screenVolumeSlider = tile.querySelector<HTMLInputElement>(".video-tile-screen-volume");
    if (screenVolumeSlider) screenVolumeSlider.hidden = !screenAudioActive.has(personKey);
    ensureVideoTilesVisible();
  }

  function onNativeChange(tileKey: string, poppedOut: boolean): void {
    setTilePoppedOut(tileKey, poppedOut);
    if (tileKey === cameraTileKey("self")) ctx.separateWebcamBtn.classList.toggle("active", poppedOut);
  }

  function removeVideoTile(tileKey: string): void {
    popouts.closeFor(tileKey);
    videoTileStreams.delete(tileKey);
    videoTiles.querySelector(`[data-video-key="${tileKey}"]`)?.remove();
    layoutVideoTiles();
    ensureVideoTilesVisible();
  }

  /** Sets, replaces or removes one person's camera or screen share. */
  function updateVideoTile(
    personKey: string,
    label: string,
    purpose: "camera" | "screen",
    el: HTMLVideoElement | null,
  ): void {
    const tileKey = tileKeyFor(personKey, purpose);
    if (!el) {
      removeVideoTile(tileKey);
      return;
    }
    const streams: VideoTileStreams = { camera: null, screen: null };
    streams[purpose] = el;
    videoTileStreams.set(tileKey, streams);
    renderVideoTile(tileKey, label, streams, personKey);
  }

  // Your own "pop out my camera" shortcut in the channel header.
  ctx.separateWebcamBtn.addEventListener("click", () => {
    const video = videoTileStreams.get(cameraTileKey("self"))?.camera;
    if (video) void popouts.toggle(cameraTileKey("self"), "You", video);
  });

  return {
    videoTileStreams,
    screenAudioActive,
    renderVideoTile,
    updateVideoTile,
  };
}
