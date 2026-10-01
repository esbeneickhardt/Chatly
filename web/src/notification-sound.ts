// Short synthesized tones for new-message and voice-presence
// notifications — generated with the Web Audio API rather than
// shipping audio assets, so there's nothing to fetch or license.

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  audioCtx ??= new Ctor();
  return audioCtx;
}

/** Plays a short sequence of tones, each `{freq, at, duration}` (`at`
 * and `duration` in seconds from now). Shared by every notification
 * sound below so each one is just a different tiny melody. */
function playTones(tones: { freq: number; at: number; duration: number; peakGain?: number }[]): void {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    // A context created (or left) before the page ever had a user
    // gesture starts out `suspended` under every browser's autoplay
    // policy and plays nothing at all — which is exactly what an
    // incoming call's ring hits on a tab nobody's clicked in since it
    // loaded. `resume()` is a harmless no-op once it's already running.
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});
    const now = ctx.currentTime;
    for (const { freq, at, duration, peakGain = 0.2 } of tones) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now + at);
      gain.gain.setValueAtTime(0.0001, now + at);
      gain.gain.exponentialRampToValueAtTime(peakGain, now + at + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + at + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + at);
      osc.stop(now + at + duration + 0.02);
    }
  } catch {
    /* audio unsupported or blocked by an autoplay policy — skip silently */
  }
}

export function playNotificationSound(): void {
  playTones([{ freq: 880, at: 0, duration: 0.25 }]);
}

export function playVoiceJoinSound(): void {
  playTones([
    { freq: 523, at: 0, duration: 0.12 },
    { freq: 784, at: 0.09, duration: 0.16 },
  ]);
}

export function playVoiceLeaveSound(): void {
  playTones([
    { freq: 784, at: 0, duration: 0.12 },
    { freq: 523, at: 0.09, duration: 0.18 },
  ]);
}

/** Quieter versions for someone *else* joining/leaving a voice channel
 * you're already in — the same shape so they're recognizable, but
 * less attention-grabbing than your own join/leave. */
export function playVoicePeerJoinSound(): void {
  playTones([
    { freq: 523, at: 0, duration: 0.1, peakGain: 0.09 },
    { freq: 784, at: 0.08, duration: 0.14, peakGain: 0.09 },
  ]);
}

export function playVoicePeerLeaveSound(): void {
  playTones([
    { freq: 784, at: 0, duration: 0.1, peakGain: 0.09 },
    { freq: 523, at: 0.08, duration: 0.16, peakGain: 0.09 },
  ]);
}

/** One "ring" of an incoming call — a classic two-tone phone-style
 * pattern. Meant to be called repeatedly (see chat.ts's incoming-call
 * banner) for as long as the call is still ringing, not just once. */
export function playIncomingCallSound(): void {
  playTones([
    { freq: 440, at: 0, duration: 0.35, peakGain: 0.16 },
    { freq: 480, at: 0.4, duration: 0.35, peakGain: 0.16 },
  ]);
}

/** The caller's side of the ring: what you hear while waiting for
 * someone to pick up — a single, lower, softer tone than the callee's
 * two-tone ring above, so the two are never mistaken for each other
 * (or for a notification). Like `playIncomingCallSound`, meant to be
 * repeated for as long as it's still ringing. */
export function playOutgoingCallSound(): void {
  playTones([
    { freq: 425, at: 0, duration: 0.9, peakGain: 0.09 },
    { freq: 425, at: 1.1, duration: 0.9, peakGain: 0.09 },
  ]);
}

/** Creates/resumes the shared audio context on the page's first user
 * gesture, so a *later* sound with no gesture of its own (an incoming
 * call ringing in a tab that's been sitting idle since it loaded) is
 * actually allowed to play. Call once at startup. */
export function installAudioUnlock(): void {
  const unlock = (): void => {
    const ctx = getAudioContext();
    if (ctx?.state === "suspended") void ctx.resume().catch(() => {});
    window.removeEventListener("pointerdown", unlock, true);
    window.removeEventListener("keydown", unlock, true);
    window.removeEventListener("touchend", unlock, true);
  };
  window.addEventListener("pointerdown", unlock, true);
  window.addEventListener("keydown", unlock, true);
  window.addEventListener("touchend", unlock, true);
}
