// Chatly's service worker. Deliberately tiny: it does NOT cache anything —
// the app always loads fresh, so a deploy can never leave someone on a stale
// bundle. It exists for what a page can't do alone:
//   * showing Web Push notifications (calls, direct messages, mentions) that
//     arrive while no Chatly window is open (see `src/notifications.ts`),
//   * showing notifications through the worker registration (the only way
//     Android browsers allow it), and
//   * bringing the app to the right place when a notification is clicked.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// A pass-through handler: present so the app qualifies as installable in
// browsers that still look for one, and it never intercepts anything.
self.addEventListener("fetch", () => {});

// A notice from the server: { kind: "call" | "message", title, body, tag,
// channel_id, guild_id? }. Every push must show something (browsers revoke
// a subscription that stays silent), so a malformed one still does.
self.addEventListener("push", (event) => {
  let notice = {};
  try {
    notice = event.data ? event.data.json() : {};
  } catch {
    /* shown as a plain "Chatly" notification */
  }
  const call = notice.kind === "call";
  const options = {
    body: notice.body || "",
    tag: notice.tag || "chatly",
    renotify: true,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    timestamp: Date.now(),
    data: { channelId: notice.channel_id, guildId: notice.guild_id, call },
  };
  if (call) {
    options.requireInteraction = true;
    options.vibrate = [500, 250, 500, 250, 500, 250, 500];
    options.actions = [
      { action: "answer", title: "Answer" },
      { action: "decline", title: "Decline" },
    ];
  }
  event.waitUntil(self.registration.showNotification(notice.title || "Chatly", options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};

  if (event.action === "decline" && data.channelId) {
    event.waitUntil(
      fetch(`/api/dms/${data.channelId}/call/decline`, {
        method: "POST",
        headers: { "X-Requested-With": "XMLHttpRequest" },
        credentials: "same-origin",
      }).catch(() => {}),
    );
    return;
  }

  // Answer joins the call; tapping a call shows it ringing in the app.
  const target = {
    channelId: data.channelId,
    guildId: data.guildId,
    answer: event.action === "answer",
    call: Boolean(data.call) && event.action !== "answer",
  };
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const open = windows.find((client) => "focus" in client);
      if (open) {
        await open.focus();
        if (target.channelId) open.postMessage({ type: "notification-click", data: target });
        return;
      }
      const params = new URLSearchParams();
      if (target.channelId) params.set("open", target.channelId);
      if (target.guildId) params.set("guild", target.guildId);
      if (target.answer) params.set("answer", "1");
      if (target.call) params.set("call", "1");
      const query = params.toString();
      await self.clients.openWindow(query ? `/?${query}` : "/");
    })(),
  );
});
