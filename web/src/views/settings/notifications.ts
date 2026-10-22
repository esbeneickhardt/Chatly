// Settings → Notifications: message sounds and push notifications.

import { loadAudioPrefs, saveAudioPrefs } from "../../audio-prefs";
import {
  needsHomeScreen,
  notificationsEnabled,
  notificationsSupported,
  setNotificationsEnabled,
} from "../../notifications";
import { group, switchRow } from "./widgets";

export function renderNotificationsSection(container: HTMLElement): void {
  const soundRow = switchRow("Message sounds", loadAudioPrefs().notificationSoundsEnabled, (next) => {
    // read fresh: the Devices page saves the other audio prefs in the same record
    const prefs = loadAudioPrefs();
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

  container.append(group(null, soundRow.el, pushRow.el, pushHint));
}
