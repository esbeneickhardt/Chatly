import { expect, test } from "@playwright/test";
import { closeOpenContexts, newUser, openAs } from "./support";

test.afterEach(closeOpenContexts);

test.describe("updates", () => {
  test("the page is always re-checked, its hashed files are kept for good", async ({ request }) => {
    const page = await request.get("/");
    expect(page.headers()["cache-control"]).toBe("no-cache");
    const bundle = /\/assets\/index-[\w-]+\.js/.exec(await page.text())?.[0];
    expect(bundle).toBeTruthy();
    const script = await request.get(bundle ?? "/");
    expect(script.headers()["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect((await request.get("/sw.js")).headers()["cache-control"]).toBe("no-cache");
  });

  test("an open tab is told when a newer version has been deployed", async ({ browser }) => {
    const page = await openAs(browser, await newUser("ann_upd"));
    await expect(page.locator(".update-banner")).toHaveCount(0);

    // Coming back to the tab while the server still has the same version: nothing to say.
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await page.waitForTimeout(500);
    await expect(page.locator(".update-banner")).toHaveCount(0);

    // A deploy: the server now serves a page whose script has a different name.
    await page.route("**/", async (route) => {
      const response = await route.fetch();
      const html = (await response.text()).replace(/index-[\w-]+\.js/, "index-DEPLOYED9.js");
      await route.fulfill({ response, body: html });
    });
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    const banner = page.locator(".update-banner");
    await expect(banner).toContainText("A new version of Chatly is available");
    await expect(banner.getByRole("button", { name: "Reload" })).toBeVisible();

    // "Later" puts it away, and it does not stack up on the next check.
    await banner.getByRole("button", { name: "Later" }).click();
    await expect(banner).toHaveCount(0);
  });
});
