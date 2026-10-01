// The local microphone: the gain graph that feeds the outgoing track (so
// "input volume" can change live) and the "you're speaking" detector.
// Split out of `VoiceClient`.

import { loadAudioPrefs, saveAudioPrefs } from "../audio-prefs";
import { SPEAKING_POLL_MS, SPEAKING_THRESHOLD } from "./util";

export interface LocalMicOptions {
  isMuted: () => boolean;
  onSpeakingChange: (speaking: boolean) => void;
}

export class LocalMic {
  constructor(private readonly opts: LocalMicOptions) {}

  private audioCtx: AudioContext | null = null;

  private analyser: AnalyserNode | null = null;

  private speakingTimer: ReturnType<typeof setInterval> | null = null;

  private speaking = false;

  /** Mic-gain pipeline: raw device audio -> `inputGainNode` ->
   * `processedStream`, which is what actually gets sent over the peer
   * connection (see `buildInputGraph`). `null` whenever there's no
   * active call, or if `AudioContext` isn't available at all (in which
   * case `processedStream` falls back to the raw stream unmodified). */
  private inputAudioCtx: AudioContext | null = null;

  private inputGainNode: GainNode | null = null;

  private inputSourceNode: MediaStreamAudioSourceNode | null = null;

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
    this.speakingTimer = setInterval(() => {
      if (!this.analyser) return;
      this.analyser.getByteFrequencyData(data);
      const average = data.reduce((sum, v) => sum + v, 0) / data.length;
      const isSpeaking = !this.opts.isMuted() && average > SPEAKING_THRESHOLD;
      if (isSpeaking !== this.speaking) {
        this.speaking = isSpeaking;
        this.opts.onSpeakingChange(isSpeaking);
      }
    }, SPEAKING_POLL_MS);
  }

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
  }

  /** Builds the mic-gain pipeline that feeds the outgoing audio
   * transceiver: `stream` (raw device audio) -> `inputGainNode` ->
   * `processedStream` (an `AudioContext` destination's stream). Doing
   * the gain adjustment ourselves, rather than relying on OS/hardware
   * mic boost, is what lets `setInputVolume` change it live without
   * re-requesting `getUserMedia` or renegotiating. Falls back to
   * sending `stream` unmodified if `AudioContext` isn't available at
   * all (very old browsers). */
  buildInputGraph(stream: MediaStream): void {
    const AudioCtor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) {
      this.processedStream = stream;
      return;
    }
    this.inputAudioCtx = new AudioCtor();
    this.inputSourceNode = this.inputAudioCtx.createMediaStreamSource(stream);
    this.inputGainNode = this.inputAudioCtx.createGain();
    this.inputGainNode.gain.value = loadAudioPrefs().inputVolume;
    const dest = this.inputAudioCtx.createMediaStreamDestination();
    this.inputSourceNode.connect(this.inputGainNode).connect(dest);
    this.processedStream = dest.stream;
  }

  /** Live mic-gain adjustment — takes effect immediately, no rejoin
   * needed, since it just changes the gain node already sitting
   * between the mic and the outgoing track (see `buildInputGraph`). */
  setInputVolume(value: number): void {
    const clamped = Math.min(1, Math.max(0, value));
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
    this.inputSourceNode = this.inputAudioCtx.createMediaStreamSource(newStream);
    this.inputSourceNode.connect(this.inputGainNode);
    return true;
  }

  /** Tears the mic graph down (end of a call). */
  disposeInput(): void {
    this.inputSourceNode?.disconnect();
    this.inputSourceNode = null;
    this.inputGainNode = null;
    void this.inputAudioCtx?.close();
    this.inputAudioCtx = null;
    this.processedStream = null;
  }
}
