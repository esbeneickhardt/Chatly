import { expect, test } from "@playwright/test";
import { call, closeOpenContexts, newUser, openAs, type Account } from "./support";

test.afterEach(closeOpenContexts);

/** A server owned by `founder` that `others` have joined. */
async function serverWith(founder: Account, name: string, others: Account[]): Promise<string> {
  const made = await call<{ id: string }>("POST", "/api/guilds", { name }, founder);
  const guild = made.body.id;
  const channels = await call<{ id: string }[]>("GET", `/api/guilds/${guild}/channels`, undefined, founder);
  for (const person of others) {
    const invite = await call<{ code: string }>(
      "POST",
      "/api/invites",
      { channel_id: channels.body[0].id },
      founder,
    );
    await call("POST", "/api/invites/redeem", { code: invite.body.code }, person);
  }
  return guild;
}

test.describe("roles", () => {
  test("a role has its own Assign button, separate from Edit", async ({ browser }) => {
    const founder = await newUser("founder_rl");
    const helper = await newUser("helper_rl");
    const other = await newUser("other_rl");
    const guild = await serverWith(founder, "Role Club", [helper, other]);
    const role = await call<{ id: string }>(
      "POST",
      `/api/guilds/${guild}/roles`,
      { name: "Channel manager" },
      founder,
    );

    const page = await openAs(browser, founder);
    await page.locator(".guild-rail [title='Role Club']").first().click();
    await page.locator("[title='Manage server']").click();
    await page.locator(".settings-nav-item", { hasText: "Roles" }).click();

    const row = page.locator(".settings-content .session-row", { hasText: "Channel manager" });
    const assign = row.getByRole("button", { name: "Assign people to Channel manager" });
    await expect(assign).toHaveText("Assign");
    await expect(row.getByRole("button", { name: "Edit" })).toBeVisible();
    await expect(row.getByRole("button", { name: "Delete" })).toBeVisible();
    await expect(row.locator(".role-count-badge")).toHaveText("0 people");
    // @everyone has nobody to assign.
    const everyone = page.locator(".settings-content .session-row", { hasText: "@everyone" });
    await expect(everyone.getByRole("button", { name: /Assign/ })).toHaveCount(0);

    // Assign opens people only: no permission checklist to scroll past.
    await assign.click();
    const people = page.locator(`#role-panel-${role.body.id}-people`);
    const editPanel = page.locator(`#role-panel-${role.body.id}-edit`);
    await expect(people).toBeVisible();
    await expect(editPanel).toBeHidden();
    await expect(people.locator(".toggle-row")).toHaveCount(3);

    // Filter, then assign.
    await people.getByPlaceholder("Find a member").fill("helper");
    await expect(people.locator(".toggle-row:visible")).toHaveCount(1);
    await people.locator(".toggle-row", { hasText: "Helper_rl" }).click();
    await expect(row.locator(".role-count-badge")).toHaveText("1 person");
    const held = await call<{ id: string }[]>(
      "GET",
      `/api/guilds/${guild}/members/${helper.id}/roles`,
      undefined,
      founder,
    );
    expect(held.body.map((r) => r.id)).toContain(role.body.id);

    // Edit swaps panels, and the people list is not in it.
    await row.getByRole("button", { name: "Edit" }).click();
    await expect(editPanel).toBeVisible();
    await expect(people).toBeHidden();
    await expect(editPanel.locator(".toggle-row").filter({ hasText: "Helper_rl" })).toHaveCount(0);

    // Un-assign from the people panel.
    await assign.click();
    await people.locator(".toggle-row", { hasText: "Helper_rl" }).click();
    await expect(row.locator(".role-count-badge")).toHaveText("0 people");
  });

  test("creating a role leads straight into assigning people to it", async ({ browser }) => {
    const founder = await newUser("founder_cr");
    const helper = await newUser("helper_cr");
    const guild = await serverWith(founder, "Create Club", [helper]);

    const page = await openAs(browser, founder);
    await page.locator(".guild-rail [title='Create Club']").first().click();
    await page.locator("[title='Manage server']").click();
    await page.locator(".settings-nav-item", { hasText: "Roles" }).click();

    await page.getByPlaceholder("Moderator").fill("Kicker");
    await page.getByRole("button", { name: "Create role" }).click();

    // The new role's people are already open, ready to tick.
    const row = page.locator(".settings-content .session-row", { hasText: "Kicker" });
    await expect(row).toBeVisible();
    await expect(row.getByRole("button", { name: "Assign people to Kicker" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    const people = page.locator(".role-people-panel:visible");
    await people.locator(".toggle-row", { hasText: "Helper_cr" }).click();
    await expect(row.locator(".role-count-badge")).toHaveText("1 person");

    const roles = await call<{ id: string; name: string }[]>(
      "GET",
      `/api/guilds/${guild}/roles`,
      undefined,
      founder,
    );
    const kicker = roles.body.find((r) => r.name === "Kicker");
    const held = await call<{ id: string }[]>(
      "GET",
      `/api/guilds/${guild}/members/${helper.id}/roles`,
      undefined,
      founder,
    );
    expect(held.body.map((r) => r.id)).toContain(kicker?.id);
  });
});
