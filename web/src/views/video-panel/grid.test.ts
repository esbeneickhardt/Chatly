import { describe, expect, it } from "vitest";
import { chooseGrid } from "./grid";

describe("chooseGrid", () => {
  it("one tile is one cell", () => {
    expect(chooseGrid(1, 900, 600)).toEqual({ cols: 1, rows: 1 });
  });

  it("stacks two webcams in a tall pane instead of standing them side by side", () => {
    // The pane that showed two tall slivers: about 430 x 700.
    expect(chooseGrid(2, 430, 700)).toEqual({ cols: 1, rows: 2 });
  });

  it("puts two webcams side by side in a wide pane", () => {
    expect(chooseGrid(2, 1200, 600)).toEqual({ cols: 2, rows: 1 });
  });

  it("gives four tiles a 2 x 2 in a roughly square pane", () => {
    expect(chooseGrid(4, 800, 700)).toEqual({ cols: 2, rows: 2 });
  });

  it("lines four up in a very wide strip", () => {
    expect(chooseGrid(4, 2000, 300)).toEqual({ cols: 4, rows: 1 });
  });

  it("copes with a pane that has not been measured yet", () => {
    expect(chooseGrid(3, 0, 0)).toEqual({ cols: 2, rows: 2 });
  });

  it("never plans fewer cells than tiles", () => {
    for (let count = 1; count <= 12; count++) {
      for (const [w, h] of [
        [400, 800],
        [1200, 600],
        [900, 900],
      ]) {
        const { cols, rows } = chooseGrid(count, w, h);
        expect(cols * rows).toBeGreaterThanOrEqual(count);
      }
    }
  });
});
