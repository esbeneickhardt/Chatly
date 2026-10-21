// Whether the people in your call can hear you, and if not why: what the
// banner shows you and what everyone else is told (gateway op 13). Fed by
// the mic track's own events and `LocalMic`'s health check. Split out of
// `VoiceClient`.

import type { MicHealth } from "./local-mic";

/** Why the people in your call can't hear you, if they can't:
 * "blocked" (no permission, or no microphone at all), "stopped" (the
 * mic went away mid-call: unplugged, taken by another app, permission
 * revoked), "silent" (it sends pure silence, e.g. Android's microphone
 * privacy switch), "paused" (the browser hasn't let audio start yet). */
export type MicProblem = "blocked" | "stopped" | "silent" | "paused";

export interface MicStatusOptions {
  inCall: () => boolean;
  /** Tells everyone else in the call. */
  send: (problem: boolean) => void;
  onChange: (problem: MicProblem | null) => void;
}

export class MicStatus {
  constructor(private readonly opts: MicStatusOptions) {}

  private health: MicHealth = "ok";

  private trackProblem: "blocked" | "stopped" | null = null;

  private problem: MicProblem | null = null;

  get current(): MicProblem | null {
    return this.problem;
  }

  /** Only the audio graph is waiting to start; the mic itself is fine. */
  get onlyPaused(): boolean {
    return this.trackProblem === null && this.health === "paused";
  }

  setHealth(health: MicHealth): void {
    this.health = health;
    this.update();
  }

  setTrackProblem(problem: "blocked" | "stopped" | null): void {
    this.noteTrackProblem(problem);
    this.update();
  }

  /** Records it without telling anyone yet: while joining, before the
   * call exists for the others (`announceAfresh` follows). */
  noteTrackProblem(problem: "blocked" | "stopped" | null): void {
    this.trackProblem = problem;
  }

  /** After a fresh join: the others start from nothing, so say it again. */
  announceAfresh(): void {
    this.problem = null;
    this.update();
  }

  /** Someone new joined the call and hasn't heard yet. */
  reannounce(): void {
    if (this.opts.inCall() && this.problem) this.opts.send(true);
  }

  update(): void {
    const health = this.health === "ok" ? null : this.health;
    const problem = this.opts.inCall() ? (this.trackProblem ?? health) : null;
    if (problem === this.problem) return;
    const wasReported = this.problem !== null;
    this.problem = problem;
    if (this.opts.inCall() && wasReported !== (problem !== null)) this.opts.send(problem !== null);
    this.opts.onChange(problem);
  }

  /** A mic that disappears mid-call ("ended"), or that the system cuts
   * off for a while ("mute": another app took it), is a problem worth
   * showing; it clears when the track comes back. `isCurrent` says
   * whether `stream` is still the call's mic. */
  watchTrack(stream: MediaStream, isCurrent: () => boolean): void {
    for (const track of stream.getAudioTracks()) {
      let mutedTimer: ReturnType<typeof setTimeout> | null = null;
      track.addEventListener("ended", () => {
        if (isCurrent()) this.setTrackProblem("stopped");
      });
      track.addEventListener("mute", () => {
        mutedTimer ??= setTimeout(() => {
          mutedTimer = null;
          if (isCurrent() && track.muted) this.setTrackProblem("stopped");
        }, 2000);
      });
      track.addEventListener("unmute", () => {
        if (mutedTimer) clearTimeout(mutedTimer);
        mutedTimer = null;
        if (isCurrent() && this.trackProblem === "stopped" && track.readyState === "live") {
          this.setTrackProblem(null);
        }
      });
    }
  }
}
