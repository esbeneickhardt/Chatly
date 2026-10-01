// Matching for the quick switcher: every word you type must be found in the
// text, either as a run of letters ("gen" in "general") or, failing that, as
// letters in order ("gnrl"). Matches at the start of the text or of a word
// score best. `ranges` are the matched stretches of the text, for
// highlighting.

export interface Match {
  score: number;
  /** Half-open `[start, end)` character ranges in the text that matched. */
  ranges: [number, number][];
}

const WORD_BREAKS = /[\s\-_./#@›:]/;

function isWordStart(text: string, index: number): boolean {
  return index === 0 || WORD_BREAKS.test(text[index - 1]);
}

/** Best match of one word in `text` (both already lowercased), or null. */
function matchWord(word: string, text: string): Match | null {
  // A run of letters wins: prefer the earliest word-start occurrence.
  let best: { index: number; score: number } | null = null;
  let from = 0;
  for (;;) {
    const index = text.indexOf(word, from);
    if (index < 0) break;
    const score = index === 0 ? 100 : isWordStart(text, index) ? 80 : 50;
    if (!best || score > best.score) best = { index, score };
    from = index + 1;
  }
  if (best) return { score: best.score, ranges: [[best.index, best.index + word.length]] };

  // Otherwise the letters in order, rewarding runs and word starts.
  const ranges: [number, number][] = [];
  let score = 10;
  let position = 0;
  let previous = -2;
  for (const letter of word) {
    const index = text.indexOf(letter, position);
    if (index < 0) return null;
    if (index === previous + 1) {
      score += 4;
      ranges[ranges.length - 1][1] = index + 1;
    } else {
      if (isWordStart(text, index)) score += 6;
      ranges.push([index, index + 1]);
    }
    previous = index;
    position = index + 1;
  }
  return { score, ranges };
}

function mergeRanges(ranges: [number, number][]): [number, number][] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [start, end] of sorted) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

/** Matches `query` against `label`, and (with less weight, and no
 * highlighting) against `extra`. Null unless every word matches somewhere. */
export function fuzzyMatch(query: string, label: string, extra = ""): Match | null {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return { score: 0, ranges: [] };
  const labelText = label.toLowerCase();
  const extraText = extra.toLowerCase();
  let score = 0;
  const ranges: [number, number][] = [];
  for (const word of words) {
    const inLabel = matchWord(word, labelText);
    if (inLabel) {
      score += inLabel.score;
      ranges.push(...inLabel.ranges);
      continue;
    }
    const inExtra = extraText ? matchWord(word, extraText) : null;
    if (!inExtra) return null;
    score += inExtra.score / 2;
  }
  // Shorter labels are the closer match for the same letters.
  score -= Math.min(20, label.length / 8);
  return { score, ranges: mergeRanges(ranges) };
}
