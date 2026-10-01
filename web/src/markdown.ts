// A deliberately small, from-scratch renderer: bold, italic, inline
// code, math, auto-linked URLs, and mentions at the inline level;
// fenced code blocks, math blocks, and GFM-style tables at the block
// level. Output is always a DOM tree built with createElement/
// textContent — never innerHTML on message content — with one
// narrow, deliberate exception: KaTeX's own generated markup for math
// (see `renderMath` below), which is a well-audited library built
// specifically to safely typeset untrusted LaTeX input; nothing here
// hands it anything beyond the source string itself. No syntax
// highlighting for code blocks (would need a third-party library) —
// just verbatim monospace text, which is still a real improvement
// over losing indentation/formatting entirely.

import katex from "katex";

const TOKEN_RE =
  /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(\$[^$\n]+\$)|(https?:\/\/[^\s<]+)|(@[a-zA-Z0-9_-]{2,32})/g;

const FENCE_RE = /^```(\S*)\s*$/;
const MATH_FENCE_RE = /^\$\$\s*$/;
const MATH_SINGLE_LINE_RE = /^\$\$(.+)\$\$$/;
const TABLE_SEPARATOR_RE = /^\s*:?-{2,}:?\s*$/;

/** Renders a LaTeX source string via KaTeX. `throwOnError: false`
 * makes KaTeX itself turn a parse error into a small inline error
 * message (still safe, KaTeX-generated markup) instead of throwing —
 * the try/catch is only a defensive fallback for anything KaTeX
 * doesn't already turn into that. `trust` is left at its default
 * (`false`), which is what keeps this safe against untrusted input:
 * it disables the handful of KaTeX commands (`\href`, `\includegraphics`,
 * etc.) that could otherwise reach outside the document. */
function renderMath(source: string, displayMode: boolean): HTMLElement {
  const el = document.createElement(displayMode ? "div" : "span");
  el.className = displayMode ? "markdown-math-block" : "markdown-math-inline";
  try {
    el.innerHTML = katex.renderToString(source, { throwOnError: false, displayMode });
  } catch {
    el.textContent = source;
  }
  return el;
}

/** `mentionUsernames`, when given, is the set of usernames (lowercase)
 * that are allowed to render as a highlighted mention — anything the
 * server didn't record as an actual mention on this message (see
 * `crates/server/src/api/messages.rs::extract_mentions`) renders as
 * plain `@text` instead, so typing "@" doesn't highlight arbitrary
 * text. */
export function renderMarkdown(content: string, mentionUsernames?: Set<string>): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const lines = content.split("\n");
  let i = 0;

  while (i < lines.length) {
    const fenceMatch = FENCE_RE.exec(lines[i].trim());
    if (fenceMatch) {
      const lang = fenceMatch[1];
      const codeLines: string[] = [];
      let j = i + 1;
      while (j < lines.length && lines[j].trim() !== "```") {
        codeLines.push(lines[j]);
        j++;
      }
      // ```math / ```latex is a common alternative to `$$...$$` for a
      // math block (GitHub, Obsidian, and others all accept it) — a
      // fenced fenced block naming either language renders as KaTeX,
      // same as `$$`, rather than as a literal, unrendered code block.
      if (lang === "math" || lang === "latex") {
        fragment.appendChild(renderMath(codeLines.join("\n"), true));
      } else {
        fragment.appendChild(renderCodeBlock(codeLines.join("\n"), lang));
      }
      i = j + 1; // skip the closing fence too (or end of input if unclosed)
      continue;
    }

    // `$$...$$` on one line, or as its own fence (like ``` above)
    // wrapping one or more lines — either way rendered in KaTeX's
    // display mode (centered, its own block).
    const singleLineMath = MATH_SINGLE_LINE_RE.exec(lines[i].trim());
    if (singleLineMath) {
      fragment.appendChild(renderMath(singleLineMath[1], true));
      i++;
      continue;
    }
    if (MATH_FENCE_RE.test(lines[i].trim())) {
      const mathLines: string[] = [];
      let j = i + 1;
      while (j < lines.length && !MATH_FENCE_RE.test(lines[j].trim())) {
        mathLines.push(lines[j]);
        j++;
      }
      fragment.appendChild(renderMath(mathLines.join("\n"), true));
      i = j + 1;
      continue;
    }

    if (isTableStart(lines, i)) {
      const { element, nextIndex } = renderTable(lines, i, mentionUsernames);
      fragment.appendChild(element);
      i = nextIndex;
      continue;
    }

    // A run of ordinary lines, rendered as before (inline formatting,
    // joined with <br>) until the next fence/table interrupts it.
    const paragraphLines: string[] = [];
    while (i < lines.length && !FENCE_RE.test(lines[i].trim()) && !isTableStart(lines, i)) {
      paragraphLines.push(lines[i]);
      i++;
    }
    paragraphLines.forEach((line, index) => {
      renderLine(line, fragment, mentionUsernames);
      if (index < paragraphLines.length - 1) {
        fragment.appendChild(document.createElement("br"));
      }
    });
  }

  return fragment;
}

function renderCodeBlock(code: string, lang: string): HTMLElement {
  const pre = document.createElement("pre");
  pre.className = "markdown-code-block";
  const codeEl = document.createElement("code");
  if (lang) codeEl.dataset.lang = lang;
  codeEl.textContent = code;
  pre.appendChild(codeEl);
  return pre;
}

function splitTableRow(line: string): string[] {
  let trimmed = line.trim();
  if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
  if (trimmed.endsWith("|")) trimmed = trimmed.slice(0, -1);
  return trimmed.split("|").map((cell) => cell.trim());
}

function isTableStart(lines: string[], i: number): boolean {
  if (i + 1 >= lines.length) return false;
  const header = lines[i];
  const separator = lines[i + 1];
  if (!header.includes("|") || !separator.includes("|")) return false;
  const separatorCells = splitTableRow(separator);
  return separatorCells.length > 0 && separatorCells.every((cell) => TABLE_SEPARATOR_RE.test(cell));
}

function renderTable(
  lines: string[],
  start: number,
  mentionUsernames?: Set<string>,
): { element: HTMLElement; nextIndex: number } {
  const headerCells = splitTableRow(lines[start]);
  let i = start + 2; // skip header + separator
  const rows: string[][] = [];
  while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") {
    rows.push(splitTableRow(lines[i]));
    i++;
  }

  const table = document.createElement("table");
  table.className = "markdown-table";
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const cell of headerCells) {
    const th = document.createElement("th");
    renderLine(cell, th, mentionUsernames);
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const row of rows) {
    const tr = document.createElement("tr");
    for (const cell of row) {
      const td = document.createElement("td");
      renderLine(cell, td, mentionUsernames);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  return { element: table, nextIndex: i };
}

/** Inline-only rendering (bold/italic/code/math/links/mentions), no
 * block constructs (code fences, math fences, tables) — for contexts
 * too small/truncated for those to render sensibly, like a
 * reply-quote preview. */
export function renderInline(line: string, parent: Node, mentionUsernames?: Set<string>): void {
  renderLine(line, parent, mentionUsernames);
}

function renderLine(line: string, parent: Node, mentionUsernames?: Set<string>): void {
  let lastIndex = 0;
  TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = TOKEN_RE.exec(line)) !== null) {
    if (match.index > lastIndex) {
      parent.appendChild(document.createTextNode(line.slice(lastIndex, match.index)));
    }

    const [full, code, bold, italic, math, url, mention] = match;
    if (code) {
      const el = document.createElement("code");
      el.textContent = code.slice(1, -1);
      parent.appendChild(el);
    } else if (math) {
      parent.appendChild(renderMath(math.slice(1, -1), false));
    } else if (bold) {
      const el = document.createElement("strong");
      el.textContent = bold.slice(2, -2);
      parent.appendChild(el);
    } else if (italic) {
      const el = document.createElement("em");
      el.textContent = italic.slice(1, -1);
      parent.appendChild(el);
    } else if (url) {
      const a = document.createElement("a");
      a.href = url;
      a.textContent = url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      parent.appendChild(a);
    } else if (mention) {
      const username = mention.slice(1).toLowerCase();
      if (mentionUsernames?.has(username)) {
        const span = document.createElement("span");
        span.className = "mention";
        span.textContent = mention;
        parent.appendChild(span);
      } else {
        parent.appendChild(document.createTextNode(mention));
      }
    }

    lastIndex = match.index + full.length;
  }

  if (lastIndex < line.length) {
    parent.appendChild(document.createTextNode(line.slice(lastIndex)));
  }
}
