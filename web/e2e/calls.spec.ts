import { expect, type Page, test } from "@playwright/test";
import {
  befriend,
  call,
  contextFor,
  FAKE_SCREEN_SHARE,
  goHome,
  newUser,
  openAs,
  closeOpenContexts,
} from "./support";

test.afterEach(closeOpenContexts);

test.describe("calls", () => {
  test("video tiles appear for cameras and can be focused and unfocused", async ({ browser }) => {
    const ann = await newUser("ann_vid");
    const ben = await newUser("ben_vid");
    await befriend(ann, ben);

    const annPage = await openAs(browser, ann);
    const benPage = await openAs(browser, ben);
    await goHome(annPage);
    await goHome(benPage);
    await annPage.locator(".dm-item", { hasText: "Ben_vid" }).first().click();
    await annPage.locator("[title='Call']").first().click();
    await benPage.locator(".incoming-call-btn.answer").click();
    await expect(annPage.locator(".dm-call-participants")).toContainText("Ben_vid");

    // Both turn their camera on; each sees a tile for the other.
    await annPage.locator(".dm-call-stage [title='Turn on camera']").click();
    await benPage.locator(".dm-call-stage [title='Turn on camera']").click();
    const tiles = annPage.locator(".video-tiles .video-tile");
    await expect(tiles.first()).toBeVisible();
    await expect(annPage.locator(".video-tile-main, .video-tile video").first()).toBeVisible();

    // Focus a tile: the grid becomes a spotlight; unfocus restores it.
    await annPage.locator(".video-tile").first().hover();
    await annPage.locator("[title='Focus this video']").first().click();
    await expect(annPage.locator(".video-tiles.focused")).toHaveCount(1);
    await annPage.locator("[title='Unfocus this video']").first().click();
    await expect(annPage.locator(".video-tiles.focused")).toHaveCount(0);

    // Turning the camera off removes the tile on the other side.
    await annPage.locator(".dm-call-stage [title='Turn off camera']").click();
    await expect(benPage.locator(".video-tiles .video-tile")).toHaveCount(1); // only Ben's own remains
  });

  test("turning a camera or screen share on and off never interrupts the call's audio", async ({
    browser,
  }) => {
    const ann = await newUser("ann_live");
    const ben = await newUser("ben_live");
    await befriend(ann, ben);
    const annContext = await contextFor(browser, ann);
    const benContext = await contextFor(browser, ben);
    for (const context of [annContext, benContext]) await context.addInitScript(FAKE_SCREEN_SHARE);
    const annPage = await annContext.newPage();
    const benPage = await benContext.newPage();
    await annPage.goto("/");
    await benPage.goto("/");
    await goHome(annPage);
    await goHome(benPage);
    await annPage.locator(".dm-item", { hasText: "Ben_live" }).first().click();
    await annPage.locator("[title='Call']").first().click();
    await benPage.locator(".incoming-call-btn.answer").click();
    await expect(annPage.locator(".dm-call-participants")).toContainText("Ben_live");

    // What must stay the same: how many peer connections each side has made,
    // and the very audio track Ben receives Ann's voice on.
    const snapshot = (page: Page) =>
      page.evaluate(() => {
        const pcs = (window as unknown as { __pcs: RTCPeerConnection[] }).__pcs;
        const pc = pcs.at(-1);
        const audio =
          pc
            ?.getReceivers()
            .filter((r) => r.track.kind === "audio")
            .map((r) => r.track.id) ?? [];
        return { connections: pcs.length, audio, state: pc?.connectionState ?? "none" };
      });
    await expect.poll(async () => (await snapshot(benPage)).state).toBe("connected");
    await expect.poll(async () => (await snapshot(benPage)).audio.length).toBeGreaterThan(0);
    const annBefore = await snapshot(annPage);
    const benBefore = await snapshot(benPage);

    const flowing = (page: Page) =>
      expect
        .poll(() =>
          page.evaluate(() =>
            [...document.querySelectorAll<HTMLVideoElement>(".video-tile video")].some(
              (v) => v.videoWidth > 0,
            ),
          ),
        )
        .toBe(true);

    // Camera on, screen share on, camera off, camera on again, screen off.
    await annPage.locator(".dm-call-stage [title='Turn on camera']").click();
    await expect(benPage.locator(".video-tile", { hasText: "Ann_live" })).toHaveCount(1);
    await flowing(benPage);
    await annPage.locator("[title='Share your screen']").first().click();
    await expect(benPage.locator(".video-tile", { hasText: "Ann_live · screen" })).toHaveCount(1);
    await annPage.locator(".dm-call-stage [title='Turn off camera']").click();
    await expect(benPage.locator(".video-tile", { hasText: /^Ann_live$/ })).toHaveCount(0);
    await annPage.locator(".dm-call-stage [title='Turn on camera']").click();
    await expect(benPage.locator(".video-tile-label", { hasText: /^Ann_live$/ })).toHaveCount(1);
    await annPage.locator("[title='Stop sharing your screen']").first().click();
    await expect(benPage.locator(".video-tile", { hasText: "Ann_live · screen" })).toHaveCount(0);

    // The re-enabled camera really carries video again (not a dead tile).
    await expect
      .poll(() =>
        benPage.evaluate(() => {
          const tile = [...document.querySelectorAll(".video-tile")].find(
            (t) => t.querySelector(".video-tile-label")?.textContent === "Ann_live",
          );
          return (tile?.querySelector("video") as HTMLVideoElement | null)?.videoWidth ?? 0;
        }),
      )
      .toBeGreaterThan(0);

    const annAfter = await snapshot(annPage);
    const benAfter = await snapshot(benPage);
    expect(annAfter.connections).toBe(annBefore.connections);
    expect(benAfter.connections).toBe(benBefore.connections);
    expect(benAfter.audio).toEqual(benBefore.audio);
    expect(benAfter.state).toBe("connected");
  });

  test("your voice is sent clear (64 kbps) and ahead of video", async ({ browser }) => {
    const ann = await newUser("ann_vq");
    const ben = await newUser("ben_vq");
    await befriend(ann, ben);
    const annContext = await contextFor(browser, ann);
    await annContext.addInitScript(FAKE_SCREEN_SHARE);
    const annPage = await annContext.newPage();
    const benPage = await openAs(browser, ben);
    await annPage.goto("/");
    await goHome(annPage);
    await goHome(benPage);
    await annPage.locator(".dm-item", { hasText: "Ben_vq" }).first().click();
    await annPage.locator("[title='Call']").first().click();
    await benPage.locator(".incoming-call-btn.answer").click();
    await expect(annPage.locator(".dm-call-participants")).toContainText("Ben_vq");

    const read = () =>
      annPage.evaluate(async () => {
        const pc = (window as unknown as { __pcs: RTCPeerConnection[] }).__pcs.at(-1);
        const sender = pc?.getSenders().find((s) => s.track?.kind === "audio");
        if (!pc || !sender) return null;
        const outbound = [...(await pc.getStats()).values()].find(
          (r) => r.type === "outbound-rtp" && r.kind === "audio",
        );
        return {
          encoding: sender.getParameters().encodings[0],
          hint: sender.track?.contentHint,
          target: outbound?.targetBitrate ?? 0,
        };
      });
    await expect.poll(async () => (await read())?.target ?? 0).toBeGreaterThanOrEqual(60_000);
    const voice = await read();
    expect(voice?.encoding.priority).toBe("high");
    expect(voice?.encoding.networkPriority).toBe("high");
    expect(voice?.encoding.maxBitrate).toBe(64_000);
    expect(voice?.hint).toBe("speech");
  });

  test("a second tab or device on the same account does not break a call", async ({ browser }) => {
    const ann = await newUser("ann_two");
    const ben = await newUser("ben_two");
    await befriend(ann, ben);
    const open = async (account: typeof ann) => {
      const context = await contextFor(browser, account);
      await context.addInitScript(FAKE_SCREEN_SHARE);
      const page = await context.newPage();
      await page.goto("/");
      await goHome(page);
      return { context, page };
    };
    // Ann's phone opens first; then the same account is open somewhere else
    // too (another tab, a computer, an installed app), which connects later.
    const phone = await open(ann);
    const elsewhere = await open(ann);
    const benTab = await open(ben);

    const stats = (page: Page) =>
      page.evaluate(async () => {
        const pcs = (window as unknown as { __pcs: RTCPeerConnection[] }).__pcs;
        const pc = pcs.at(-1);
        let bytes = 0;
        if (pc)
          for (const report of (await pc.getStats()).values()) {
            if (report.type === "inbound-rtp" && report.kind === "audio") bytes = report.bytesReceived;
          }
        return { state: pc?.connectionState ?? "none", bytes };
      });

    await phone.page.locator(".dm-item", { hasText: "Ben_two" }).first().click();
    await phone.page.locator("[title='Call']").first().click();
    await benTab.page.locator(".incoming-call-btn.answer").click();

    // The call the phone made connects and carries sound, though a newer
    // connection of the same account exists.
    await expect.poll(async () => (await stats(phone.page)).state).toBe("connected");
    const flowing = async () => {
      const before = (await stats(phone.page)).bytes;
      await expect.poll(async () => (await stats(phone.page)).bytes).toBeGreaterThan(before);
    };
    await flowing();

    // The other place closing (its connection is old news to the server by
    // then, or a reconnect) does not hang up the call running on the phone.
    await elsewhere.context.close();
    await phone.page.waitForTimeout(1500);
    expect((await stats(phone.page)).state).toBe("connected");
    await flowing();
    await expect(phone.page.locator(".dm-call-participants")).toContainText("Ben_two");
    await expect(benTab.page.locator(".dm-call-participants")).toContainText("Ann_two");
  });

  test("calling someone who is still on the call joins it without ringing", async ({ browser }) => {
    const ann = await newUser("ann_rej");
    const ben = await newUser("ben_rej");
    await befriend(ann, ben);
    await call("POST", "/api/guilds", { name: "Elsewhere" }, ann);
    const annPage = await openAs(browser, ann);
    const benPage = await openAs(browser, ben);
    await goHome(annPage);
    await goHome(benPage);

    await annPage.locator(".dm-item", { hasText: "Ben_rej" }).first().click();
    await annPage.locator("[title='Call']").first().click();
    await benPage.locator(".incoming-call-btn.answer").click();
    await expect(annPage.locator(".dm-call-participants")).toContainText("Ben_rej");

    // Ann hangs up; Ben stays on the call.
    await annPage.locator(".dm-call-stage [title='Leave call']").click();
    await expect(annPage.locator(".dm-call-status")).toHaveText("Ben_rej is in a call");

    // Ann goes to another server and comes back: the call is still known.
    await annPage.locator(".guild-rail [title='Elsewhere']").first().click();
    await goHome(annPage);
    await annPage.locator(".dm-item", { hasText: "Ben_rej" }).first().click();
    await expect(annPage.locator(".dm-call-status")).toHaveText("Ben_rej is in a call");

    // She reloads the page: it asks the server who is on the call.
    await annPage.reload();
    await goHome(annPage);
    await annPage.locator(".dm-item", { hasText: "Ben_rej" }).first().click();
    await expect(annPage.locator(".dm-call-status")).toHaveText("Ben_rej is in a call");

    // Calling him again joins the call he is on: both are shown as present,
    // and nobody is being rung.
    await annPage.locator("[title='Call']").first().click();
    await expect(annPage.locator(".dm-call-participant")).toHaveCount(2);
    await expect(annPage.locator(".dm-call-participant.ringing")).toHaveCount(0);
    await expect(annPage.locator(".dm-call-status")).not.toHaveText("Ringing");
    await expect(annPage.locator(".dm-call-participants")).toContainText("Ben_rej");
    // Ben was never rung for it either.
    await expect(benPage.locator(".incoming-call-banner")).toHaveCount(0);
  });

  test("calling someone who has left too still rings them", async ({ browser }) => {
    const ann = await newUser("ann_ring2");
    const ben = await newUser("ben_ring2");
    await befriend(ann, ben);
    const annPage = await openAs(browser, ann);
    const benPage = await openAs(browser, ben);
    await goHome(annPage);
    await goHome(benPage);
    await annPage.locator(".dm-item", { hasText: "Ben_ring2" }).first().click();
    await annPage.locator("[title='Call']").first().click();
    await benPage.locator(".incoming-call-btn.answer").click();
    await expect(annPage.locator(".dm-call-participants")).toContainText("Ben_ring2");
    await annPage.locator(".dm-call-stage [title='Leave call']").click();
    await benPage.locator(".dm-call-stage [title='Leave call']").click();
    await expect(annPage.locator(".dm-call-stage")).toBeHidden();

    // Nobody is on it now, so this is a real call again: Ben is rung.
    await annPage.locator("[title='Call']").first().click();
    await expect(annPage.locator(".dm-call-status")).toHaveText("Ringing");
    await expect(benPage.locator(".incoming-call-banner")).toBeVisible();
  });

  test("declining a call tells the caller", async ({ browser }) => {
    const ann = await newUser("ann_decl");
    const ben = await newUser("ben_decl");
    await befriend(ann, ben);

    const annPage = await openAs(browser, ann);
    const benPage = await openAs(browser, ben);
    await goHome(annPage);
    await goHome(benPage);

    await annPage.locator(".dm-item", { hasText: "Ben_decl" }).first().click();
    await annPage.locator("[title='Call']").first().click();
    await expect(annPage.locator(".dm-call-status")).toContainText("Ringing");

    await benPage.locator(".incoming-call-btn.decline").click();
    await expect(benPage.locator(".incoming-call-banner")).toHaveCount(0);

    // Ann sees the answer instead of ringing on until it times out.
    await expect(annPage.locator(".dm-call-status")).toHaveText("Declined");
    await expect(annPage.locator(".dm-call-participant.declined")).toContainText("Ben_decl");
  });

  test("adding someone mid-call puts all three in one call", async ({ browser }) => {
    const ann = await newUser("ann_call");
    const ben = await newUser("ben_call");
    const cy = await newUser("cy_call");
    await befriend(ann, ben);
    await befriend(ann, cy);

    const annPage = await openAs(browser, ann);
    const benPage = await openAs(browser, ben);
    const cyPage = await openAs(browser, cy);
    await goHome(annPage);
    await goHome(benPage);
    await goHome(cyPage);

    // Ann calls Ben; Ben answers.
    await annPage.locator(".dm-item", { hasText: "Ben_call" }).first().click();
    await annPage.locator("[title='Call']").first().click();
    await benPage.locator(".incoming-call-btn.answer").click();
    await expect(annPage.locator(".dm-call-participants")).toContainText("Ben_call");
    await expect(benPage.locator(".dm-call-participants")).toContainText("Ann_call");

    // Ann adds Cy through the UI: the 1:1 chat stays, the call moves to a new group.
    await annPage.locator("[title='Conversation options']").click();
    await annPage.getByText("Add people").click();
    await annPage.locator("input").last().fill(cy.username);
    await annPage.locator(".user-search-row", { hasText: "Cy_call" }).first().click();
    await expect(annPage.getByText("Added")).toBeVisible();

    // Cy, who never opened any of this, is rung for the group…
    await expect(cyPage.locator(".incoming-call-banner")).toContainText("Incoming call");
    // …but Ben is not: he is already on the call, and follows it into the group.
    await expect(benPage.locator(".notice")).toContainText("Your call moved to a group chat");
    await expect(benPage.locator(".incoming-call-banner")).toHaveCount(0);

    await cyPage.locator(".incoming-call-btn.answer").click();

    // Three people, one call, everyone sees the other two.
    for (const [page, others] of [
      [annPage, ["Ben_call", "Cy_call"]],
      [benPage, ["Ann_call", "Cy_call"]],
      [cyPage, ["Ann_call", "Ben_call"]],
    ] as const) {
      for (const name of others) {
        await expect(page.locator(".dm-call-participants")).toContainText(name);
      }
    }
    await expect(benPage.locator(".incoming-call-banner")).toHaveCount(0);

    // The original 1:1 is still there, untouched.
    await expect(annPage.locator(".dm-item", { hasText: "Ben_call", hasNotText: "Cy_call" })).toHaveCount(1);
    // (and the group is a separate row)
    await expect(annPage.locator(".dm-item", { hasText: "Cy_call" })).toHaveCount(2);
  });

  test("adding someone while the other person is still being rung", async ({ browser }) => {
    const ann = await newUser("ann_ring");
    const ben = await newUser("ben_ring");
    const cy = await newUser("cy_ring");
    await befriend(ann, ben);
    await befriend(ann, cy);
    const annPage = await openAs(browser, ann);
    const benPage = await openAs(browser, ben);
    const cyPage = await openAs(browser, cy);
    await goHome(annPage);
    await goHome(benPage);
    await goHome(cyPage);

    // Ann calls Ben, who has not answered yet, and adds Cy meanwhile.
    await annPage.locator(".dm-item", { hasText: "Ben_ring" }).first().click();
    await annPage.locator("[title='Call']").first().click();
    await expect(benPage.locator(".incoming-call-banner")).toBeVisible();
    await annPage.locator("[title='Conversation options']").click();
    await annPage.getByText("Add people").click();
    await annPage.locator("input").last().fill(cy.username);
    await annPage.locator(".user-search-row", { hasText: "Cy_ring" }).first().click();
    await expect(annPage.getByText("Added")).toBeVisible();

    // Ben's ring for the old 1:1 call is replaced by one for the group, so
    // answering it can't strand him alone in a call nobody is on.
    await expect(cyPage.locator(".incoming-call-banner")).toContainText("Ann_ring");
    await expect(benPage.locator(".incoming-call-banner")).toContainText("Ann_ring");
    await benPage.locator(".incoming-call-btn.answer").click();
    await expect(benPage.locator(".dm-call-participants")).toContainText("Ann_ring");
  });

  test("joining another call asks first", async ({ browser }) => {
    const ann = await newUser("ann_ask");
    const ben = await newUser("ben_ask");
    const cy = await newUser("cy_ask");
    await befriend(ann, ben);
    await befriend(ann, cy);
    const annPage = await openAs(browser, ann);
    const benPage = await openAs(browser, ben);
    const cyPage = await openAs(browser, cy);
    await goHome(annPage);
    await goHome(benPage);
    await goHome(cyPage);

    // Ann is on a call with Ben.
    await annPage.locator(".dm-item", { hasText: "Ben_ask" }).first().click();
    await annPage.locator("[title='Call']").first().click();
    await benPage.locator(".incoming-call-btn.answer").click();
    await expect(annPage.locator(".dm-call-participants")).toContainText("Ben_ask");

    // Starting a call with Cy asks first; "Cancel" keeps her on Ben's call.
    await annPage.locator(".dm-item", { hasText: "Cy_ask" }).first().click();
    await annPage.locator("[title='Call']").first().click();
    const dialog = annPage.getByRole("alertdialog");
    await expect(dialog).toContainText("Leave your current call?");
    await expect(dialog).toContainText("a call with Ben_ask");
    await expect(dialog).toContainText("a call with Cy_ask");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(cyPage.locator(".incoming-call-banner")).toHaveCount(0);
    await annPage.locator(".dm-item", { hasText: "Ben_ask" }).first().click();
    await expect(annPage.locator(".dm-call-participants")).toContainText("Ben_ask");

    // Cy calls Ann instead: answering asks first too, and Cancel leaves it ringing.
    await cyPage.locator(".dm-item", { hasText: "Ann_ask" }).first().click();
    await cyPage.locator("[title='Call']").first().click();
    await expect(annPage.locator(".incoming-call-banner")).toBeVisible();
    await annPage.locator(".incoming-call-btn.answer").click();
    await annPage.getByRole("alertdialog").getByRole("button", { name: "Cancel" }).click();
    await expect(annPage.locator(".incoming-call-banner")).toBeVisible();

    // Say yes and she really switches.
    await annPage.locator(".incoming-call-btn.answer").click();
    await annPage.getByRole("alertdialog").getByRole("button", { name: "Switch call" }).click();
    await expect(annPage.locator(".dm-call-participants")).toContainText("Cy_ask");
    await expect(annPage.locator(".incoming-call-banner")).toHaveCount(0);
  });

  test("leaving your own call, or joining when you're on none, never asks", async ({ browser }) => {
    const ann = await newUser("ann_free");
    const ben = await newUser("ben_free");
    await befriend(ann, ben);
    const annPage = await openAs(browser, ann);
    const benPage = await openAs(browser, ben);
    await goHome(annPage);
    await goHome(benPage);
    await annPage.locator(".dm-item", { hasText: "Ben_free" }).first().click();
    await annPage.locator("[title='Call']").first().click();
    await expect(annPage.getByRole("alertdialog")).toHaveCount(0);
    await benPage.locator(".incoming-call-btn.answer").click();
    await expect(benPage.getByRole("alertdialog")).toHaveCount(0);
    await expect(annPage.locator(".dm-call-participants")).toContainText("Ben_free");
  });

  test("screen share is sent as motion video and its audio can be boosted past 100%", async ({ browser }) => {
    const ann = await newUser("ann_ss");
    const ben = await newUser("ben_ss");
    await befriend(ann, ben);

    const annContext = await contextFor(browser, ann);
    await annContext.addInitScript(FAKE_SCREEN_SHARE);
    const benContext = await contextFor(browser, ben);
    await benContext.addInitScript(FAKE_SCREEN_SHARE);
    const annPage = await annContext.newPage();
    const benPage = await benContext.newPage();
    await annPage.goto("/");
    await benPage.goto("/");
    await goHome(annPage);
    await goHome(benPage);

    await annPage.locator(".dm-item", { hasText: "Ben_ss" }).first().click();
    await annPage.locator("[title='Call']").first().click();
    await benPage.locator(".incoming-call-btn.answer").click();
    await expect(annPage.locator(".dm-call-participants")).toContainText("Ben_ss");

    await annPage.locator("[title='Share your screen']").first().click();

    // Sharing rebuilds the peer connection, so wait until the newest one
    // actually carries the screen's video track.
    const readSenders = () =>
      annPage.evaluate(() => {
        const pc = (window as unknown as { __pcs: RTCPeerConnection[] }).__pcs.at(-1)!;
        return pc
          .getSenders()
          .filter((s) => s.track)
          .map((s) => ({
            kind: s.track!.kind,
            hint: s.track!.contentHint,
            encoding: s.getParameters().encodings[0],
          }));
      });
    await expect.poll(async () => (await readSenders()).some((s) => s.kind === "video")).toBe(true);
    const sender = await readSenders();
    const video = sender.find((s) => s.kind === "video")!;
    expect(video.hint).toBe("motion");
    expect(video.encoding.maxBitrate).toBe(4_000_000);
    expect(video.encoding.maxFramerate).toBe(30);
    expect(video.encoding.scaleResolutionDownBy).toBeCloseTo(2560 / 1920, 2); // capped at 1920 px
    const audio = sender.filter((s) => s.kind === "audio").find((s) => s.hint === "music");
    expect(audio?.encoding.maxBitrate).toBe(128_000);

    // Ben can drive the screen-audio slider to 300%, and the sound really is amplified.
    const slider = benPage.locator(".video-tile-screen-volume").first();
    await expect(slider).toHaveAttribute("max", "300");
    await slider.evaluate((el: HTMLInputElement) => {
      el.hidden = false;
      el.value = "300";
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await expect
      .poll(() =>
        benPage.evaluate(() =>
          (window as unknown as { __gains: GainNode[] }).__gains.some(
            (g) => Math.abs(g.gain.value - 3) < 1e-6,
          ),
        ),
      )
      .toBe(true);
    const muted = await benPage.evaluate(
      () => [...document.querySelectorAll("audio")].filter((a) => a.muted).length,
    );
    expect(muted).toBeGreaterThan(0); // the boosted element is muted; Web Audio plays it instead
  });
});
