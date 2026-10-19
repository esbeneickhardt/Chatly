import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { befriend, call, newUser, openAs, owner, closeOpenContexts } from "./support";

test.afterEach(closeOpenContexts);

// Automated accessibility scans (axe-core, WCAG 2.1 A/AA) of the screens
// people actually use. Automated checks catch roughly a third of real
// problems — names, roles, contrast, structure — so these are a floor,
// not a substitute for using the app with a keyboard and a screen reader.
async function expectNoViolations(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const summary = results.violations.map(
    (v) => `${v.id} (${v.impact}): ${v.nodes.length} node(s), e.g. ${v.nodes[0]?.target.join(" ")}`,
  );
  expect(summary, `${label}: accessibility violations`).toEqual([]);
}

test.describe("accessibility", () => {
  test("sign-in screen", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("form, input").first()).toBeVisible();
    await expectNoViolations(page, "sign-in");
  });

  test("main screens", async ({ browser }) => {
    const ann = await newUser("ann_a11y");
    const ben = await newUser("ben_a11y");
    await befriend(ann, ben);
    const made = await call<{ id: string }>("POST", "/api/guilds", { name: "A11y Club" }, ann);
    await call("POST", `/api/guilds/${made.body.id}/channels`, { name: "private", kind: "text" }, ann);

    const page = await openAs(browser, ann);
    await page.locator(".guild-rail [title='A11y Club']").first().click();
    await page.locator(".channel-item", { hasText: "general" }).first().click();
    await expectNoViolations(page, "server channel");

    await page.locator("[title='Manage server']").click();
    await expect(page.locator(".settings-modal")).toBeVisible();
    await expectNoViolations(page, "manage server");
    await page.keyboard.press("Escape");
    await page
      .locator(".settings-close")
      .click()
      .catch(() => {});

    await page.locator(".guild-rail > :first-child").click();
    await page.locator(".dm-item", { hasText: "Ben_a11y" }).first().click();
    await expectNoViolations(page, "direct messages");

    await page.locator("[title^='Search messages']").click();
    await expect(page.getByRole("dialog", { name: "Search messages" })).toBeVisible();
    await expectNoViolations(page, "search");
    await page.keyboard.press("Escape");

    await page.keyboard.press("Control+k");
    await expect(page.locator(".palette-box")).toBeVisible();
    await page.keyboard.type("gen");
    await expect(page.locator(".palette-box [role='option']").first()).toBeVisible();
    await expectNoViolations(page, "quick switcher");
  });

  test("global admin", async ({ browser }) => {
    const { account } = await owner();
    const page = await openAs(browser, account);
    await page.locator("[title='Settings']").click();
    await expectNoViolations(page, "settings");
    await page.locator(".settings-nav-item", { hasText: "Global admin" }).click();
    await page.locator(".segmented button", { hasText: "All servers" }).click();
    // account rows share the card style but sit in the hidden "All accounts" panel
    await expect(page.locator(".admin-server-card").filter({ visible: true }).first()).toBeVisible();
    await expectNoViolations(page, "global admin");
  });

  test("the app can be driven from the keyboard", async ({ browser }) => {
    const ann = await newUser("ann_kbd");
    const ben = await newUser("ben_kbd");
    await befriend(ann, ben);
    const made = await call<{ id: string }>("POST", "/api/guilds", { name: "Keys Club" }, ann);

    const page = await openAs(browser, ann);
    // Rail icons are real, focusable controls: Home first…
    await page.locator(".guild-rail > :first-child").focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".dm-item.active")).toHaveCount(1); // the list has settled
    // …conversation rows work with Space as well as Enter…
    const row = page.locator(".dm-item", { hasText: "Ben_kbd" }).first();
    await row.focus();
    await page.keyboard.press("Space");
    await expect(row).toHaveAttribute("aria-current", "true");

    // …and a server icon has a name and a state.
    const club = page.getByRole("button", { name: "Keys Club" });
    await club.focus();
    await page.keyboard.press("Enter");
    await expect(club).toHaveAttribute("aria-current", "true");
    await expect(page.locator(".channel-item", { hasText: "general" }).first()).toBeVisible();

    // …and a dialog can be dismissed with Escape, returning focus to what opened it.
    const search = page.locator("[title^='Search messages']");
    await search.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "Search messages" })).toBeVisible();
    await expect(page.getByRole("searchbox")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Search messages" })).toHaveCount(0);
    await expect(search).toBeFocused();
    expect(made.status).toBe(200);
  });
});
