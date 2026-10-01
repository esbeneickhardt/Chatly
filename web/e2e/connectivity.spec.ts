import { expect, test } from "@playwright/test";
import { befriend, closeOpenContexts, contextFor, goHome, newUser, openAs } from "./support";

test.afterEach(closeOpenContexts);

// A network that cannot carry the call, simulated by allowing only relayed
// connections when there is no relay: the browser can never connect.
const CANNOT_CONNECT = `
  const RealPC = window.RTCPeerConnection;
  window.RTCPeerConnection = function (config = {}, ...rest) {
    return new RealPC({ ...config, iceTransportPolicy: "relay", iceServers: [] }, ...rest);
  };
  window.RTCPeerConnection.prototype = RealPC.prototype;`;

test.describe("calls the network cannot carry", () => {
  test("say so and hang up, instead of sitting there looking connected", async ({ browser }) => {
    const ann = await newUser("ann_net");
    const ben = await newUser("ben_net");
    await befriend(ann, ben);
    const annPage = await openAs(browser, ann);
    const benContext = await contextFor(browser, ben);
    await benContext.addInitScript(CANNOT_CONNECT);
    const benPage = await benContext.newPage();
    await benPage.clock.install();
    const alerts: string[] = [];
    benPage.on("dialog", async (dialog) => {
      alerts.push(dialog.message());
      await dialog.accept();
    });
    await benPage.goto("/");
    await goHome(annPage);
    await goHome(benPage);

    await annPage.locator(".dm-item", { hasText: "Ben_net" }).first().click();
    await annPage.locator("[title='Call']").first().click();
    await benPage.locator(".incoming-call-btn.answer").click();
    // Ben's screen shows the call…
    await expect(benPage.locator(".dm-call-stage")).toBeVisible();
    expect(alerts).toEqual([]);

    // …but nothing connects. After the wait, he is told, and the call ends.
    await benPage.clock.fastForward(25_000);
    await expect.poll(() => alerts.length).toBe(1);
    expect(alerts[0]).toContain("Couldn't connect the call");
    expect(alerts[0]).toContain("Wi-Fi and mobile data");
    await expect(benPage.locator(".end-call-btn")).toBeHidden();

    // Being on no call, starting another asks nothing.
    await benPage.locator(".dm-item", { hasText: "Ann_net" }).first().click();
    await benPage.locator("[title='Call']").first().click();
    await expect(benPage.getByRole("alertdialog")).toHaveCount(0);
  });
});

test.describe("connection test", () => {
  test("Settings → Devices says what this device can do", async ({ browser }) => {
    const page = await openAs(browser, await newUser("ann_ct"));
    await page.locator("[title='Settings']").click();
    await page.locator(".settings-nav-item", { hasText: "Devices" }).click();
    await page.getByRole("button", { name: "Test my connection" }).click();
    const findings = page.locator(".connection-findings li");
    await expect(findings.first()).toBeVisible({ timeout: 30_000 });
    await expect(findings.filter({ hasText: "Microphone works" })).toHaveCount(1);
    await expect(page.locator(".connection-verdict")).not.toBeEmpty();
    // The test can be run again.
    await expect(page.getByRole("button", { name: "Test my connection" })).toBeEnabled();
  });
});
