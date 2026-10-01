import { expect, test } from "@playwright/test";
import { call, newUser, openAs, owner, closeOpenContexts } from "./support";

test.afterEach(closeOpenContexts);

test.describe("global admin vs. server admin", () => {
  test("the global admin sees every server, including ones they never joined", async ({ browser }) => {
    const founder = await newUser("founder_ga");
    const made = await call<{ id: string }>("POST", "/api/guilds", { name: "Founders Club" }, founder);
    expect(made.status).toBe(200);

    const { account } = await owner();
    const page = await openAs(browser, account);
    await page.locator("[title='Settings']").click();
    await page.locator(".settings-nav-item", { hasText: "Global admin" }).click();
    await page.locator(".segmented button", { hasText: "All servers" }).click();

    const card = page.locator(".admin-server-card", { hasText: "Founders Club" });
    await expect(card).toContainText("Owner Founder_ga");
    await expect(card).toContainText("1 member");
    await card.getByText("Members").click();
    await expect(card.locator(".admin-server-detail")).toContainText("Server owner");

    // A server admin (or anyone else) has no Global admin tab at all.
    const outsider = await openAs(browser, founder);
    await outsider.locator("[title='Settings']").click();
    await expect(outsider.locator(".settings-nav-item", { hasText: "Global admin" })).toHaveCount(0);
  });

  test("a server owner promotes a server admin in one click", async ({ browser }) => {
    const founder = await newUser("founder_sa");
    const helper = await newUser("helper_sa");
    const made = await call<{ id: string }>("POST", "/api/guilds", { name: "Promo Club" }, founder);
    const channels = await call<{ id: string }[]>(
      "GET",
      `/api/guilds/${made.body.id}/channels`,
      undefined,
      founder,
    );
    const invite = await call<{ code: string }>(
      "POST",
      "/api/invites",
      { channel_id: channels.body[0].id },
      founder,
    );
    await call("POST", "/api/invites/redeem", { code: invite.body.code }, helper);

    const page = await openAs(browser, founder);
    await page.locator(".guild-rail [title='Promo Club']").first().click();
    await page.locator("[title='Manage server']").click();
    await page.locator(".settings-nav-item", { hasText: "Members" }).click();

    const row = page.locator(".settings-content .session-row", { hasText: "Helper_sa" });
    await row.getByText("Make admin").click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Make admin" }).click();
    await expect(row).toContainText("Server admin");
    // Still on the Members tab after the refresh.
    await expect(page.locator(".settings-nav-item.active")).toHaveText("Members");

    // The new admin can step down but has no control over the owner.
    const helperPage = await openAs(browser, helper);
    await helperPage.locator(".guild-rail [title='Promo Club']").first().click();
    await helperPage.locator("[title='Manage server']").click();
    await helperPage.locator(".settings-nav-item", { hasText: "Members" }).click();
    const ownerRow = helperPage.locator(".settings-content .session-row", { hasText: "Founder_sa" });
    await expect(ownerRow.getByRole("button")).toHaveCount(0);
    await expect(
      helperPage
        .locator(".settings-content .session-row", { hasText: "Helper_sa" })
        .getByText("Step down as admin"),
    ).toBeVisible();
  });

  test("channel settings have no per-channel admins", async ({ browser }) => {
    const founder = await newUser("founder_ch");
    const made = await call<{ id: string }>("POST", "/api/guilds", { name: "Chan Club" }, founder);
    const created = await call(
      "POST",
      `/api/guilds/${made.body.id}/channels`,
      { name: "private", kind: "text" },
      founder,
    );
    expect(created.status).toBe(200);

    const page = await openAs(browser, founder);
    await page.locator(".guild-rail [title='Chan Club']").first().click();
    await page.locator(".channel-item", { hasText: "private" }).hover();
    await page.locator(".channel-manage-btn").last().click({ force: true });
    const tabs = page.locator(".settings-nav-item");
    await expect(tabs.filter({ hasText: "Members" })).toBeVisible();
    await expect(tabs.filter({ hasText: "Danger Zone" })).toBeVisible();
    await expect(tabs.filter({ hasText: "Admins" })).toHaveCount(0);
  });

  test("administrative actions show up in the audit logs", async ({ browser }) => {
    const founder = await newUser("founder_log");
    const helper = await newUser("helper_log");
    const made = await call<{ id: string }>("POST", "/api/guilds", { name: "Logged Club" }, founder);
    const channels = await call<{ id: string }[]>(
      "GET",
      `/api/guilds/${made.body.id}/channels`,
      undefined,
      founder,
    );
    const invite = await call<{ code: string }>(
      "POST",
      "/api/invites",
      { channel_id: channels.body[0].id },
      founder,
    );
    await call("POST", "/api/invites/redeem", { code: invite.body.code }, helper);
    await call("PUT", `/api/guilds/${made.body.id}/admins/${helper.id}`, {}, founder);
    await call("POST", `/api/guilds/${made.body.id}/channels`, { name: "plans", kind: "text" }, founder);

    // The server's own log, in Manage server.
    const page = await openAs(browser, founder);
    await page.locator(".guild-rail [title='Logged Club']").first().click();
    await page.locator("[title='Manage server']").click();
    await page.locator(".settings-nav-item", { hasText: "Audit log" }).click();
    const log = page.locator(".audit-list");
    await expect(log).toContainText("Founder_log created the channel #plans");
    await expect(log).toContainText("Founder_log made Helper_log a server admin");

    // The global admin's log records deleting the server, at deployment level.
    const { account } = await owner();
    await call("DELETE", `/api/admin/guilds/${made.body.id}`, undefined, account);
    const admin = await openAs(browser, account);
    await admin.locator("[title='Settings']").click();
    await admin.locator(".settings-nav-item", { hasText: "Global admin" }).click();
    await admin.locator(".segmented button", { hasText: "Activity" }).click();
    await expect(admin.locator(".audit-list")).toContainText("Root deleted the server Logged Club");
  });
});
