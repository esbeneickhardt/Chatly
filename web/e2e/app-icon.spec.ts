// The global admin picks the app icon; every icon address (home screen,
// browser tab, notifications) and the manifest follow it at once.

import { expect, test } from "@playwright/test";
import { call, closeOpenContexts, newUser, openAs, owner } from "./support";

test.afterEach(closeOpenContexts);

test("the global admin picks the app icon and everything serves it", async ({ browser, request }) => {
  const { account } = await owner();
  const page = await openAs(browser, account);
  await page.locator("[title='Settings']").click();
  await page.locator(".settings-nav-item", { hasText: "Global admin" }).click();
  await page.locator(".segmented button", { hasText: "App icon" }).click();
  const tiles = page.locator(".app-icon-tile");
  await expect(tiles).toHaveCount(4);

  try {
    await tiles.filter({ hasText: "Screen" }).click();
    await expect(tiles.filter({ hasText: "Screen" })).toHaveAttribute("aria-checked", "true");

    const served = await (await request.get("/icon-192.png")).body();
    const screen = await (await request.get("/app-icons/screen/icon-192.png")).body();
    expect(served.equals(screen)).toBe(true);
    const manifest = await (await request.get("/manifest.webmanifest")).json();
    expect(manifest.icons.map((i: { src: string }) => i.src)).toContain("/icon-maskable-512.png?icon=screen");
    await expect(page.locator("link[rel='icon']")).toHaveAttribute("href", /icon=screen/);

    // Remembered: the panel shows it again after a reload.
    await page.reload();
    await page.locator("[title='Settings']").click();
    await page.locator(".settings-nav-item", { hasText: "Global admin" }).click();
    await page.locator(".segmented button", { hasText: "App icon" }).click();
    await expect(tiles.filter({ hasText: "Screen" })).toHaveAttribute("aria-checked", "true");
  } finally {
    await call("POST", "/api/admin/app-icon", { icon: "classic" }, account);
  }
});

test("only the global admin can change it, and only to a real choice", async () => {
  const { account } = await owner();
  const someone = await newUser("ann_icon");
  expect((await call("POST", "/api/admin/app-icon", { icon: "screen" }, someone)).status).toBe(403);
  expect((await call("GET", "/api/admin/app-icon", undefined, someone)).status).toBe(403);
  expect((await call("POST", "/api/admin/app-icon", { icon: "../secret_key" }, account)).status).toBe(400);
});
