import { describe, expect, it } from "vitest";
import { searchTerms, snippetAround, splitByTerms } from "./search-logic";

describe("searchTerms", () => {
  it("lowercases and splits on anything that isn't a letter or digit", () => {
    expect(searchTerms('  Hello,  "WORLD"-2 ')).toEqual(["hello", "world", "2"]);
  });
  it("keeps non-English letters", () => {
    expect(searchTerms("Café ÆØÅ 日本語")).toEqual(["café", "æøå", "日本語"]);
  });
  it("is empty for nothing searchable", () => {
    expect(searchTerms("*** ---")).toEqual([]);
  });
});

describe("splitByTerms", () => {
  it("marks whole words and prefixes, case-insensitively", () => {
    expect(splitByTerms("The Quick brown fox", ["quick", "bro"])).toEqual([
      { text: "The ", match: false },
      { text: "Quick", match: true },
      { text: " ", match: false },
      { text: "brown", match: true },
      { text: " fox", match: false },
    ]);
  });
  it("does not mark a word merely containing the term", () => {
    expect(splitByTerms("unquickly", ["quick"]).some((p) => p.match)).toBe(false);
  });
  it("returns the text untouched when there are no terms", () => {
    expect(splitByTerms("anything", [])).toEqual([{ text: "anything", match: false }]);
  });
  it("never loses or reorders text", () => {
    const text = "a-b c_d  e";
    expect(
      splitByTerms(text, ["c", "e"])
        .map((p) => p.text)
        .join(""),
    ).toBe(text);
  });
});

describe("snippetAround", () => {
  it("returns short text as it is, on one line", () => {
    expect(snippetAround("line one\nline two", ["two"])).toBe("line one line two");
  });
  it("centres on the first match in long text, marking the cuts", () => {
    const text = `${"lorem ipsum ".repeat(30)}NEEDLE ${"dolor sit ".repeat(30)}`;
    const snippet = snippetAround(text, ["needle"], 80);
    expect(snippet).toContain("NEEDLE");
    expect(snippet.startsWith("…")).toBe(true);
    expect(snippet.endsWith("…")).toBe(true);
    expect(snippet.length).toBeLessThanOrEqual(84);
  });
});
