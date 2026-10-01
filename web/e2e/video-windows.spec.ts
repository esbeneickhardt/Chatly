import { expect, type Page, test } from "@playwright/test";
import { befriend, contextFor, FAKE_SCREEN_SHARE, goHome, newUser, closeOpenContexts } from "./support";

test.afterEach(closeOpenContexts);

// Headless Chromium can't open a native Picture-in-Picture window, so these
// tests exercise the fallback every browser has (a real window of its own),
// which is also what Firefox users get.
const NO_NATIVE_PIP = `
  Object.defineProperty(document, "pictureInPictureEnabled", { value: false });
  delete window.documentPictureInPicture;`;

// Stands in for Document Picture-in-Picture (Chrome, Edge) with an ordinary
// popup, so the code that fills and empties the shared window can be tested.
// That it floats over a full-screen app is the operating system's doing and
// is not tested here.
const FAKE_DOCUMENT_PIP = `
  Object.defineProperty(document, "pictureInPictureEnabled", { value: false });
  window.documentPictureInPicture = {
    requestWindow: async () => window.open("", "chatly-pip-stub", "popup=yes,width=360,height=240"),
  };`;

async function callWithCameraAndScreen(
  browser: Parameters<typeof contextFor>[0],
  name: string,
  popoutScript = NO_NATIVE_PIP,
) {
  const ann = await newUser(`ann_${name}`);
  const ben = await newUser(`ben_${name}`);
  await befriend(ann, ben);
  const annContext = await contextFor(browser, ann);
  const benContext = await contextFor(browser, ben);
  for (const context of [annContext, benContext]) {
    await context.addInitScript(FAKE_SCREEN_SHARE);
    await context.addInitScript(popoutScript);
  }
  const annPage = await annContext.newPage();
  const benPage = await benContext.newPage();
  await annPage.goto("/");
  await benPage.goto("/");
  await goHome(annPage);
  await goHome(benPage);

  await annPage
    .locator(".dm-item", { hasText: `Ben_${name}` })
    .first()
    .click();
  await annPage.locator("[title='Call']").first().click();
  await benPage.locator(".incoming-call-btn.answer").click();
  await expect(annPage.locator(".dm-call-participants")).toContainText(`Ben_${name}`);

  await annPage.locator(".dm-call-stage [title='Turn on camera']").click();
  await annPage.locator("[title='Share your screen']").first().click();
  return { annPage, benPage, benContext, ann: `Ann_${name}` };
}

const tileOf = (page: Page, label: string) =>
  page.locator(".video-tile", { has: page.locator(".video-tile-label", { hasText: label }) });

test.describe("video windows", () => {
  test("a person's camera and screen share are separate tiles with their own controls", async ({
    browser,
  }) => {
    const { benPage, ann } = await callWithCameraAndScreen(browser, "vw1");

    const camera = benPage.locator(".video-tile", {
      has: benPage.locator(".video-tile-label", { hasText: new RegExp(`^${ann}$`) }),
    });
    const screen = tileOf(benPage, `${ann} · screen`);
    await expect(camera).toHaveCount(1);
    await expect(screen).toHaveCount(1);
    // Nothing is overlaid on anything else.
    await expect(benPage.locator(".video-tile-pip")).toHaveCount(0);
    for (const tile of [camera, screen]) {
      await expect(tile.locator("[title='Pop out this video']")).toHaveCount(1);
      await expect(tile.locator("[title='Full screen']")).toHaveCount(1);
      await expect(tile.locator("video")).toHaveCount(1);
    }
  });

  test("pop out a webcam, then full-screen the screen share, and both stay put", async ({ browser }) => {
    const { annPage, benPage, benContext, ann } = await callWithCameraAndScreen(browser, "vw2");

    const camera = benPage.locator(".video-tile", {
      has: benPage.locator(".video-tile-label", { hasText: new RegExp(`^${ann}$`) }),
    });
    const screen = tileOf(benPage, `${ann} · screen`);
    await expect(camera).toHaveCount(1);
    await expect(screen).toHaveCount(1);

    // Pop the webcam out: a real window opens, showing the same stream, and
    // its tile gives its space back to the rest of the call.
    await camera.hover();
    const [popup] = await Promise.all([
      benContext.waitForEvent("page"),
      camera.locator("[title='Pop out this video']").click(),
    ]);
    await expect
      .poll(() => popup.evaluate(() => Boolean(document.querySelector("video")?.srcObject)))
      .toBe(true);
    await expect(camera).toHaveClass(/tile-in-pip/);
    await expect(screen).not.toHaveClass(/tile-in-pip/);

    // Full-screen the screen share while the webcam is out.
    await screen.hover();
    await screen.locator("[title='Full screen']").click();
    const fullscreenIsScreen = () =>
      benPage.evaluate(
        () => document.fullscreenElement?.closest(".video-tile")?.getAttribute("data-video-key") ?? null,
      );
    await expect.poll(fullscreenIsScreen).not.toBeNull();
    const before = await fullscreenIsScreen();

    // The call changes underneath it: Ann's camera goes off and on again,
    // which re-lays-out the tiles. Full screen must not be dropped.
    await annPage.locator(".dm-call-stage [title='Turn off camera']").click();
    await expect(camera).toHaveCount(0);
    await expect.poll(() => popup.isClosed()).toBe(true); // its stream is gone, so is its window
    await annPage.locator(".dm-call-stage [title='Turn on camera']").click();
    await expect(camera).toHaveCount(1);
    expect(await fullscreenIsScreen()).toBe(before);
  });

  test("closing a pop-out window brings its tile back", async ({ browser }) => {
    const { benPage, benContext, ann } = await callWithCameraAndScreen(browser, "vw3");
    const camera = benPage.locator(".video-tile", {
      has: benPage.locator(".video-tile-label", { hasText: new RegExp(`^${ann}$`) }),
    });
    await expect(camera).toHaveCount(1);
    await camera.hover();
    const [popup] = await Promise.all([
      benContext.waitForEvent("page"),
      camera.locator("[title='Pop out this video']").click(),
    ]);
    await expect(camera).toHaveClass(/tile-in-pip/);
    await popup.close();
    await expect(camera).not.toHaveClass(/tile-in-pip/);
  });

  test("several pop-outs share one always-on-top window", async ({ browser }) => {
    const { benPage, benContext, ann } = await callWithCameraAndScreen(browser, "vw4", FAKE_DOCUMENT_PIP);
    const camera = benPage.locator(".video-tile", {
      has: benPage.locator(".video-tile-label", { hasText: new RegExp(`^${ann}$`) }),
    });
    const screen = tileOf(benPage, `${ann} · screen`);
    await expect(camera).toHaveCount(1);
    await expect(screen).toHaveCount(1);

    // The first pop-out opens the shared window…
    await camera.hover();
    const [shared] = await Promise.all([
      benContext.waitForEvent("page"),
      camera.locator("[title='Pop out this video']").click(),
    ]);
    await expect(shared.locator("#popouts video")).toHaveCount(1);
    await expect(camera).toHaveClass(/tile-in-pip/);

    // …the second goes into the same window, not a new one.
    await screen.hover();
    await screen.locator("[title='Pop out this video']").click();
    await expect(shared.locator("#popouts video")).toHaveCount(2);
    await expect(screen).toHaveClass(/tile-in-pip/);
    expect(benContext.pages()).toHaveLength(2);
    await expect
      .poll(() =>
        shared.evaluate(() => [...document.querySelectorAll("video")].every((v) => v.srcObject !== null)),
      )
      .toBe(true);

    // Putting one back leaves the other out.
    await shared
      .getByRole("button", { name: /^Put .* back in the call window$/ })
      .first()
      .click();
    await expect(shared.locator("#popouts video")).toHaveCount(1);
    await expect(camera).not.toHaveClass(/tile-in-pip/);
    await expect(screen).toHaveClass(/tile-in-pip/);

    // Putting back the last one closes the window.
    await shared.getByRole("button", { name: /^Put .* back in the call window$/ }).click();
    await expect.poll(() => shared.isClosed()).toBe(true);
    await expect(screen).not.toHaveClass(/tile-in-pip/);
  });

  test("closing the shared window brings every tile back", async ({ browser }) => {
    const { benPage, benContext, ann } = await callWithCameraAndScreen(browser, "vw5", FAKE_DOCUMENT_PIP);
    const camera = benPage.locator(".video-tile", {
      has: benPage.locator(".video-tile-label", { hasText: new RegExp(`^${ann}$`) }),
    });
    const screen = tileOf(benPage, `${ann} · screen`);
    await expect(screen).toHaveCount(1);
    await camera.hover();
    const [shared] = await Promise.all([
      benContext.waitForEvent("page"),
      camera.locator("[title='Pop out this video']").click(),
    ]);
    await screen.hover();
    await screen.locator("[title='Pop out this video']").click();
    await expect(shared.locator("#popouts video")).toHaveCount(2);
    await shared.close();
    await expect(camera).not.toHaveClass(/tile-in-pip/);
    await expect(screen).not.toHaveClass(/tile-in-pip/);
  });

  test("on a Mac, the plain-window fallback says it can't stay over a full-screen app", async ({
    browser,
  }) => {
    const MAC = `Object.defineProperty(navigator, "platform", { value: "MacIntel" });`;
    const { benPage, benContext, ann } = await callWithCameraAndScreen(browser, "vw6", NO_NATIVE_PIP + MAC);
    const camera = benPage.locator(".video-tile", {
      has: benPage.locator(".video-tile-label", { hasText: new RegExp(`^${ann}$`) }),
    });
    await expect(camera).toHaveCount(1);
    await camera.hover();
    await Promise.all([
      benContext.waitForEvent("page"),
      camera.locator("[title='Pop out this video']").click(),
    ]);
    await expect(benPage.locator(".notice")).toContainText("full-screen app");
  });
});
