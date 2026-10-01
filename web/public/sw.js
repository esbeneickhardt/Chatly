// Chatly's service worker. Deliberately tiny: it does NOT cache anything —
// the app always loads fresh, so a deploy can never leave someone on a stale
// bundle. It exists for two things a page can't do alone:
//   * showing notifications through the worker registration (the only way
//     Android browsers allow it), and
//   * bringing the app forward when a notification is clicked.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// A pass-through handler: present so the app qualifies as installable in
// browsers that still look for one, and it never intercepts anything.
self.addEventListener("fetch", () => {});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const target = windows.find((client) => "focus" in client);
      if (target) {
        await target.focus();
        target.postMessage({ type: "notification-click", data });
      } else {
        await self.clients.openWindow("/");
      }
    })(),
  );
});
