import { expect, test } from "@playwright/test";
import { befriend, closeOpenContexts, goHome, newUser, openAs } from "./support";

test.afterEach(closeOpenContexts);

test.describe("call layout", () => {
  test("two webcams use the space, and hiding the chat gives it all to the video", async ({ browser }) => {
    const ann = await newUser("ann_lay");
    const ben = await newUser("ben_lay");
    await befriend(ann, ben);
    const a = await openAs(browser, ann);
    const b = await openAs(browser, ben);
    await goHome(a);
    await goHome(b);
    await a.locator(".dm-item", { hasText: "Ben_lay" }).first().click();
    await a.locator("[title='Call']").first().click();
    await b.locator(".incoming-call-btn.answer").click();
    await expect(a.locator(".dm-call-participants")).toContainText("Ben_lay");
    await a.locator(".dm-call-stage [title='Turn on camera']").click();
    await b.locator(".dm-call-stage [title='Turn on camera']").click();
    await expect(a.locator(".video-tile")).toHaveCount(2);

    const boxes = () =>
      a.evaluate(() => {
        const rect = (selector: string) => {
          const el = document.querySelector(selector);
          const r = el?.getBoundingClientRect();
          return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null;
        };
        const tiles = [...document.querySelectorAll(".video-tile")].map((t) => {
          const r = t.getBoundingClientRect();
          return { x: r.x, y: r.y, w: r.width, h: r.height };
        });
        return { split: rect(".content-split"), panel: rect(".video-tiles-panel"), tiles };
      });

    // Chat showing: the pane is tall and narrow, so the two stack (each
    // wider than tall) instead of standing as two slivers.
    let layout = await boxes();
    expect(layout.tiles).toHaveLength(2);
    for (const tile of layout.tiles) expect(tile.w / tile.h).toBeGreaterThan(1);
    expect(layout.tiles[1].y).toBeGreaterThan(layout.tiles[0].y + layout.tiles[0].h - 1);

    // Chat hidden: the video takes the whole width, nothing left empty.
    await a.locator("[title='Hide chat']").click();
    await expect
      .poll(async () => {
        layout = await boxes();
        return Math.round((layout.split?.w ?? 0) - (layout.panel?.w ?? 0));
      })
      .toBeLessThanOrEqual(1);
    const rightEdge = Math.max(...layout.tiles.map((t) => t.x + t.w));
    expect((layout.split?.x ?? 0) + (layout.split?.w ?? 0) - rightEdge).toBeLessThan(24);

    // And showing the chat again gives the space back.
    await a.locator("[title='Show chat']").click();
    await expect
      .poll(async () => {
        layout = await boxes();
        return (layout.panel?.w ?? 0) < (layout.split?.w ?? 0) - 100;
      })
      .toBe(true);
  });
});
