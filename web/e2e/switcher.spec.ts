import { expect, type Page, test } from "@playwright/test";
import { befriend, call, newUser, openAs, closeOpenContexts } from "./support";

test.afterEach(closeOpenContexts);

const options = (page: Page) => page.locator(".palette-box [role='option']");

/** Opens the switcher, retrying until the screen has finished starting up
 * (its key handler is registered once the rest of the screen is built). */
async function openSwitcher(page: Page): Promise<void> {
  const box = page.locator(".palette-box");
  await expect(async () => {
    if ((await box.count()) === 0) await page.keyboard.press("Control+k");
    await expect(box).toBeVisible({ timeout: 500 });
  }).toPass({ timeout: 10_000 });
}

test.describe("quick switcher (Ctrl+K)", () => {
  test("finds a channel in another server and jumps to it", async ({ browser }) => {
    const pal = await newUser("pal_sw");
    await call("POST", "/api/guilds", { name: "Movie Club" }, pal);
    await call("POST", "/api/guilds", { name: "Book Club" }, pal);
    const page = await openAs(browser, pal);

    await openSwitcher(page);
    // The other servers' channels are fetched after it opens.
    await page.keyboard.type("book gen");
    await expect(options(page).first()).toContainText("Book Club › general");
    await expect(options(page).first().locator("mark")).not.toHaveCount(0);

    await page.keyboard.press("Enter");
    await expect(page.locator(".palette-box")).toHaveCount(0);
    await expect(page.locator(".sidebar-header-name").first()).toContainText("Book Club");
    await expect(page.locator(".channel-header").first()).toContainText("general");
  });

  test("narrows with a leading character and offers to search messages", async ({ browser }) => {
    const ann = await newUser("ann_sw");
    const ben = await newUser("ben_sw");
    await befriend(ann, ben);
    const page = await openAs(browser, ann);

    await openSwitcher(page);
    await page.keyboard.type(">");
    const texts = await options(page).allInnerTexts();
    expect(texts.length).toBeGreaterThan(3);
    await expect(page.locator(".palette-box [role='option']", { hasText: "Ben_sw" })).toHaveCount(0);

    await page.keyboard.press("Backspace");
    await page.keyboard.type("@ben");
    await expect(options(page)).toHaveCount(1);
    await expect(options(page).first()).toContainText("Ben_sw");

    await page.keyboard.press("Control+a");
    await page.keyboard.type("?lunch plans");
    await expect(options(page)).toHaveCount(1);
    await expect(options(page).first()).toContainText("Search messages for “lunch plans”");
    await page.keyboard.press("Enter");
    await expect(page.locator(".search-panel")).toBeVisible();
  });

  test("remembers what you picked and shows it first next time", async ({ browser }) => {
    const ann = await newUser("ann_rc");
    const ben = await newUser("ben_rc");
    await befriend(ann, ben);
    const page = await openAs(browser, ann);

    await openSwitcher(page);
    await page.keyboard.type("ben");
    await page.keyboard.press("Enter");
    await expect(page.locator(".channel-header").first()).toContainText("Ben_rc");

    await openSwitcher(page);
    await expect(page.locator(".palette-heading").first()).toHaveText("Recent");
    await expect(options(page).first()).toContainText("Ben_rc");
  });

  test("is usable with a keyboard and a screen reader", async ({ browser }) => {
    const ann = await newUser("ann_ax");
    const page = await openAs(browser, ann);
    await page.locator("body").click();
    await page.locator(".guild-rail > :first-child").focus();

    await openSwitcher(page);
    const input = page.locator(".palette-box input");
    await expect(input).toBeFocused();
    await expect(input).toHaveAttribute("role", "combobox");
    await expect(page.locator(".palette-box [role='dialog'], .palette-box[role='dialog']")).toHaveCount(1);
    const active = async () => input.getAttribute("aria-activedescendant");
    const first = await active();
    expect(first).toBeTruthy();
    await page.keyboard.press("ArrowDown");
    expect(await active()).not.toBe(first);
    await page.keyboard.press("ArrowUp");
    expect(await active()).toBe(first);
    await expect(page.locator(`#${first}`)).toHaveAttribute("aria-selected", "true");

    // Escape closes it and puts focus back where it was.
    await page.keyboard.press("Escape");
    await expect(page.locator(".palette-box")).toHaveCount(0);
    await expect(page.locator(".guild-rail > :first-child")).toBeFocused();
  });
});
