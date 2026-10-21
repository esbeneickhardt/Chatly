// A one-tap offer to turn on notifications, on each device that hasn't:
// without them a phone can't ring for a call (or show a message) while
// Chatly isn't open on screen. The browser's own permission prompt only
// ever appears from the "Turn on" tap, never by surprise.

import { icon } from "../../icons";
import {
  needsHomeScreen,
  notificationsEnabled,
  notificationsSupported,
  setNotificationsEnabled,
} from "../../notifications";

const DISMISSED_KEY = "chatly:notifyPromptDismissedAt";
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

function snoozed(): boolean {
  try {
    return Date.now() - Number(localStorage.getItem(DISMISSED_KEY) ?? 0) < SNOOZE_MS;
  } catch {
    return false;
  }
}

export function offerNotifications(): void {
  if (!notificationsSupported() || needsHomeScreen()) return;
  if (Notification.permission === "denied" || notificationsEnabled() || snoozed()) return;
  if (document.querySelector(".notify-prompt")) return;

  const card = document.createElement("div");
  card.className = "notify-prompt";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-label", "Notifications");
  const text = document.createElement("span");
  text.className = "notify-prompt-text";
  text.textContent = "Get calls and messages when Chatly is closed";
  const later = document.createElement("button");
  later.type = "button";
  later.className = "secondary";
  later.textContent = "Not now";
  const turnOn = document.createElement("button");
  turnOn.type = "button";
  turnOn.textContent = "Turn on";
  const actions = document.createElement("div");
  actions.className = "notify-prompt-actions";
  actions.append(later, turnOn);
  card.append(icon("phone", 18), text, actions);

  later.addEventListener("click", () => {
    try {
      localStorage.setItem(DISMISSED_KEY, String(Date.now()));
    } catch {
      /* it just asks again next time */
    }
    card.remove();
  });
  turnOn.addEventListener("click", async () => {
    turnOn.disabled = true;
    await setNotificationsEnabled(true);
    card.remove();
  });

  document.body.appendChild(card);
}
