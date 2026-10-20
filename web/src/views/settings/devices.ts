// Settings → Devices: microphone, speaker, voice filters, connection
// test and notifications.

import { loadAudioPrefs, saveAudioPrefs } from "../../audio-prefs";
import {
  needsHomeScreen,
  notificationsEnabled,
  notificationsSupported,
  setNotificationsEnabled,
} from "../../notifications";
import { type VoiceClient } from "../../voice";
import { MAX_VOLUME } from "../../voice/util";
import { noiseFilterSupported } from "../../voice/voice-filters";
import { renderConnectionTest } from "./connection-test";
import { group, levelMeter, row, selectRow, sliderRow, switchRow } from "./widgets";

export function renderDevicesSection(container: HTMLElement, voiceClient: VoiceClient): () => void {
  const prefs = loadAudioPrefs();

  const micSelect = document.createElement("select");
  const micRow = selectRow("Input device", micSelect);
  const micMeter = levelMeter();

  const inputVolume = sliderRow(
    "Input volume",
    prefs.inputVolume,
    (value) => voiceClient.setInputVolume(value),
    MAX_VOLUME,
  );
  inputVolume.el.appendChild(micMeter.el);

  const speakerSelect = document.createElement("select");
  const speakerRow = selectRow("Output device", speakerSelect);

  const outputVolume = sliderRow(
    "Output volume",
    prefs.outputVolume,
    (value) => {
      prefs.outputVolume = value;
      saveAudioPrefs(prefs);
      voiceClient.applyOutputPrefs();
    },
    MAX_VOLUME,
  );
  const outputMeter = levelMeter();
  outputVolume.el.appendChild(outputMeter.el);

  const testSpeakerRow = row({ label: "Play test sound", action: true, onClick: () => void testSpeaker() });

  function voiceFilterRow(label: string, key: "noiseFilter" | "studioVoice"): HTMLElement {
    return switchRow(label, prefs[key], (next) => {
      prefs[key] = next;
      saveAudioPrefs(prefs);
      voiceClient.applyVoiceFilters();
    }).el;
  }
  const noiseFilterRow = noiseFilterSupported() ? voiceFilterRow("Noise filter", "noiseFilter") : null;
  const studioVoiceRow = voiceFilterRow("Studio voice", "studioVoice");

  const grantRow = row({
    label: "Allow microphone access",
    action: true,
    onClick: async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop());
        await populateDevices();
        void startMicMeter(prefs.inputDeviceId);
      } catch {
        grantRow.setValue("Blocked by the browser");
      }
    },
  });

  const soundRow = switchRow("Message sounds", prefs.notificationSoundsEnabled, (next) => {
    prefs.notificationSoundsEnabled = next;
    saveAudioPrefs(prefs);
  });

  // Notifications for calls, DMs and mentions, pushed even when closed (see notifications.ts).
  const pushRow = switchRow("Push notifications", notificationsEnabled(), async (next) => {
    const outcome = await setNotificationsEnabled(next);
    pushRow.input.checked = outcome === "on";
    pushHint.hidden = outcome !== "denied";
    if (outcome === "denied") pushHint.textContent = "Blocked in this browser's site settings.";
  });
  const pushHint = document.createElement("p");
  pushHint.className = "settings-row-hint";
  pushHint.hidden = true;
  pushHint.setAttribute("aria-live", "polite");
  if (!notificationsSupported()) {
    pushRow.input.disabled = true;
    pushHint.textContent = needsHomeScreen()
      ? "Add Chatly to the Home Screen first."
      : "Not supported in this browser.";
    pushHint.hidden = false;
  }

  // Live mic level meter: its own short-lived getUserMedia capture and
  // AnalyserNode, entirely separate from `voiceClient` (which only has
  // a stream at all while actually in a call) — closed by `stopMicMeter`
  // whenever the device changes or this tab/modal goes away, never left
  // running in the background.
  let meterStream: MediaStream | null = null;
  let meterAudioCtx: AudioContext | null = null;
  let meterRaf = 0;

  function stopMicMeter(): void {
    if (meterRaf) cancelAnimationFrame(meterRaf);
    meterRaf = 0;
    meterStream?.getTracks().forEach((t) => t.stop());
    meterStream = null;
    void meterAudioCtx?.close();
    meterAudioCtx = null;
    micMeter.fill.style.width = "0%";
  }

  async function startMicMeter(deviceId: string | null): Promise<void> {
    stopMicMeter();
    const AudioCtor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return;
    try {
      meterStream = await navigator.mediaDevices.getUserMedia({
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
      });
    } catch {
      // No permission (yet) — the meter just stays flat; the "Allow
      // microphone access" row is what actually surfaces this.
      return;
    }
    meterAudioCtx = new AudioCtor();
    const source = meterAudioCtx.createMediaStreamSource(meterStream);
    const analyser = meterAudioCtx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.6;
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = (): void => {
      analyser.getByteFrequencyData(data);
      const average = data.reduce((sum, v) => sum + v, 0) / data.length;
      micMeter.fill.style.width = `${Math.min(100, (average / 128) * 100)}%`;
      meterRaf = requestAnimationFrame(tick);
    };
    tick();
  }

  async function testSpeaker(): Promise<void> {
    const AudioCtor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return;
    const ctx = new AudioCtor();
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = 440;
    const gain = ctx.createGain();
    // Respect the user's own output-volume preference so the test tone
    // matches what a real call would actually sound like at their
    // current setting, not a fixed, possibly-jarring volume.
    gain.gain.value = 0.25 * prefs.outputVolume;
    const dest = ctx.createMediaStreamDestination();
    osc.connect(gain).connect(dest);

    // Routed through a real `<audio>` element (not `ctx.destination`)
    // specifically because `setSinkId` — the only way to actually pick
    // *which* output device this plays on — exists on `HTMLMediaElement`,
    // not (portably) on `AudioContext`.
    const el = document.createElement("audio");
    el.srcObject = dest.stream;
    el.autoplay = true;
    const sinkCapable = el as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
    if (prefs.outputDeviceId && sinkCapable.setSinkId) {
      try {
        await sinkCapable.setSinkId(prefs.outputDeviceId);
      } catch {
        /* device disappeared or setSinkId refused — falls back to the default output */
      }
    }

    outputMeter.fill.classList.add("testing");
    osc.start();
    setTimeout(() => {
      osc.stop();
      outputMeter.fill.classList.remove("testing");
      el.remove();
      void ctx.close();
    }, 700);
  }

  async function populateDevices(): Promise<boolean> {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputs = devices.filter((d) => d.kind === "audioinput");
    const outputs = devices.filter((d) => d.kind === "audiooutput");
    const hasLabels = inputs.some((d) => d.label) || outputs.some((d) => d.label);

    grantRow.el.hidden = hasLabels;

    micSelect.replaceChildren(
      makeOption("", "System default"),
      ...inputs.map((d, i) => makeOption(d.deviceId, d.label || `Microphone ${i + 1}`)),
    );
    micSelect.value = prefs.inputDeviceId ?? "";

    if (typeof (HTMLMediaElement.prototype as { setSinkId?: unknown }).setSinkId === "function") {
      speakerSelect.replaceChildren(
        makeOption("", "System default"),
        ...outputs.map((d, i) => makeOption(d.deviceId, d.label || `Speaker ${i + 1}`)),
      );
      speakerSelect.value = prefs.outputDeviceId ?? "";
    } else {
      speakerRow.hidden = true;
    }
    return hasLabels;
  }

  micSelect.addEventListener("change", () => {
    prefs.inputDeviceId = micSelect.value || null;
    saveAudioPrefs(prefs);
    void voiceClient.switchInputDevice(prefs.inputDeviceId);
    void startMicMeter(prefs.inputDeviceId);
  });

  speakerSelect.addEventListener("change", () => {
    prefs.outputDeviceId = speakerSelect.value || null;
    saveAudioPrefs(prefs);
    voiceClient.applyOutputPrefs();
  });

  container.append(
    group("Microphone", grantRow.el, micRow, inputVolume.el, noiseFilterRow, studioVoiceRow),
    group("Speaker", speakerRow, outputVolume.el, testSpeakerRow.el),
    renderConnectionTest(),
    group("Notifications", soundRow.el, pushRow.el, pushHint),
  );
  void populateDevices().then((hasLabels) => {
    if (hasLabels) void startMicMeter(prefs.inputDeviceId);
  });

  return stopMicMeter;
}

function makeOption(value: string, label: string): HTMLOptionElement {
  const opt = document.createElement("option");
  opt.value = value;
  opt.textContent = label;
  return opt;
}
