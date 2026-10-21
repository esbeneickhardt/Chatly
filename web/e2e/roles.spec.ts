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
  test("a role opens who has it, its permissions, and delete", async ({ browser }) => {
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

    const row = page.locator(".settings-content .role-row", { hasText: "Channel manager" });
    await expect(row).toContainText("0 people");
    await row.click();
    const sheet = page.getByRole("dialog", { name: "Channel manager" });
    await expect(sheet.getByRole("button", { name: "People" })).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Permissions" })).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Delete role" })).toBeVisible();

    // People: filter, then flip a switch; saved straight away.
    await sheet.getByRole("button", { name: "People" }).click();
    const people = page.getByRole("dialog", { name: "Channel manager: people" });
    await expect(people.locator(".switch-row")).toHaveCount(3);
    await people.getByPlaceholder("Find a member").fill("helper");
    await expect(people.locator(".switch-row:visible")).toHaveCount(1);
    await people.locator(".switch-row", { hasText: "Helper_rl" }).click();
    await expect(row).toContainText("1 person");
    const held = await call<{ id: string }[]>(
      "GET",
      `/api/guilds/${guild}/members/${helper.id}/roles`,
      undefined,
      founder,
    );
    expect(held.body.map((r) => r.id)).toContain(role.body.id);
    await people.getByRole("button", { name: "Done" }).click();

    // Permissions: switches and Save.
    await row.click();
    await page
      .getByRole("dialog", { name: "Channel manager" })
      .getByRole("button", { name: "Permissions" })
      .click();
    const perms = page.getByRole("dialog", { name: "Channel manager" });
    await perms.locator(".switch-row", { hasText: "Manage channels" }).click();
    await perms.getByRole("button", { name: "Save" }).click();
    await expect(perms).toHaveCount(0);
    const roles = await call<{ id: string; permissions: string }[]>(
      "GET",
      `/api/guilds/${guild}/roles`,
      undefined,
      founder,
    );
    expect(roles.body.find((r) => r.id === role.body.id)?.permissions).toContain("MANAGE_CHANNELS");

    // @everyone has nobody to assign and can't be deleted.
    await page.locator(".settings-content .role-row", { hasText: "@everyone" }).click();
    const everyone = page.getByRole("dialog", { name: "@everyone" });
    await expect(everyone.getByRole("button", { name: "Permissions" })).toBeVisible();
    await expect(everyone.getByRole("button", { name: "People" })).toHaveCount(0);
    await expect(everyone.getByRole("button", { name: "Delete role" })).toHaveCount(0);
  });

  test("creating a role leads straight into assigning people to it", async ({ browser }) => {
    const founder = await newUser("founder_cr");
    const helper = await newUser("helper_cr");
    const guild = await serverWith(founder, "Create Club", [helper]);

    const page = await openAs(browser, founder);
    await page.locator(".guild-rail [title='Create Club']").first().click();
    await page.locator("[title='Manage server']").click();
    await page.locator(".settings-nav-item", { hasText: "Roles" }).click();

    await page.locator(".settings-content .settings-row", { hasText: "Create role" }).click();
    const dialog = page.getByRole("dialog", { name: "New role" });
    await dialog.getByPlaceholder("Moderator").fill("Kicker");
    await dialog.getByRole("button", { name: "Create" }).click();

    // The same dialog now picks who gets it.
    await dialog.locator(".switch-row", { hasText: "Helper_cr" }).click();
    const row = page.locator(".settings-content .role-row", { hasText: "Kicker" });
    await expect(row).toContainText("1 person");
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(dialog).toHaveCount(0);

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
