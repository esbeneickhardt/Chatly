// A microphone nobody can hear is never silent about it: joining with it
// blocked still joins, you get a warning with a way to fix it, and the
// others see a red mic on you until it's fixed.

import { expect, test } from "@playwright/test";
import { befriend, closeOpenContexts, contextFor, goHome, newUser, openAs } from "./support";

test.afterEach(closeOpenContexts);

/** Makes `getUserMedia` refuse while `window.__blockMic` is true. */
const BLOCKABLE_MIC = `
  window.__blockMic = true;
  const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = (constraints) =>
    window.__blockMic && constraints && constraints.audio
      ? Promise.reject(new DOMException("Permission denied", "NotAllowedError"))
      : real(constraints);
`;

/** A "microphone" that delivers pure digital silence, like Android's
 * microphone privacy switch. */
const SILENT_MIC = `
  navigator.mediaDevices.getUserMedia = async (constraints) => {
    const ctx = new AudioContext();
    return ctx.createMediaStreamDestination().stream;
  };
`;

test.describe("microphone problems", () => {
  test("a blocked mic still joins, warns, shows on the others' side and can be fixed", async ({
    browser,
  }) => {
    const ann = await newUser("ann_mic");
    const ben = await newUser("ben_mic");
    await befriend(ann, ben);

    const annContext = await contextFor(browser, ann);
    await annContext.addInitScript(BLOCKABLE_MIC);
    const annPage = await annContext.newPage();
    await annPage.goto("/");
    await expect(annPage.locator(".guild-rail")).toBeVisible();
    const benPage = await openAs(browser, ben);
    await goHome(annPage);
    await goHome(benPage);

    await annPage.locator(".dm-item", { hasText: "Ben_mic" }).first().click();
    await annPage.locator("[title='Call']").first().click();
    await benPage.locator(".incoming-call-btn.answer").click();
    await expect(annPage.locator(".dm-call-participants")).toContainText("Ben_mic");

    const banner = annPage.locator(".mic-problem-banner");
    await expect(banner).toContainText("Microphone blocked");
    const annOnBen = benPage.locator(".dm-call-participant.mic-problem", { hasText: "Ann_mic" });
    await expect(annOnBen).toHaveCount(1);
    await expect(benPage.locator(".dm-call-participant.mic-problem")).toHaveCount(1);

    // Still blocked: says what to do.
    await banner.getByRole("button", { name: "Try again" }).click();
    await expect(banner).toContainText("Still blocked");

    // Allowed now: the warning and the red mic go away, no rejoin.
    await annPage.evaluate(() => ((window as unknown as { __blockMic: boolean }).__blockMic = false));
    await banner.getByRole("button", { name: "Try again" }).click();
    await expect(banner).toHaveCount(0);
    await expect(benPage.locator(".dm-call-participant.mic-problem")).toHaveCount(0);
  });

  test("someone joining later still sees the red mic", async ({ browser }) => {
    const ann = await newUser("ann_mic2");
    const ben = await newUser("ben_mic2");
    await befriend(ann, ben);
    const annContext = await contextFor(browser, ann);
    await annContext.addInitScript(BLOCKABLE_MIC);
    const annPage = await annContext.newPage();
    await annPage.goto("/");
    await expect(annPage.locator(".guild-rail")).toBeVisible();
    const benPage = await openAs(browser, ben);
    await goHome(annPage);
    await goHome(benPage);

    // Ann calls with a blocked mic; Ben answers only after the warning is up.
    await annPage.locator(".dm-item", { hasText: "Ben_mic2" }).first().click();
    await annPage.locator("[title='Call']").first().click();
    await expect(annPage.locator(".mic-problem-banner")).toBeVisible();
    await benPage.locator(".incoming-call-btn.answer").click();
    await expect(benPage.locator(".dm-call-participant.mic-problem", { hasText: "Ann_mic2" })).toHaveCount(1);
  });

  test("a mic that sends pure silence is called out", async ({ browser }) => {
    const ann = await newUser("ann_mic3");
    const ben = await newUser("ben_mic3");
    await befriend(ann, ben);
    const annContext = await contextFor(browser, ann);
    await annContext.addInitScript(SILENT_MIC);
    const annPage = await annContext.newPage();
    await annPage.goto("/");
    await expect(annPage.locator(".guild-rail")).toBeVisible();
    const benPage = await openAs(browser, ben);
    await goHome(annPage);
    await goHome(benPage);
    await annPage.locator(".dm-item", { hasText: "Ben_mic3" }).first().click();
    await annPage.locator("[title='Call']").first().click();
    await benPage.locator(".incoming-call-btn.answer").click();
    await expect(annPage.locator(".mic-problem-banner")).toContainText("No sound", { timeout: 15_000 });
    await expect(benPage.locator(".dm-call-participant.mic-problem", { hasText: "Ann_mic3" })).toHaveCount(1);
  });
});
