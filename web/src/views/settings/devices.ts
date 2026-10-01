// Settings → Devices: audio, video and notification preferences.

import { loadAudioPrefs, saveAudioPrefs } from "../../audio-prefs";
import { notificationsEnabled, notificationsSupported, setNotificationsEnabled } from "../../notifications";
import { type VoiceClient } from "../../voice";
import { renderConnectionTest } from "./connection-test";
import { field, levelMeter, section } from "./widgets";

export function renderDevicesSection(container: HTMLElement, voiceClient: VoiceClient): () => void {
  const prefs = loadAudioPrefs();

  const micField = field("Microphone");
  const micSelect = document.createElement("select");
  micField.appendChild(micSelect);
  const micMeter = levelMeter();
  micMeter.el.title = "Reacts live to your mic — confirms it's actually picking up sound";
  micField.appendChild(micMeter.el);

  const speakerField = field("Speaker");
  const speakerRow = document.createElement("div");
  speakerRow.className = "volume-row";
  const speakerSelect = document.createElement("select");
  const testSpeakerBtn = document.createElement("button");
  testSpeakerBtn.type = "button";
  testSpeakerBtn.className = "secondary";
  testSpeakerBtn.textContent = "Test";
  testSpeakerBtn.title = "Play a short tone through this output";
  speakerRow.append(speakerSelect, testSpeakerBtn);
  speakerField.appendChild(speakerRow);
  const outputMeter = levelMeter();
  outputMeter.el.title = "Pulses while the test tone plays — confirms sound is reaching this output";
  speakerField.appendChild(outputMeter.el);

  const volumeField = field("Output volume");
  const volumeRow = document.createElement("div");
  volumeRow.className = "volume-row";
  const volumeSlider = document.createElement("input");
  volumeSlider.type = "range";
  volumeSlider.min = "0";
  volumeSlider.max = "100";
  volumeSlider.value = String(Math.round(prefs.outputVolume * 100));
  const volumeReadout = document.createElement("span");
  volumeReadout.className = "muted-text";
  volumeReadout.textContent = `${volumeSlider.value}%`;
  volumeRow.append(volumeSlider, volumeReadout);
  volumeField.appendChild(volumeRow);

  const inputVolumeField = field("Input volume");
  const inputVolumeRow = document.createElement("div");
  inputVolumeRow.className = "volume-row";
  const inputVolumeSlider = document.createElement("input");
  inputVolumeSlider.type = "range";
  inputVolumeSlider.min = "0";
  inputVolumeSlider.max = "100";
  inputVolumeSlider.value = String(Math.round(prefs.inputVolume * 100));
  const inputVolumeReadout = document.createElement("span");
  inputVolumeReadout.className = "muted-text";
  inputVolumeReadout.textContent = `${inputVolumeSlider.value}%`;
  inputVolumeRow.append(inputVolumeSlider, inputVolumeReadout);
  inputVolumeField.appendChild(inputVolumeRow);

  const soundToggleRow = document.createElement("label");
  soundToggleRow.className = "checkbox-row";
  const soundToggle = document.createElement("input");
  soundToggle.type = "checkbox";
  soundToggle.checked = prefs.notificationSoundsEnabled;
  soundToggleRow.append(soundToggle, document.createTextNode("Play a sound for new messages"));
  soundToggle.addEventListener("change", () => {
    prefs.notificationSoundsEnabled = soundToggle.checked;
    saveAudioPrefs(prefs);
  });

  // Notifications while the app is in the background (see notifications.ts).
  const desktopRow = document.createElement("label");
  desktopRow.className = "checkbox-row";
  const desktopToggle = document.createElement("input");
  desktopToggle.type = "checkbox";
  desktopToggle.checked = notificationsEnabled();
  desktopRow.append(
    desktopToggle,
    document.createTextNode("Show notifications when the app is in the background"),
  );
  const desktopHint = document.createElement("p");
  desktopHint.className = "muted-text";
  desktopHint.hidden = true;
  desktopHint.setAttribute("aria-live", "polite");
  if (!notificationsSupported()) {
    desktopToggle.disabled = true;
    desktopHint.textContent = "This browser doesn't support notifications.";
    desktopHint.hidden = false;
  }
  desktopToggle.addEventListener("change", async () => {
    const outcome = await setNotificationsEnabled(desktopToggle.checked);
    desktopToggle.checked = outcome === "on";
    desktopHint.hidden = outcome !== "denied";
    if (outcome === "denied") {
      desktopHint.textContent =
        "The browser blocked notifications for this site. Allow them in its site settings, then try again.";
    }
  });

  const permissionHint = document.createElement("p");
  permissionHint.className = "muted-text";

  const grantBtn = document.createElement("button");
  grantBtn.className = "secondary";
  grantBtn.textContent = "Grant microphone access";

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
      // No permission (yet) — the meter just stays flat; the "Grant
      // microphone access" flow above is what actually surfaces this.
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
  testSpeakerBtn.addEventListener("click", () => void testSpeaker());

  async function populateDevices(): Promise<boolean> {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputs = devices.filter((d) => d.kind === "audioinput");
    const outputs = devices.filter((d) => d.kind === "audiooutput");
    const hasLabels = inputs.some((d) => d.label) || outputs.some((d) => d.label);

    permissionHint.hidden = hasLabels;
    grantBtn.hidden = hasLabels;

    micSelect.replaceChildren(
      ...defaultOption("System default"),
      ...inputs.map((d, i) => makeOption(d.deviceId, d.label || `Microphone ${i + 1}`)),
    );
    micSelect.value = prefs.inputDeviceId ?? "";

    if (typeof (HTMLMediaElement.prototype as { setSinkId?: unknown }).setSinkId === "function") {
      speakerSelect.replaceChildren(
        ...defaultOption("System default"),
        ...outputs.map((d, i) => makeOption(d.deviceId, d.label || `Speaker ${i + 1}`)),
      );
      speakerSelect.value = prefs.outputDeviceId ?? "";
    } else {
      speakerField.hidden = true;
    }
    return hasLabels;
  }

  grantBtn.addEventListener("click", async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      await populateDevices();
      void startMicMeter(prefs.inputDeviceId);
    } catch {
      permissionHint.textContent = "Microphone access was denied — check your browser's site settings.";
      permissionHint.hidden = false;
    }
  });

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

  volumeSlider.addEventListener("input", () => {
    volumeReadout.textContent = `${volumeSlider.value}%`;
    prefs.outputVolume = Number(volumeSlider.value) / 100;
    saveAudioPrefs(prefs);
    voiceClient.applyOutputPrefs();
  });

  inputVolumeSlider.addEventListener("input", () => {
    inputVolumeReadout.textContent = `${inputVolumeSlider.value}%`;
    voiceClient.setInputVolume(Number(inputVolumeSlider.value) / 100);
  });

  container.append(
    section("Audio", micField, speakerField, volumeField, inputVolumeField, permissionHint, grantBtn),
    renderConnectionTest(),
    section("Notifications", soundToggleRow, desktopRow, desktopHint),
  );
  void populateDevices().then((hasLabels) => {
    if (hasLabels) void startMicMeter(prefs.inputDeviceId);
  });

  return stopMicMeter;
}

function defaultOption(label: string): HTMLOptionElement[] {
  return [makeOption("", label)];
}

function makeOption(value: string, label: string): HTMLOptionElement {
  const opt = document.createElement("option");
  opt.value = value;
  opt.textContent = label;
  return opt;
}
