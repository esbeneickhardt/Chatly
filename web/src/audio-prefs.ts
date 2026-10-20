// Per-browser audio device/volume preferences. Deliberately
// localStorage-only (not synced to the server) — these are about this
// specific machine's speakers/microphone, not the user's account.

export interface AudioPrefs {
  inputDeviceId: string | null;
  outputDeviceId: string | null;
  outputVolume: number; // 0..MAX_VOLUME (voice/util.ts)
  /** Mic gain applied before sending, not a device-level setting — see
   * `VoiceClient`'s gain node. Most mics/OSes already normalize input
   * levels, so 1 (unity, no boost or cut) is the sensible default;
   * this is for the person whose mic is just quiet. */
  inputVolume: number; // 0..MAX_VOLUME (voice/util.ts)
  /** Per-person volume for someone else's voice in a call, keyed by
   * their user id — independent of `outputVolume` (a multiplier on
   * top of it, not a replacement), and remembered across calls rather
   * than reset every time someone rejoins. Missing entry = 1 (no
   * adjustment), not muted. */
  remoteVolumes: Record<string, number>;
  notificationSoundsEnabled: boolean;
  /** RNNoise on the outgoing mic (see voice/voice-filters.ts). Replaces
   * the browser's own noise suppression while on. */
  noiseFilter: boolean;
  /** Rumble cut, presence and compression on the outgoing mic. */
  studioVoice: boolean;
}

const KEY = "chatty:audio-prefs";
const DEFAULTS: AudioPrefs = {
  inputDeviceId: null,
  outputDeviceId: null,
  outputVolume: 1,
  inputVolume: 1,
  remoteVolumes: {},
  notificationSoundsEnabled: true,
  noiseFilter: false,
  studioVoice: false,
};

export function loadAudioPrefs(): AudioPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<AudioPrefs>) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveAudioPrefs(prefs: AudioPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* private browsing or storage disabled — prefs just won't persist */
  }
}
