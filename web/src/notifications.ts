// Desktop / phone notifications for messages and calls that arrive while
// you're not looking at the app (another tab, another window, a phone in
// your pocket with the app installed). Off until the person turns it on in
// Settings, because the browser's permission prompt is one-shot and
// shouldn't ambush anyone.
//
// This uses the browser's Notification API through the service worker
// registration (see `public/sw.js`), which is the only route Android
// browsers allow. It works while a tab or the installed app is open in
// the background; it is *not* Web Push, so nothing arrives once every
// Chatly window is closed — that needs a push service and is a separate
// piece of work (see docs/admin.md, "Current limitations").

const KEY = "chatty:desktopNotifications";

export function notificationsSupported(): boolean {
  return typeof Notification !== "undefined";
}

/** Whether notifications will actually be shown: supported, permitted by
 * the browser, and switched on by the person. */
export function notificationsEnabled(): boolean {
  if (!notificationsSupported() || Notification.permission !== "granted") return false;
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export type NotificationOutcome = "on" | "off" | "denied" | "unsupported";

/** Turns notifications on (asking the browser for permission if needed)
 * or off. Reports what actually happened — "denied" when the browser
 * refused, so the settings toggle can say why it snapped back. */
export async function setNotificationsEnabled(on: boolean): Promise<NotificationOutcome> {
  if (!notificationsSupported()) return "unsupported";
  try {
    if (!on) {
      localStorage.setItem(KEY, "0");
      return "off";
    }
    const permission =
      Notification.permission === "default"
        ? await Notification.requestPermission()
        : Notification.permission;
    if (permission !== "granted") return "denied";
    localStorage.setItem(KEY, "1");
    return "on";
  } catch {
    return "denied";
  }
}

/** Registers the service worker (once, at startup). A failure is
 * harmless: notifications fall back to the page's own `Notification`. */
export function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

export interface NotificationRequest {
  title: string;
  body: string;
  /** Notifications with the same tag replace each other (one per
   * conversation, not a stack of them). */
  tag: string;
  /** Handed back to the page when the notification is clicked. */
  data: { channelId?: string };
}

/** Shows a notification — but only if they're enabled *and the page isn't
 * in front of you*: a notification for something you're already looking at
 * is just noise. */
export async function notify(request: NotificationRequest): Promise<void> {
  if (!notificationsEnabled() || !document.hidden) return;
  const options: NotificationOptions = {
    body: request.body,
    tag: request.tag,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: request.data,
  };
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    if (registration) {
      await registration.showNotification(request.title, options);
      return;
    }
    const shown = new Notification(request.title, options);
    shown.onclick = () => window.focus();
  } catch {
    /* a browser that refuses is a browser that doesn't want them */
  }
}

/** Calls `handler` with the conversation to open when a notification is
 * clicked (the service worker forwards the click to the focused page). */
export function onNotificationClick(handler: (channelId: string) => void): void {
  navigator.serviceWorker?.addEventListener("message", (event: MessageEvent) => {
    const data = event.data as { type?: string; data?: { channelId?: string } } | null;
    if (data?.type === "notification-click" && data.data?.channelId) handler(data.data.channelId);
  });
}
