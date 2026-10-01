// Asking the browser for a screen (or window, or tab) to share.

/** Shows the browser's share picker. Resolves `null` when there's nothing
 * to share — unsupported browser (reported through `onError`), or the
 * person cancelled the picker or denied permission (silent). */
export async function captureScreen(onError: (message: string) => void): Promise<MediaStream | null> {
  // Mobile Safari and Chrome for Android don't implement
  // `getDisplayMedia` at all (a real platform limitation, not
  // something fixable from here) — without this check, tapping the
  // button there called a function that doesn't exist, threw
  // synchronously, and landed in the same silent `catch` below as an
  // ordinary "user cancelled the picker," so nothing visibly
  // happened at all. This turns that into an honest, specific
  // message instead. The UI additionally hides the button entirely
  // wherever this is `false` (see chat.ts) so there's usually
  // nothing to tap in the first place.
  if (typeof navigator.mediaDevices.getDisplayMedia !== "function") {
    onError("Screen sharing isn't supported on this browser (most phone browsers don't support it at all).");
    return null;
  }
  try {
    // Picker hints only (unsupported options are ignored, not rejected):
    // offer whole screens over tabs, allow switching the shared surface
    // mid-share, don't offer this chat tab. `systemAudio: "include"` is
    // best effort: macOS Chrome only captures a shared *tab's* audio. The
    // audio constraints switch off mic processing that would mangle music.
    return await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: "monitor" },
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      surfaceSwitching: "include",
      selfBrowserSurface: "exclude",
      systemAudio: "include",
    } as DisplayMediaStreamOptions);
  } catch {
    // The user cancelled the browser's share picker, or denied
    // permission — not worth an alert either way.
    return null;
  }
}
