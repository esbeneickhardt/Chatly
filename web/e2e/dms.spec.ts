import { expect, test } from "@playwright/test";
import { befriend, goHome, newUser, openAs, closeOpenContexts } from "./support";

test.afterEach(closeOpenContexts);

test.describe("direct messages", () => {
  test("a friend is always reachable, even after closing the chat", async ({ browser }) => {
    const ann = await newUser("ann_dm");
    const ben = await newUser("ben_dm");
    await befriend(ann, ben);

    const page = await openAs(browser, ann);
    await goHome(page);

    await page.locator(".dm-item", { hasText: "Ben_dm" }).first().click();
    await page.locator("[title='Conversation options']").click();
    await page.getByText("Close conversation").click();

    // The conversation is gone from the list, but the friend isn't.
    await expect(page.locator(".dm-section-label")).toHaveText("Friends");
    const stub = page.locator(".dm-friend-stub", { hasText: "Ben_dm" });
    await expect(stub).toBeVisible();

    await stub.click();
    await expect(page.locator(".dm-friend-stub")).toHaveCount(0);
    await expect(page.locator(".channel-header").first()).toContainText("Ben_dm");
  });

  test("adding someone to a 1:1 starts a new group and keeps the 1:1", async ({ browser }) => {
    const ann = await newUser("ann_grp");
    const ben = await newUser("ben_grp");
    const cy = await newUser("cy_grp");
    await befriend(ann, ben);

    const page = await openAs(browser, ann);
    await goHome(page);
    await page.locator(".dm-item", { hasText: "Ben_grp" }).first().click();

    await page.locator("[title='Conversation options']").click();
    await page.getByText("Add people").click();
    await page.locator("input").last().fill("cy_grp");
    await page.locator(".user-search-row", { hasText: "Cy_grp" }).first().click();
    await expect(page.getByText("Added")).toBeVisible();
    await page.keyboard.press("Escape");

    // The new group exists…
    await expect(page.locator(".dm-item", { hasText: "3 Members" })).toBeVisible();
    // …and so does the original 1:1 with Ben.
    await expect(page.locator(".dm-item", { hasText: /^B\s*Ben_grp$/ })).toBeVisible();

    // Cy only ever sees the group.
    const cyPage = await openAs(browser, cy);
    await goHome(cyPage);
    await expect(cyPage.locator(".dm-item", { hasText: "3 Members" })).toBeVisible();
    await expect(cyPage.locator(".dm-item", { hasText: /^B\s*Ben_grp$/ })).toHaveCount(0);
  });
});
