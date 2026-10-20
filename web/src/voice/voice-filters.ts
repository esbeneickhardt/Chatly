// Optional voice filters for the outgoing mic, both off by default
// (see `AudioPrefs.noiseFilter` / `studioVoice`): RNNoise for
// background noise, and a "studio voice" chain of plain Web Audio
// nodes (rumble cut, a little presence, compression). Everything runs
// on this device; nothing is sent anywhere but the processed audio.

import { loadRnnoise, RnnoiseWorkletNode } from "@sapphi-red/web-noise-suppressor";
import rnnoiseWasmUrl from "@sapphi-red/web-noise-suppressor/rnnoise.wasm?url";
import rnnoiseSimdWasmUrl from "@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url";
import rnnoiseWorkletUrl from "@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url";

/** RNNoise's model is trained on 48 kHz audio and the worklet assumes
 * it, so the mic graph asks for this rate whenever it can. */
export const NOISE_FILTER_SAMPLE_RATE = 48000;

export function noiseFilterSupported(): boolean {
  return typeof AudioWorkletNode !== "undefined" && typeof WebAssembly !== "undefined";
}

// One fetch of the wasm per page load, however many calls get joined.
let wasmBinary: Promise<ArrayBuffer> | null = null;

/** An RNNoise node for `ctx`, or null if this browser can't run it (no
 * AudioWorklet, a context not at 48 kHz, or the wasm failed to load).
 * Callers just leave the node out of the graph in that case. */
export async function createNoiseFilter(ctx: AudioContext): Promise<RnnoiseWorkletNode | null> {
  if (!noiseFilterSupported() || ctx.sampleRate !== NOISE_FILTER_SAMPLE_RATE) return null;
  try {
    wasmBinary ??= loadRnnoise({ url: rnnoiseWasmUrl, simdUrl: rnnoiseSimdWasmUrl });
    const [binary] = await Promise.all([wasmBinary, ctx.audioWorklet.addModule(rnnoiseWorkletUrl)]);
    return new RnnoiseWorkletNode(ctx, { maxChannels: 1, wasmBinary: binary });
  } catch (err) {
    wasmBinary = null;
    console.warn("[voice] noise filter unavailable", err);
    return null;
  }
}

export interface StudioChain {
  input: AudioNode;
  output: AudioNode;
}

/** High-pass (rumble, desk bumps) -> a small cut in the boxy low mids
 * -> a presence lift -> a compressor for an even, close-up level ->
 * make-up gain -> a fast limiter so the make-up never clips. */
export function createStudioChain(ctx: AudioContext): StudioChain {
  const highPass = ctx.createBiquadFilter();
  highPass.type = "highpass";
  highPass.frequency.value = 85;
  highPass.Q.value = 0.7;

  const lowMid = ctx.createBiquadFilter();
  lowMid.type = "peaking";
  lowMid.frequency.value = 300;
  lowMid.Q.value = 1;
  lowMid.gain.value = -2;

  const presence = ctx.createBiquadFilter();
  presence.type = "peaking";
  presence.frequency.value = 3200;
  presence.Q.value = 0.9;
  presence.gain.value = 3;

  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -26;
  compressor.knee.value = 10;
  compressor.ratio.value = 4;
  compressor.attack.value = 0.005;
  compressor.release.value = 0.2;

  const makeUp = ctx.createGain();
  makeUp.gain.value = 1.8;

  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -2;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.1;

  highPass.connect(lowMid).connect(presence).connect(compressor).connect(makeUp).connect(limiter);
  return { input: highPass, output: limiter };
}
