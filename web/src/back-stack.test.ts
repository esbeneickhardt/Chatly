import { describe, expect, it } from "vitest";
import { pushBackLayer } from "./back-stack";

/** Waits for jsdom to deliver the asynchronous `popstate`. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 50));

describe("back stack", () => {
  it("back closes the top layer only", async () => {
    const closed: string[] = [];
    const releaseSheet = pushBackLayer(() => closed.push("sheet"));
    pushBackLayer(() => closed.push("page"));
    history.back();
    await settle();
    expect(closed).toEqual(["page"]);
    releaseSheet();
    await settle();
  });

  it("a layer opened while closing another survives the step back", async () => {
    const closed: string[] = [];
    const releaseSheet = pushBackLayer(() => closed.push("sheet"));
    // A sheet closes and opens a dialog in the same tap.
    releaseSheet();
    const releaseDialog = pushBackLayer(() => closed.push("dialog"));
    await settle();
    expect(closed).toEqual([]);
    // And back still closes that dialog afterwards.
    history.back();
    await settle();
    expect(closed).toEqual(["dialog"]);
    releaseDialog();
  });
});
