// Everyone else's camera and screen-share video in a call: one ready-to-
// mount `<video>` per person and purpose, handed to the UI as it starts
// and taken back when it stops. Split out of `VoiceClient`.

import { splitVideoKey, videoKey } from "./util";

export interface RemoteVideoOptions {
  /** A video started (`el`) or stopped (`null`). */
  onChange: (userId: string, purpose: "camera" | "screen", el: HTMLVideoElement | null) => void;
}

export class RemoteVideo {
  constructor(private readonly opts: RemoteVideoOptions) {}

  /** Keyed by `videoKey(userId, purpose)` — see that helper. */
  private els = new Map<string, HTMLVideoElement>();

  attach(userId: string, purpose: "camera" | "screen", stream: MediaStream, track: MediaStreamTrack): void {
    const key = videoKey(userId, purpose);
    let el = this.els.get(key);
    if (!el) {
      el = document.createElement("video");
      el.autoplay = true;
      el.playsInline = true;
      // This sender's audio plays via its own <audio> element (a
      // separate stream, see `VoiceClient.attachRemoteTrack`) — muting
      // the video element avoids doubled-up sound if the browser ever
      // groups them together anyway.
      el.muted = true;
      // Belt-and-suspenders alongside the properties above — see the
      // matching comment in chat.ts's onLocalVideo for why some
      // WebKit/mobile Safari versions want the HTML attributes too,
      // not just these DOM properties, for muted autoplay of a
      // programmatically-built video element to reliably start.
      el.setAttribute("autoplay", "");
      el.setAttribute("playsinline", "");
      el.setAttribute("muted", "");
      this.els.set(key, el);
      this.opts.onChange(userId, purpose, el);
    }
    el.srcObject = stream;
    track.addEventListener("ended", () => {
      if (this.els.get(key) === el) {
        this.els.delete(key);
        this.opts.onChange(userId, purpose, null);
      }
    });
  }

  /** Takes every video back: at the end of a call. */
  clear(): void {
    for (const key of this.els.keys()) {
      const [userId, purpose] = splitVideoKey(key);
      this.opts.onChange(userId, purpose, null);
    }
    this.els.clear();
  }
}
