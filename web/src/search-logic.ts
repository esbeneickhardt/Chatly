// The pure part of message search: turning what someone typed into the
// words the server searches for, and marking those words in a result.
// Kept free of the DOM so it can be unit-tested.

const WORD = /[\p{L}\p{N}]+/gu;

/** The words a query is made of — lowercase runs of letters/digits, the
 * same way the server splits them (`api::search::build_match_query`). */
export function searchTerms(query: string): string[] {
  return (query.toLowerCase().match(WORD) ?? []).slice(0, 12);
}

export interface TextPart {
  text: string;
  match: boolean;
}

/** Splits `text` into runs, marking the words that start with any of
 * `terms` (case-insensitively) — the server matches whole words plus a
 * prefix on the last one, so highlighting prefixes agrees with what it
 * returned. */
export function splitByTerms(text: string, terms: string[]): TextPart[] {
  if (terms.length === 0) return [{ text, match: false }];
  const parts: TextPart[] = [];
  let cursor = 0;
  for (const found of text.matchAll(WORD)) {
    const start = found.index ?? 0;
    const word = found[0].toLowerCase();
    if (!terms.some((term) => word.startsWith(term))) continue;
    if (start > cursor) parts.push({ text: text.slice(cursor, start), match: false });
    parts.push({ text: found[0], match: true });
    cursor = start + found[0].length;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), match: false });
  return parts.length > 0 ? parts : [{ text, match: false }];
}

/** A short excerpt of `text` around the first matching word, with
 * ellipses where it was cut — long messages otherwise push the match out
 * of sight. Newlines become spaces so a result stays one block. */
export function snippetAround(text: string, terms: string[], maxLength = 160): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= maxLength) return flat;
  const first = splitByTerms(flat, terms).find((part) => part.match);
  const at = first ? flat.indexOf(first.text) : 0;
  const start = Math.max(0, Math.min(at - Math.floor(maxLength / 4), flat.length - maxLength));
  const end = Math.min(flat.length, start + maxLength);
  return `${start > 0 ? "…" : ""}${flat.slice(start, end).trim()}${end < flat.length ? "…" : ""}`;
}
