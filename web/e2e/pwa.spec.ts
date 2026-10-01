import { expect, test } from "@playwright/test";
import { befriend, call, newUser, closeOpenContexts } from "./support";

test.afterEach(closeOpenContexts);

test.describe("installable app and notifications", () => {
  test("serves a manifest and a service worker the browser accepts", async ({ page, request }) => {
    const manifest = await request.get("/manifest.webmanifest");
    expect(manifest.ok()).toBe(true);
    expect(manifest.headers()["content-type"]).toContain("manifest+json");
    const body = await manifest.json();
    expect(body.display).toBe("standalone");
    expect(body.icons.some((i: { sizes: string }) => i.sizes === "512x512")).toBe(true);

    const sw = await request.get("/sw.js");
    expect(sw.ok()).toBe(true);
    expect(sw.headers()["content-type"]).toMatch(/javascript/);

    await page.goto("/");
    await expect
      .poll(() => page.evaluate(async () => Boolean(await navigator.serviceWorker.getRegistration())))
      .toBe(true);
  });

  test("a message that arrives while the app is in the background raises a notification", async ({
    browser,
  }) => {
    const ann = await newUser("ann_notif");
    const ben = await newUser("ben_notif");
    await befriend(ann, ben);
    const dm = await call<{ channel: { id: string } }>(
      "POST",
      "/api/dms",
      { usernames: [ann.username] },
      ben,
    );

    const context = await browser.newContext();
    const at = ann.cookie.indexOf("=");
    await context.addCookies([
      {
        name: "session",
        value: ann.cookie.slice(at + 1),
        url: `http://127.0.0.1:${process.env.E2E_PORT ?? 8171}`,
      },
    ]);
    // Headless Chromium never grants the notification permission and shows no
    // real notifications, so stand in for both: report the permission as
    // granted, record what the app asks the service worker to show, and
    // report the page as being in the background. What's under test is the
    // app's decision — enabled, backgrounded, right title/body/target.
    await context.addInitScript(() => {
      localStorage.setItem("chatty:desktopNotifications", "1");
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      Object.defineProperty(Notification, "permission", { configurable: true, get: () => "granted" });
      const shown: { title: string; body?: string; tag?: string; data?: unknown }[] = [];
      (window as unknown as { __shown: typeof shown }).__shown = shown;
      ServiceWorkerRegistration.prototype.showNotification = async function (title, options) {
        shown.push({ title, body: options?.body, tag: options?.tag, data: options?.data });
      };
    });
    const page = await context.newPage();
    await page.goto("/");
    await expect(page.locator(".guild-rail")).toBeVisible();
    await expect
      .poll(() => page.evaluate(async () => Boolean(await navigator.serviceWorker.getRegistration())))
      .toBe(true);

    await call("POST", `/api/channels/${dm.body.channel.id}/messages`, { content: "are you there?" }, ben);

    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __shown: unknown[] }).__shown))
      .toEqual([
        {
          title: "Ben_notif",
          body: "are you there?",
          tag: dm.body.channel.id,
          data: { channelId: dm.body.channel.id },
        },
      ]);
  });
});
