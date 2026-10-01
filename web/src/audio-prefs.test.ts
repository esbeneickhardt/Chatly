import { beforeEach, describe, expect, it } from "vitest";
import { loadAudioPrefs, saveAudioPrefs } from "./audio-prefs";

beforeEach(() => localStorage.clear());

describe("audio prefs", () => {
  it("defaults to full output, unity mic, and no per-person overrides", () => {
    const prefs = loadAudioPrefs();
    expect(prefs.outputVolume).toBe(1);
    expect(prefs.inputVolume).toBe(1);
    expect(prefs.remoteVolumes).toEqual({});
    expect(prefs.notificationSoundsEnabled).toBe(true);
  });

  it("round-trips, including a per-person boost above 100%", () => {
    const prefs = loadAudioPrefs();
    prefs.remoteVolumes = { "42": 2.5, "42:screen": 3 };
    saveAudioPrefs(prefs);
    expect(loadAudioPrefs().remoteVolumes).toEqual({ "42": 2.5, "42:screen": 3 });
  });

  it("falls back to defaults when the stored value is corrupt", () => {
    localStorage.setItem("chatty:audio-prefs", "{not json");
    expect(loadAudioPrefs().outputVolume).toBe(1);
  });

  it("fills in fields a stored value predates", () => {
    localStorage.setItem("chatty:audio-prefs", JSON.stringify({ outputVolume: 0.5 }));
    const prefs = loadAudioPrefs();
    expect(prefs.outputVolume).toBe(0.5);
    expect(prefs.remoteVolumes).toEqual({});
  });
});
