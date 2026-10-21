// Settings on a phone: drag the sheet down or the menu right to close it,
// drag a page right to go back, and the phone's back button steps out one
// layer at a time (sheet, page, menu) without leaving the app.

import { expect, test, type Page } from "@playwright/test";
import { closeOpenContexts, contextFor, newUser, owner } from "./support";

test.afterEach(closeOpenContexts);

async function drag(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y: y0 }] });
  for (let i = 1; i <= 10; i++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: x0 + ((x1 - x0) * i) / 10, y: y0 + ((y1 - y0) * i) / 10 }],
    });
    await page.waitForTimeout(16);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(400);
}

test("phone gestures and back", async ({ browser }) => {
  const user = await newUser("gesture_user");
  const context = await contextFor(browser, user);
  const page = await context.newPage();
  page.on("pageerror", (e) => {
    throw e;
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator(".guild-rail")).toBeAttached();
  const open = async (): Promise<void> => {
    await page.evaluate(() => document.querySelector(".app-shell")?.classList.add("mobile-nav-open"));
    await page.waitForTimeout(400);
    await page.locator("[title='Settings']").click();
    await expect(page.locator(".settings-nav")).toBeVisible();
  };
  await open();
  await expect(page.locator(".settings-close")).toBeHidden();
  // Drag the sheet down: closes.
  await drag(page, 200, 300, 200, 650);
  await expect(page.locator(".settings-modal")).toHaveCount(0);
  // Drag right: closes.
  await open();
  await drag(page, 100, 600, 330, 600);
  await expect(page.locator(".settings-modal")).toHaveCount(0);
  // Back button: page -> menu -> closed.
  await open();
  await page.locator(".settings-nav-item", { hasText: "Devices" }).click();
  await expect(page.locator(".settings-back")).toBeVisible();
  await page.goBack();
  await expect(page.locator(".settings-nav")).toBeVisible();
  await page.goBack();
  await expect(page.locator(".settings-modal")).toHaveCount(0);
  await expect(page.locator(".guild-rail")).toBeAttached();
  // The back arrow, then reopening a page, then back twice still exits cleanly.
  await open();
  await page.locator(".settings-nav-item", { hasText: "Security" }).click();
  await page.locator(".settings-back").click();
  await page.locator(".settings-nav-item", { hasText: "Profile" }).click();
  await page.locator(".settings-row", { hasText: "Username" }).click();
  await expect(page.locator(".form-dialog")).toBeVisible();
  await page.goBack();
  await expect(page.locator(".form-dialog")).toHaveCount(0);
  await expect(page.locator(".settings-back")).toBeVisible();
  // Sheet drag down.
  await page.locator(".settings-row", { hasText: "Username" }).click();
  const sheet = (await page.locator(".form-dialog").boundingBox())!;
  await drag(page, 200, sheet.y + 20, 200, sheet.y + 220);
  await expect(page.locator(".form-dialog")).toHaveCount(0);
  await page.goBack();
  await expect(page.locator(".settings-nav")).toBeVisible();
  await page.goBack();
  await expect(page.locator(".settings-modal")).toHaveCount(0);
  // Still on the app, not navigated away.
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator(".guild-rail")).toBeAttached();
});

test("Global admin's tabs swipe sideways, and the first tab still swipes back", async ({ browser }) => {
  const { account } = await owner();
  const context = await contextFor(browser, account);
  const page = await context.newPage();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator(".guild-rail")).toBeAttached();
  await page.evaluate(() => document.querySelector(".app-shell")?.classList.add("mobile-nav-open"));
  await page.waitForTimeout(400);
  await page.locator("[title='Settings']").click();
  await page.locator(".settings-nav-item", { hasText: "Global admin" }).click();
  const active = page.locator(".segmented button.active");
  await expect(active).toHaveText("Accounts");

  await drag(page, 320, 500, 80, 500);
  await expect(active).toHaveText("Servers");
  await drag(page, 320, 500, 80, 500);
  await expect(active).toHaveText("Activity");
  await drag(page, 80, 500, 320, 500);
  await drag(page, 80, 500, 320, 500);
  await expect(active).toHaveText("Accounts");
  // Nothing further left: the swipe goes back to the menu instead.
  await drag(page, 60, 500, 330, 500);
  await expect(page.locator(".settings-nav")).toBeVisible();
});
