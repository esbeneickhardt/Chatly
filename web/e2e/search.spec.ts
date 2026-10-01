import { expect, test } from "@playwright/test";
import { call, newUser, openAs, closeOpenContexts } from "./support";

test.afterEach(closeOpenContexts);

test.describe("history and search", () => {
  test("old history loads on scroll, and search jumps to a message deep in the past", async ({ browser }) => {
    const founder = await newUser("founder_search");
    const made = await call<{ id: string }>("POST", "/api/guilds", { name: "Archive" }, founder);
    const channels = await call<{ id: string }[]>(
      "GET",
      `/api/guilds/${made.body.id}/channels`,
      undefined,
      founder,
    );
    const channel = channels.body[0].id;
    const post = (content: string) => call("POST", `/api/channels/${channel}/messages`, { content }, founder);

    // 130 messages, the very first one carrying a word nothing else has.
    await post("the zeppelin was here first");
    for (let n = 1; n < 130; n++) await post(`filler message ${n}`);

    const page = await openAs(browser, founder);
    await page.locator(".guild-rail [title='Archive']").first().click();
    await page.locator(".channel-item", { hasText: "general" }).first().click();

    const items = page.locator(".message-list [data-message-id]");
    // Only the newest page is loaded up front.
    await expect(items).toHaveCount(50);
    await expect(page.locator(".message-list")).toContainText("filler message 129");

    // Scrolling to the top loads older history, keeping the reader's place.
    await page.locator(".message-list").evaluate((el) => (el.scrollTop = 0));
    await expect(items).toHaveCount(100);

    // The oldest message is out of reach by scrolling alone — search finds it.
    await expect(page.getByText("zeppelin was here first")).toHaveCount(0);
    await page.locator("[title^='Search messages']").click();
    await page.getByRole("dialog", { name: "Search messages" }).getByRole("searchbox").fill("zeppelin");
    const hit = page.locator(".search-result", { hasText: "zeppelin" });
    await expect(hit).toBeVisible();
    await expect(hit.locator("mark")).toHaveText("zeppelin");

    await hit.click();
    const target = page.locator(".message-list", { hasText: "zeppelin was here first" });
    await expect(target).toBeVisible();
    await expect(page.locator(".jump-to-present")).toBeVisible();

    // Back to the present.
    await page.locator(".jump-to-present").click();
    await expect(page.locator(".message-list")).toContainText("filler message 129");
    await expect(page.locator(".jump-to-present")).toBeHidden();
  });

  test("search only reaches conversations you're in", async ({ browser }) => {
    const ann = await newUser("ann_dmsearch");
    const ben = await newUser("ben_dmsearch");
    const cy = await newUser("cy_dmsearch");
    const chat = await call<{ channel: { id: string } }>(
      "POST",
      "/api/dms",
      { usernames: [ben.username] },
      ann,
    );
    await call(
      "POST",
      `/api/channels/${chat.body.channel.id}/messages`,
      { content: "our secret blimp plans" },
      ann,
    );

    const cyPage = await openAs(browser, cy);
    await cyPage.locator("[title^='Search messages']").click();
    const dialog = cyPage.getByRole("dialog", { name: "Search messages" });
    await dialog.getByRole("radio", { name: "Direct messages" }).click();
    await dialog.getByRole("searchbox").fill("blimp");
    await expect(dialog.getByText("No messages found.")).toBeVisible();

    const benPage = await openAs(browser, ben);
    await benPage.locator("[title^='Search messages']").click();
    const benDialog = benPage.getByRole("dialog", { name: "Search messages" });
    await benDialog.getByRole("radio", { name: "Direct messages" }).click();
    await benDialog.getByRole("searchbox").fill("blimp");
    await expect(benDialog.locator(".search-result")).toHaveCount(1);
  });
});
