import { describe, expect, it } from "vitest";
import { IDLE_AFTER_MS, isActive } from "./gateway";

describe("whether someone is using the page", () => {
  it("is when it's in front, focused and recently touched", () => {
    expect(isActive(true, true, 1000)).toBe(true);
  });

  it("isn't when hidden, unfocused, or left alone", () => {
    expect(isActive(false, true, 1000)).toBe(false);
    expect(isActive(true, false, 1000)).toBe(false);
    expect(isActive(true, true, IDLE_AFTER_MS)).toBe(false);
  });
});
