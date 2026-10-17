// Phone and desktop notifications for calls, direct messages and mentions.
// Off until the person turns it on in Settings, because the browser's
// permission prompt is one-shot and shouldn't ambush anyone.
//
// Two routes, the same switch:
//   * Web Push, where the browser has it (Chrome, Firefox, Edge, and Safari
//     on iOS once Chatly is added to the Home Screen): the server sends
//     calls, DMs and mentions to this browser's push service, so they arrive
//     even with every Chatly window closed. `public/sw.js` shows them. The
//     server skips anyone who is using Chatly right now (see gateway op 12).
//   * Otherwise, the page itself shows a notification while it is open in
//     the background (`notify`).

import { api } from "./api";

const KEY = "chatty:desktopNotifications";
/** Set while this browser has a push subscription the server knows about. */
const PUSH_KEY = "chatly:push";

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
      await unsubscribePush();
      return "off";
    }
    const permission =
      Notification.permission === "default"
        ? await Notification.requestPermission()
        : Notification.permission;
    if (permission !== "granted") return "denied";
    localStorage.setItem(KEY, "1");
    await subscribePush();
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

/** iOS only offers notifications to a web app added to the Home Screen. */
export function needsHomeScreen(): boolean {
  const ios =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent));
  const standalone = window.matchMedia?.("(display-mode: standalone)").matches;
  return ios && !standalone && !notificationsSupported();
}

function pushSupported(): boolean {
  return "serviceWorker" in navigator && typeof PushManager !== "undefined";
}

/** Whether pushes reach this browser, so the page needn't notify itself. */
function pushActive(): boolean {
  try {
    return localStorage.getItem(PUSH_KEY) === "1";
  } catch {
    return false;
  }
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/** Subscribes this browser to push (or refreshes an existing subscription,
 * which browsers can rotate) and tells the server where to send. */
async function subscribePush(): Promise<void> {
  if (!pushSupported()) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    const { public_key } = await api.get<{ public_key: string }>("/api/push/key");
    const key = base64UrlToBytes(public_key);
    let subscription = await registration.pushManager.getSubscription();
    const subscribedKey = subscription?.options.applicationServerKey;
    if (subscription && subscribedKey && !sameBytes(new Uint8Array(subscribedKey), key)) {
      // Made for another server key (the data folder was replaced).
      await subscription.unsubscribe();
      subscription = null;
    }
    subscription ??= await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: key,
    });
    await api.post("/api/push/subscriptions", subscription.toJSON());
    localStorage.setItem(PUSH_KEY, "1");
  } catch (err) {
    localStorage.removeItem(PUSH_KEY);
    console.warn("push subscription failed", err);
  }
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

async function unsubscribePush(): Promise<void> {
  localStorage.removeItem(PUSH_KEY);
  if (!pushSupported()) return;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) return;
    await api.post("/api/push/subscriptions/remove", { endpoint: subscription.endpoint }).catch(() => {});
    await subscription.unsubscribe();
  } catch {
    /* nothing left to undo */
  }
}

/** At sign-in: keeps this browser's push subscription registered to the
 * account and session now using it (sessions end, subscriptions rotate). */
export function syncPushSubscription(): void {
  if (notificationsEnabled()) void subscribePush();
}

/** Where a tapped notification should take the app. */
export interface NotificationTarget {
  channelId: string;
  guildId?: string;
  /** Join the call (the notification's Answer button). */
  answer?: boolean;
  /** A call notification was tapped: show it ringing, if it still is. */
  call?: boolean;
}

/** A notification tapped while no Chatly window was open starts the app at
 * `/?open=<channel>[&guild=<guild>][&answer=1]` (see `sw.js`). */
let launchTarget: NotificationTarget | null = (() => {
  const params = new URLSearchParams(location.search);
  const channelId = params.get("open");
  if (!channelId) return null;
  return {
    channelId,
    guildId: params.get("guild") ?? undefined,
    answer: params.get("answer") === "1",
    call: params.get("call") === "1",
  };
})();

/** The notification the app was launched from, once. */
export function takeLaunchTarget(): NotificationTarget | null {
  const target = launchTarget;
  launchTarget = null;
  return target;
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
  if (!notificationsEnabled() || !document.hidden || pushActive()) return;
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

/** Calls `handler` with where to go when a notification is clicked (the
 * service worker forwards the click to an open page). */
export function onNotificationClick(handler: (target: NotificationTarget) => void): void {
  navigator.serviceWorker?.addEventListener("message", (event: MessageEvent) => {
    const data = event.data as { type?: string; data?: NotificationTarget } | null;
    if (data?.type === "notification-click" && data.data?.channelId) handler(data.data);
  });
}
