import { describe, expect, it } from "vitest";
import { bundleIn, runningBundle } from "./update-check";

describe("update check", () => {
  it("finds the hashed script in a page", () => {
    const html = `<html><script type="module" crossorigin src="/assets/index-oCiZO85d.js"></script></html>`;
    expect(bundleIn(html)).toBe("/assets/index-oCiZO85d.js");
  });

  it("finds nothing in a page without one (development)", () => {
    expect(bundleIn(`<script type="module" src="/src/main.ts"></script>`)).toBeNull();
  });

  it("reads the script this tab is running", () => {
    document.head.innerHTML = `<script src="/assets/index-AbC-123_x.js"></script>`;
    expect(runningBundle()).toBe("/assets/index-AbC-123_x.js");
    document.head.innerHTML = `<script src="/src/main.ts"></script>`;
    expect(runningBundle()).toBeNull();
  });

  it("tells old from new by the name", () => {
    const old = bundleIn(`<script src="/assets/index-OLD11111.js"></script>`);
    const now = bundleIn(`<script src="/assets/index-NEW22222.js"></script>`);
    expect(old).not.toBe(now);
  });
});
