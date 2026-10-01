// A predefined-snippet picker for the composer, mirroring the emoji
// picker's spirit: people who don't want to memorize markdown syntax
// can just pick "Bold" or "Table" from a list instead. The Math
// snippet's ```latex fence *is* real KaTeX rendering (see
// markdown.ts's fence handling) — not just a nicely-displayed code
// block, which is what it used to be before that renderer support
// existed.

export interface MarkdownSnippet {
  label: string;
  example: string;
  /** Given the current selection's text (empty if nothing selected),
   * returns the replacement pieces: `before` + `placeholder` + `after`.
   * The caller selects `placeholder` afterward so the user can
   * immediately type over it. */
  wrap: (selected: string) => { before: string; placeholder: string; after: string };
}

export const MARKDOWN_SNIPPETS: MarkdownSnippet[] = [
  {
    label: "Bold",
    example: "**bold**",
    wrap: (s) => ({ before: "**", placeholder: s || "bold text", after: "**" }),
  },
  {
    label: "Italic",
    example: "*italic*",
    wrap: (s) => ({ before: "*", placeholder: s || "italic text", after: "*" }),
  },
  {
    label: "Inline code",
    example: "`code`",
    wrap: (s) => ({ before: "`", placeholder: s || "code", after: "`" }),
  },
  {
    label: "Code block",
    example: "```\n…\n```",
    wrap: (s) => ({ before: "```\n", placeholder: s || "code here", after: "\n```" }),
  },
  {
    label: "Table",
    example: "| a | b |",
    wrap: () => ({
      before: "",
      placeholder: "| Header 1 | Header 2 |\n| --- | --- |\n| Cell 1 | Cell 2 |",
      after: "",
    }),
  },
  {
    label: "Link",
    example: "[text](url)",
    wrap: (s) => ({ before: "[", placeholder: s || "link text", after: "](https://)" }),
  },
  {
    label: "Math (LaTeX)",
    example: "```latex …```",
    wrap: (s) => ({ before: "```latex\n", placeholder: s || "e^{i\\pi} + 1 = 0", after: "\n```" }),
  },
];

export function renderMarkdownSnippetPopover(
  anchor: HTMLElement,
  onPick: (snippet: MarkdownSnippet) => void,
): void {
  const existing = document.querySelector(".markdown-snippet-popover");
  if (existing) {
    existing.remove();
    return;
  }

  const popover = document.createElement("div");
  popover.className = "markdown-snippet-popover";

  for (const snippet of MARKDOWN_SNIPPETS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "markdown-snippet-option";
    const label = document.createElement("span");
    label.className = "name";
    label.textContent = snippet.label;
    const example = document.createElement("span");
    example.className = "username";
    example.textContent = snippet.example;
    btn.append(label, example);
    btn.addEventListener("click", () => {
      onPick(snippet);
      popover.remove();
    });
    popover.appendChild(btn);
  }

  document.body.appendChild(popover);
  const rect = anchor.getBoundingClientRect();
  popover.style.left = `${rect.left}px`;
  popover.style.top = `${rect.top - popover.offsetHeight - 8}px`;

  const closeOnOutsideClick = (event: MouseEvent) => {
    const target = event.target as Node;
    // `.contains`, not `!==` — `anchor` usually has its own child
    // elements (an icon), so a click that visually lands back on it
    // (e.g. clicking it again to close) can have `event.target` be
    // one of those children instead of `anchor` itself, which would
    // otherwise make that re-click look like an "outside" click too.
    if (!popover.contains(target) && !anchor.contains(target)) {
      popover.remove();
      document.removeEventListener("click", closeOnOutsideClick, true);
    }
  };
  setTimeout(() => document.addEventListener("click", closeOnOutsideClick, true), 0);
}
