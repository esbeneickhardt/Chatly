import { describe, expect, it } from "vitest";
import { type Match, fuzzyMatch } from "./fuzzy";

/** A match that must exist. */
function must(query: string, label: string, extra = ""): Match {
  const match = fuzzyMatch(query, label, extra);
  if (!match) throw new Error(`expected "${query}" to match "${label}"`);
  return match;
}

describe("fuzzyMatch", () => {
  it("matches everything when there is no query", () => {
    expect(fuzzyMatch("", "general")).toEqual({ score: 0, ranges: [] });
  });

  it("needs every word to be found", () => {
    expect(fuzzyMatch("gen chat", "general")).toBeNull();
    expect(fuzzyMatch("gen", "general")).not.toBeNull();
  });

  it("prefers the start of the text, then the start of a word, then the middle", () => {
    const prefix = must("gen", "general").score;
    const wordStart = must("gen", "the general").score;
    const middle = must("gen", "regenerate").score;
    expect(prefix).toBeGreaterThan(wordStart);
    expect(wordStart).toBeGreaterThan(middle);
  });

  it("finds letters in order when there is no run", () => {
    const match = fuzzyMatch("gnrl", "general");
    expect(match).not.toBeNull();
    expect(fuzzyMatch("gnrlz", "general")).toBeNull();
  });

  it("reports the stretches to highlight, merged", () => {
    expect(must("gen", "general").ranges).toEqual([[0, 3]]);
    expect(must("ral gen", "general").ranges).toEqual([
      [0, 3],
      [4, 7],
    ]);
    expect(must("ge en", "general").ranges).toEqual([[0, 3]]);
  });

  it("can match through keywords, without highlighting them", () => {
    expect(must("ann", "Direct chat", "ann_x ben").ranges).toEqual([]);
  });

  it("treats a server-and-channel label as separate words", () => {
    expect(must("gen", "Movies › general").score).toBeGreaterThan(must("gen", "Movies › xgeneral").score);
  });

  it("is case-insensitive", () => {
    expect(fuzzyMatch("GEN", "General")).not.toBeNull();
  });
});
