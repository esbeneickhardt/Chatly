// Playback of everyone else's audio in a call: one hidden `<audio>` per
// person (and one more per screen share), their volume and output device,
// the boost past 100% through Web Audio, and the "who is speaking" rings.
// Split out of `VoiceClient`, which now only decides *which* streams to
// hand it.

import { loadAudioPrefs } from "../audio-prefs";
import type { SinkCapable } from "./util";
import {
  REMOTE_SPEAKING_HOLD_MS,
  REMOTE_SPEAKING_RMS,
  SPEAKING_POLL_MS,
  splitVideoKey,
  videoKey,
} from "./util";

export interface RemoteAudioOptions {
  isDeafened: () => boolean;
  onSpeakingChange: (userId: string, speaking: boolean) => void;
  onScreenAudioChange: (userId: string, active: boolean) => void;
}

export class RemoteAudio {
  constructor(private readonly opts: RemoteAudioOptions) {}

  private remoteAudioEls = new Map<string, HTMLAudioElement>();

  /** One analyser per remote mic stream, all sharing one
   * `AudioContext`, polled together on a single timer — see
   * `watchRemoteSpeaking`. */
  private remoteAnalyserCtx: AudioContext | null = null;

  private remoteAnalysers = new Map<
    string,
    {
      stream: MediaStream;
      analyser: AnalyserNode;
      data: Float32Array<ArrayBuffer>;
      speaking: boolean;
      lastAbove: number;
    }
  >();

  private remoteSpeakingTimer: ReturnType<typeof setInterval> | null = null;

  /** Above-100% playback path, keyed like `remoteAudioEls` — see
   * `applyOutputSettingsTo`. Only exists for a key while its volume is
   * actually boosted; below that the plain element handles it. */
  private boostCtx: AudioContext | null = null;

  private remoteBoosts = new Map<
    string,
    {
      stream: MediaStream;
      source: MediaStreamAudioSourceNode;
      gain: GainNode;
      limiter: DynamicsCompressorNode;
    }
  >();

  /** Taps a remote mic stream with an `AnalyserNode` (never connected
   * on to the speakers — the stream's own `<audio>` element already
   * plays it) and reports speaking changes via `onRemoteSpeakingChange`.
   * Chrome only feeds a remote WebRTC stream into the Web Audio graph
   * once it's also attached to a media element, which
   * `attachRemoteTrack` has always done just before calling this. */
  private watchRemoteSpeaking(userId: string, stream: MediaStream): void {
    const existing = this.remoteAnalysers.get(userId);
    if (existing?.stream === stream) return;
    const AudioCtor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return;
    this.remoteAnalyserCtx ??= new AudioCtor();
    const ctx = this.remoteAnalyserCtx;
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.6;
    source.connect(analyser);
    this.remoteAnalysers.set(userId, {
      stream,
      analyser,
      data: new Float32Array(new ArrayBuffer(analyser.fftSize * 4)),
      speaking: existing?.speaking ?? false,
      lastAbove: 0,
    });

    this.remoteSpeakingTimer ??= setInterval(() => {
      const now = performance.now();
      for (const [id, entry] of this.remoteAnalysers) {
        // RMS of the raw waveform, not the frequency-bin average the
        // local check above uses: a remote stream has already been
        // through the sender's gain/noise suppression and Opus, and
        // its energy can sit in a narrow band (a tone, a hum-free
        // vowel) that barely moves an average taken across every bin —
        // RMS tracks how loud it actually is regardless of spectrum
        // shape. The short hold keeps the ring from flickering off in
        // the gaps between words.
        entry.analyser.getFloatTimeDomainData(entry.data);
        let sum = 0;
        for (let i = 0; i < entry.data.length; i++) sum += entry.data[i] * entry.data[i];
        const rms = Math.sqrt(sum / entry.data.length);
        if (rms > REMOTE_SPEAKING_RMS) entry.lastAbove = now;
        const isSpeaking = now - entry.lastAbove < REMOTE_SPEAKING_HOLD_MS;
        if (isSpeaking !== entry.speaking) {
          entry.speaking = isSpeaking;
          this.opts.onSpeakingChange(id, isSpeaking);
        }
      }
    }, SPEAKING_POLL_MS);
  }

  private stopRemoteSpeakingWatch(): void {
    if (this.remoteSpeakingTimer !== null) {
      clearInterval(this.remoteSpeakingTimer);
      this.remoteSpeakingTimer = null;
    }
    for (const [id, entry] of this.remoteAnalysers) {
      if (entry.speaking) this.opts.onSpeakingChange(id, false);
    }
    this.remoteAnalysers.clear();
    void this.remoteAnalyserCtx?.close();
    this.remoteAnalyserCtx = null;
  }

  private applyOutputSettingsTo(el: HTMLAudioElement, key: string): void {
    const prefs = loadAudioPrefs();
    const personal = prefs.remoteVolumes[key] ?? 1;
    const level = this.opts.isDeafened() ? 0 : Math.max(0, prefs.outputVolume * personal);
    const sinkCapable = el as SinkCapable;
    if (prefs.outputDeviceId && sinkCapable.setSinkId) {
      void sinkCapable.setSinkId(prefs.outputDeviceId).catch(() => {
        /* setSinkId can fail if the device disappeared; keep default output */
      });
    }
    if (level > 1 && this.startBoost(el, key, level, prefs.outputDeviceId)) return;
    this.stopBoost(key);
    el.muted = false;
    el.volume = Math.min(1, level);
  }

  /** Plays `el`'s stream through a gain node so it can go past 100%
   * (an element's own `volume` can't). The element stays attached but
   * muted — Chrome only feeds a remote WebRTC stream into the Web
   * Audio graph while an element is consuming it. A soft limiter sits
   * after the gain so a boosted loud passage compresses instead of
   * clipping. Returns false (leaving the caller on the plain element
   * path, capped at 100%) when Web Audio isn't usable, or when the
   * user picked a specific speaker and this browser can't route an
   * `AudioContext` to it — boosting onto the wrong device would be
   * worse than not boosting. */
  private startBoost(el: HTMLAudioElement, key: string, level: number, deviceId: string | null): boolean {
    const stream = el.srcObject;
    if (!(stream instanceof MediaStream)) return false;
    const AudioCtor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return false;
    this.boostCtx ??= new AudioCtor();
    const ctx = this.boostCtx;
    if (deviceId) {
      const routable = ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> };
      if (!routable.setSinkId) return false;
      void routable.setSinkId(deviceId).catch(() => {});
    }
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});

    let boost = this.remoteBoosts.get(key);
    if (boost && boost.stream !== stream) {
      this.stopBoost(key);
      boost = undefined;
    }
    if (!boost) {
      const source = ctx.createMediaStreamSource(stream);
      const gain = ctx.createGain();
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -6;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.15;
      source.connect(gain).connect(limiter).connect(ctx.destination);
      boost = { stream, source, gain, limiter };
      this.remoteBoosts.set(key, boost);
    }
    boost.gain.gain.value = level;
    el.muted = true;
    return true;
  }

  private stopBoost(key: string): void {
    const boost = this.remoteBoosts.get(key);
    if (!boost) return;
    boost.source.disconnect();
    boost.gain.disconnect();
    boost.limiter.disconnect();
    this.remoteBoosts.delete(key);
  }

  private stopAllBoosts(): void {
    for (const key of [...this.remoteBoosts.keys()]) this.stopBoost(key);
    void this.boostCtx?.close();
    this.boostCtx = null;
  }

  /** Plays one incoming audio track: a person's mic, or their screen
   * share's audio (which gets its own element and volume). `taggedPurpose`
   * is the server's `"screen"` tag from the stream id, if any. */
  attach(
    userId: string,
    taggedPurpose: string | undefined,
    stream: MediaStream,
    track: MediaStreamTrack,
  ): void {
    // Screen-share audio gets its own element/key (`videoKey`'s
    // `<user>:screen` format) so it can have an independent volume from
    // the person's mic.
    const isScreenAudio = taggedPurpose === "screen";
    const audioKey = isScreenAudio ? videoKey(userId, "screen") : userId;
    let el = this.remoteAudioEls.get(audioKey);
    if (!el) {
      el = document.createElement("audio");
      el.autoplay = true;
      el.hidden = true;
      document.body.appendChild(el);
      this.remoteAudioEls.set(audioKey, el);
      if (isScreenAudio) this.opts.onScreenAudioChange(userId, true);
    }
    el.srcObject = stream;
    this.applyOutputSettingsTo(el, audioKey);
    if (!isScreenAudio) this.watchRemoteSpeaking(userId, stream);
    if (isScreenAudio) {
      track.addEventListener("ended", () => {
        if (this.remoteAudioEls.get(audioKey) === el) {
          this.remoteAudioEls.delete(audioKey);
          this.stopBoost(audioKey);
          el?.remove();
          this.opts.onScreenAudioChange(userId, false);
        }
      });
    }
  }

  /** Re-applies the output volume/device preference (and deafen) to every live element. */
  applyPrefs(): void {
    for (const [key, el] of this.remoteAudioEls.entries()) {
      this.applyOutputSettingsTo(el, key);
    }
  }

  /** Re-applies preferences to one element — after its volume changed. */
  applyTo(key: string): void {
    const el = this.remoteAudioEls.get(key);
    if (el) this.applyOutputSettingsTo(el, key);
  }

  /** Stops and removes everything: at the end of a call. */
  clear(): void {
    this.stopRemoteSpeakingWatch();
    for (const [key, el] of this.remoteAudioEls.entries()) {
      el.remove();
      if (key.includes(":")) {
        const [userId] = splitVideoKey(key);
        this.opts.onScreenAudioChange(userId, false);
      }
    }
    this.remoteAudioEls.clear();
    this.stopAllBoosts();
  }
}
