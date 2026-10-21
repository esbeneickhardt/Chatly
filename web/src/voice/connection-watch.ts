// Keeps an eye on the peer connection's health: a call that never comes up
// is reported and ended, and one that drops is given a grace period to
// recover on its own before it's hung up. Split out of `VoiceClient`.

import { CONNECT_FAILED_MESSAGE, CONNECT_TIMEOUT_MS, RECONNECT_GRACE_MS } from "./util";

export interface ConnectionWatchOptions {
  /** Whether `pc` is still the call's connection (a rejoin replaces it). */
  isCurrent: (pc: RTCPeerConnection) => boolean;
  onReconnecting: (reconnecting: boolean) => void;
  onError: (message: string) => void;
  leave: () => void;
}

export class ConnectionWatch {
  constructor(private readonly opts: ConnectionWatchOptions) {}

  /** Set while `pc.connectionState` is "disconnected"/"failed" and
   * we're waiting out `RECONNECT_GRACE_MS` to see if it recovers. */
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  /** Set from the first offer until the connection first comes up. */
  private connectTimer: ReturnType<typeof setTimeout> | null = null;

  /** A connection that never comes up is reported and ended, instead of
   * leaving a dead call on screen. */
  watchFirstConnection(pc: RTCPeerConnection): void {
    this.clearConnectTimer();
    if (pc.connectionState === "connected") return;
    this.connectTimer = setTimeout(() => {
      this.connectTimer = null;
      if (!this.opts.isCurrent(pc) || pc.connectionState === "connected") return;
      console.log(`[voice] never connected (${pc.connectionState}, ice ${pc.iceConnectionState})`);
      this.opts.onError(CONNECT_FAILED_MESSAGE);
      this.opts.leave();
    }, CONNECT_TIMEOUT_MS);
  }

  /** A lagged network (packet loss, a brief wifi drop, a NAT rebind)
   * routinely pushes `connectionState` through "disconnected" or even
   * "failed" for a few seconds before recovering on its own — the ICE
   * agent keeps retrying in the background the whole time. Tearing the
   * call down the instant either state is seen turned an ordinary lag
   * spike into a dropped call. Instead, give it `RECONNECT_GRACE_MS`
   * (matching the server's own tolerance) to recover before leaving.
   * `pc` is the connection this listener was attached to: by the time
   * the timeout fires, a rejoin may have replaced it, and then there's
   * nothing left to give up on. */
  stateChanged(pc: RTCPeerConnection): void {
    if (pc.connectionState === "connected") {
      this.clearConnectTimer();
      this.clearReconnectTimer();
      return;
    }
    if (pc.connectionState === "closed") {
      this.clearReconnectTimer();
      this.opts.leave();
      return;
    }
    if (
      (pc.connectionState === "disconnected" || pc.connectionState === "failed") &&
      this.reconnectTimer === null
    ) {
      this.opts.onReconnecting(true);
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        const stillDown =
          this.opts.isCurrent(pc) &&
          (pc.connectionState === "failed" || pc.connectionState === "disconnected");
        this.opts.onReconnecting(false);
        if (stillDown) this.opts.leave();
      }, RECONNECT_GRACE_MS);
    }
  }

  clearConnectTimer(): void {
    if (this.connectTimer !== null) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
  }

  clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
      this.opts.onReconnecting(false);
    }
  }
}
