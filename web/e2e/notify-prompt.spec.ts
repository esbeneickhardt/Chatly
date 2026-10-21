// Every device that can't ring yet is offered notifications once: without
// them a phone can't ring for a call while Chatly isn't open on screen.

import { expect, test } from "@playwright/test";
import { closeOpenContexts, contextFor, newUser } from "./support";

test.afterEach(closeOpenContexts);

/** Headless Chromium always answers "denied" (where the offer, rightly,
 * never shows), so stand in for a browser that hasn't been asked yet. */
const UNASKED_NOTIFICATIONS = `
  let permission = "default";
  Object.defineProperty(Notification, "permission", { configurable: true, get: () => permission });
  Notification.requestPermission = async () => (permission = "granted");
`;

test("offers notifications, and Not now keeps it away", async ({ browser }) => {
  const context = await contextFor(browser, await newUser("ann_np"));
  await context.addInitScript(UNASKED_NOTIFICATIONS);
  const page = await context.newPage();
  await page.goto("/");
  const prompt = page.locator(".notify-prompt");
  await expect(prompt).toContainText("Get calls and messages");
  await prompt.getByRole("button", { name: "Not now" }).click();
  await expect(prompt).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".guild-rail")).toBeVisible();
  await page.waitForTimeout(2500);
  await expect(prompt).toHaveCount(0);
});

test("Turn on switches notifications on", async ({ browser }) => {
  const context = await contextFor(browser, await newUser("ben_np"));
  await context.addInitScript(UNASKED_NOTIFICATIONS);
  const page = await context.newPage();
  await page.goto("/");
  const prompt = page.locator(".notify-prompt");
  await prompt.getByRole("button", { name: "Turn on" }).click();
  await expect(prompt).toHaveCount(0);
  await page.locator("[title='Settings']").click();
  await page.locator(".settings-nav-item", { hasText: "Devices" }).click();
  await expect(page.locator(".switch-row", { hasText: "Push notifications" }).locator("input")).toBeChecked();
});
