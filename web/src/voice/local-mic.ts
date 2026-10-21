// The local microphone: the gain graph that feeds the outgoing track (so
// "input volume" can change live) and the "you're speaking" detector.
// Split out of `VoiceClient`.

import type { RnnoiseWorkletNode } from "@sapphi-red/web-noise-suppressor";
import { loadAudioPrefs, saveAudioPrefs } from "../audio-prefs";
import { MAX_VOLUME, SPEAKING_POLL_MS, SPEAKING_THRESHOLD } from "./util";
import {
  createNoiseFilter,
  createStudioChain,
  NOISE_FILTER_SAMPLE_RATE,
  noiseFilterSupported,
  type StudioChain,
} from "./voice-filters";

export interface LocalMicOptions {
  isMuted: () => boolean;
  onSpeakingChange: (speaking: boolean) => void;
  /** "silent": the mic delivers pure digital silence (Android's
   * microphone privacy switch does this instead of failing), "paused":
   * the browser hasn't let the audio graph run yet, so nothing is sent. */
  onHealthChange: (health: MicHealth) => void;
}

export type MicHealth = "ok" | "silent" | "paused";

/** Real microphones never deliver exact zeros for this long, even in a
 * quiet room through noise suppression. */
const SILENT_AFTER_MS = 4000;

export class LocalMic {
  constructor(private readonly opts: LocalMicOptions) {}

  private audioCtx: AudioContext | null = null;

  private analyser: AnalyserNode | null = null;

  private speakingTimer: ReturnType<typeof setInterval> | null = null;

  private speaking = false;

  private health: MicHealth = "ok";

  private silentSince: number | null = null;

  /** Mic-gain pipeline: raw device audio -> `inputGainNode` ->
   * `processedStream`, which is what actually gets sent over the peer
   * connection (see `buildInputGraph`). `null` whenever there's no
   * active call, or if `AudioContext` isn't available at all (in which
   * case `processedStream` falls back to the raw stream unmodified). */
  private inputAudioCtx: AudioContext | null = null;

  private inputGainNode: GainNode | null = null;

  private inputSourceNode: MediaStreamAudioSourceNode | null = null;

  /** Optional filters between the source and `inputGainNode` (see
   * `wireInput`). The RNNoise node loads asynchronously, so a call
   * starts unfiltered and picks it up a moment later. */
  private noiseFilterNode: RnnoiseWorkletNode | null = null;

  private noiseFilterLoading: Promise<void> | null = null;

  private studioChain: StudioChain | null = null;

  processedStream: MediaStream | null = null;

  startSpeakingDetection(stream: MediaStream | null): void {
    if (!stream) return;
    const AudioCtor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return;

    this.audioCtx = new AudioCtor();
    const source = this.audioCtx.createMediaStreamSource(stream);
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyser.smoothingTimeConstant = 0.6;
    source.connect(this.analyser);

    const data = new Uint8Array(this.analyser.frequencyBinCount);
    const wave = new Float32Array(this.analyser.fftSize);
    this.silentSince = null;
    this.speakingTimer = setInterval(() => {
      if (!this.analyser) return;
      this.analyser.getByteFrequencyData(data);
      const average = data.reduce((sum, v) => sum + v, 0) / data.length;
      const isSpeaking = !this.opts.isMuted() && average > SPEAKING_THRESHOLD;
      if (isSpeaking !== this.speaking) {
        this.speaking = isSpeaking;
        this.opts.onSpeakingChange(isSpeaking);
      }
      this.checkHealth(wave);
    }, SPEAKING_POLL_MS);
  }

  /** Watches for a mic that's "working" but sends nothing anyone can
   * hear (see `MicHealth`). */
  private checkHealth(wave: Float32Array<ArrayBuffer>): void {
    const contexts = [this.audioCtx, this.inputAudioCtx].filter((c): c is AudioContext => c !== null);
    if (contexts.some((c) => c.state !== "running")) {
      this.resume();
      this.setHealth("paused");
      return;
    }
    let peak = 0;
    this.analyser?.getFloatTimeDomainData(wave);
    for (let i = 0; i < wave.length; i++) peak = Math.max(peak, Math.abs(wave[i]));
    if (this.opts.isMuted() || peak > 0) {
      this.silentSince = null;
      this.setHealth("ok");
      return;
    }
    this.silentSince ??= performance.now();
    if (performance.now() - this.silentSince > SILENT_AFTER_MS) this.setHealth("silent");
  }

  private setHealth(health: MicHealth): void {
    if (health === this.health) return;
    this.health = health;
    this.opts.onHealthChange(health);
  }

  /** Lets a paused audio graph run. Browsers only allow that from a tap
   * or key press, so it's also retried on the next one. */
  resume(): void {
    const contexts = [this.audioCtx, this.inputAudioCtx].filter((c): c is AudioContext => c !== null);
    for (const ctx of contexts) {
      if (ctx.state === "suspended") void ctx.resume().catch(() => {});
    }
    if (!this.resumeOnGesture) {
      const onGesture = (): void => {
        document.removeEventListener("pointerdown", onGesture, true);
        document.removeEventListener("keydown", onGesture, true);
        this.resumeOnGesture = null;
        for (const ctx of [this.audioCtx, this.inputAudioCtx]) {
          if (ctx?.state === "suspended") void ctx.resume().catch(() => {});
        }
      };
      this.resumeOnGesture = onGesture;
      document.addEventListener("pointerdown", onGesture, true);
      document.addEventListener("keydown", onGesture, true);
    }
  }

  private resumeOnGesture: (() => void) | null = null;

  stopSpeakingDetection(): void {
    if (this.speakingTimer !== null) {
      clearInterval(this.speakingTimer);
      this.speakingTimer = null;
    }
    void this.audioCtx?.close();
    this.audioCtx = null;
    this.analyser = null;
    if (this.speaking) {
      this.speaking = false;
      this.opts.onSpeakingChange(false);
    }
    this.setHealth("ok");
  }

  /** Builds the mic-gain pipeline that feeds the outgoing audio
   * transceiver: `stream` (raw device audio) -> optional filters (see
   * `wireInput`) -> `inputGainNode` -> a limiter ->
   * `processedStream` (an `AudioContext` destination's stream). Doing
   * the gain adjustment ourselves, rather than relying on OS/hardware
   * mic boost, is what lets `setInputVolume` change it live without
   * re-requesting `getUserMedia` or renegotiating. Falls back to
   * sending `stream` unmodified if `AudioContext` isn't available at
   * all (very old browsers). */
  buildInputGraph(stream: MediaStream | null): void {
    const AudioCtor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) {
      this.processedStream = stream;
      return;
    }
    // With no mic at all (blocked), the graph still runs, so the call
    // has an (empty) outgoing track a mic can be plugged into later.
    this.inputAudioCtx = this.createInputContext(AudioCtor, stream);
    this.inputSourceNode = stream ? this.inputAudioCtx.createMediaStreamSource(stream) : null;
    this.inputGainNode = this.inputAudioCtx.createGain();
    this.inputGainNode.gain.value = loadAudioPrefs().inputVolume;
    // Input volume goes past 100% for a quiet (phone) mic; the limiter
    // keeps that boost from clipping on loud words.
    const limiter = this.inputAudioCtx.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.12;
    const dest = this.inputAudioCtx.createMediaStreamDestination();
    this.inputGainNode.connect(limiter).connect(dest);
    this.processedStream = dest.stream;
    this.applyFilters();
  }

  /** A 48 kHz context when the browser allows one, since RNNoise needs
   * that rate. Some browsers (Firefox) refuse a mic source whose rate
   * differs from the context's, so that falls back to the default rate
   * and the noise filter simply stays out of the graph. */
  private createInputContext(AudioCtor: typeof AudioContext, stream: MediaStream | null): AudioContext {
    if (noiseFilterSupported()) {
      try {
        const ctx = new AudioCtor({ sampleRate: NOISE_FILTER_SAMPLE_RATE });
        if (stream) ctx.createMediaStreamSource(stream).disconnect();
        return ctx;
      } catch {
        /* fall through to the default rate */
      }
    }
    return new AudioCtor();
  }

  /** Re-reads the filter switches and rewires the graph to match, live,
   * with no rejoin. */
  applyFilters(): void {
    const ctx = this.inputAudioCtx;
    if (!ctx) return;
    const prefs = loadAudioPrefs();
    if (prefs.studioVoice && !this.studioChain) this.studioChain = createStudioChain(ctx);
    if (prefs.noiseFilter && !this.noiseFilterNode && !this.noiseFilterLoading) {
      this.noiseFilterLoading = createNoiseFilter(ctx).then((node) => {
        this.noiseFilterLoading = null;
        if (!node) return;
        if (this.inputAudioCtx !== ctx) {
          node.destroy();
          return;
        }
        this.noiseFilterNode = node;
        this.wireInput();
      });
    }
    this.wireInput();
  }

  /** source -> [noise filter] -> [studio voice] -> gain -> destination. */
  private wireInput(): void {
    if (!this.inputSourceNode || !this.inputGainNode) return;
    const prefs = loadAudioPrefs();
    this.inputSourceNode.disconnect();
    this.noiseFilterNode?.disconnect();
    this.studioChain?.output.disconnect();
    let tail: AudioNode = this.inputSourceNode;
    if (prefs.noiseFilter && this.noiseFilterNode) {
      tail.connect(this.noiseFilterNode);
      tail = this.noiseFilterNode;
    }
    if (prefs.studioVoice && this.studioChain) {
      tail.connect(this.studioChain.input);
      tail = this.studioChain.output;
    }
    tail.connect(this.inputGainNode);
  }

  /** Live mic-gain adjustment — takes effect immediately, no rejoin
   * needed, since it just changes the gain node already sitting
   * between the mic and the outgoing track (see `buildInputGraph`). */
  setInputVolume(value: number): void {
    const clamped = Math.min(MAX_VOLUME, Math.max(0, value));
    if (this.inputGainNode) this.inputGainNode.gain.value = clamped;
    const prefs = loadAudioPrefs();
    prefs.inputVolume = clamped;
    saveAudioPrefs(prefs);
  }

  /** Sends a different microphone into the same gain graph, so the
   * outgoing track (the destination's output) never changes. Returns
   * false when there's no graph (no AudioContext), and the caller must
   * swap the raw track on the sender instead. */
  rewire(newStream: MediaStream): boolean {
    if (!this.inputAudioCtx || !this.inputGainNode) return false;
    this.inputSourceNode?.disconnect();
    this.resume();
    this.inputSourceNode = this.inputAudioCtx.createMediaStreamSource(newStream);
    this.wireInput();
    return true;
  }

  /** Tears the mic graph down (end of a call). */
  disposeInput(): void {
    this.inputSourceNode?.disconnect();
    this.inputSourceNode = null;
    this.inputGainNode = null;
    this.noiseFilterNode?.destroy();
    this.noiseFilterNode = null;
    this.noiseFilterLoading = null;
    this.studioChain = null;
    void this.inputAudioCtx?.close();
    this.inputAudioCtx = null;
    this.processedStream = null;
  }
}
