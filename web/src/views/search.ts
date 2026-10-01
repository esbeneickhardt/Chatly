// The message-search panel: type, pick where to look, click a result to
// jump to it. See `api::search` (Rust) for how the server matches and
// what it refuses to return.

import { api, type Message } from "../api";
import { icon } from "../icons";
import { searchTerms, snippetAround, splitByTerms } from "../search-logic";
import { renderAvatarEl } from "../ui";

export interface SearchScopeOption {
  id: string;
  label: string;
  /** Query-string parameters selecting where to look (`channel_id`,
   * `guild_id`, or `scope=dms`). */
  params: Record<string, string>;
}

const PAGE_SIZE = 25;
const TYPING_DELAY_MS = 250;

export function openSearchPanel(opts: {
  scopes: SearchScopeOption[];
  initialScopeId: string;
  /** Where a hit lives, for its label ("#general", "Ana, Ben"). */
  channelLabel: (channelId: string) => string;
  /** Open the message in the app; the panel closes first. */
  onOpen: (message: Message) => void;
}): void {
  const previouslyFocused = document.activeElement as HTMLElement | null;

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop search-backdrop";

  const panel = document.createElement("div");
  panel.className = "modal search-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-label", "Search messages");

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "icon-button modal-close";
  closeBtn.setAttribute("aria-label", "Close search");
  closeBtn.appendChild(icon("x", 16));

  const input = document.createElement("input");
  input.type = "search";
  input.className = "search-input";
  input.placeholder = "Search messages";
  input.setAttribute("aria-label", "Search messages");
  input.autocomplete = "off";
  input.spellcheck = false;

  const scopeBar = document.createElement("div");
  scopeBar.className = "segmented search-scopes";
  scopeBar.setAttribute("role", "radiogroup");
  scopeBar.setAttribute("aria-label", "Where to search");

  const status = document.createElement("p");
  status.className = "muted-text search-status";
  status.setAttribute("aria-live", "polite");

  const list = document.createElement("ul");
  list.className = "search-results";

  const moreBtn = document.createElement("button");
  moreBtn.type = "button";
  moreBtn.className = "secondary search-more";
  moreBtn.textContent = "Load more";
  moreBtn.hidden = true;

  panel.append(closeBtn, input, scopeBar, status, list, moreBtn);
  backdrop.appendChild(panel);
  document.body.appendChild(backdrop);

  let scope = opts.scopes.find((s) => s.id === opts.initialScopeId) ?? opts.scopes[0];
  let hits: Message[] = [];
  let requestSeq = 0;
  let timer: number | undefined;

  const scopeButtons = opts.scopes.map((option) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute("role", "radio");
    btn.textContent = option.label;
    btn.addEventListener("click", () => {
      scope = option;
      syncScopes();
      void run(true);
    });
    return btn;
  });
  scopeBar.append(...scopeButtons);

  function syncScopes(): void {
    opts.scopes.forEach((option, i) => {
      const active = option.id === scope.id;
      scopeButtons[i].classList.toggle("active", active);
      scopeButtons[i].setAttribute("aria-checked", String(active));
    });
  }
  syncScopes();

  function close(): void {
    window.clearTimeout(timer);
    requestSeq++;
    document.removeEventListener("keydown", onKeyDown, true);
    backdrop.remove();
    previouslyFocused?.focus?.();
  }
  function onKeyDown(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  }
  closeBtn.addEventListener("click", close);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });
  document.addEventListener("keydown", onKeyDown, true);

  /** One result: who, where, when, and the words that matched. */
  function resultItem(message: Message, terms: string[]): HTMLElement {
    const item = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "search-result";

    const head = document.createElement("div");
    head.className = "search-result-head";
    const author = document.createElement("strong");
    author.textContent = message.author_display_name;
    const where = document.createElement("span");
    where.className = "muted-text";
    where.textContent = opts.channelLabel(message.channel_id);
    const when = document.createElement("time");
    when.className = "muted-text";
    when.dateTime = new Date(message.created_at).toISOString();
    when.textContent = new Date(message.created_at).toLocaleString([], {
      dateStyle: "medium",
      timeStyle: "short",
    });
    head.append(author, where, when);

    const body = document.createElement("div");
    body.className = "search-result-body";
    for (const part of splitByTerms(snippetAround(message.content, terms), terms)) {
      if (part.match) {
        const mark = document.createElement("mark");
        mark.textContent = part.text;
        body.appendChild(mark);
      } else {
        body.appendChild(document.createTextNode(part.text));
      }
    }

    btn.append(renderAvatarEl(message.author_display_name, message.author_avatar_file_id), head, body);
    btn.addEventListener("click", () => {
      close();
      opts.onOpen(message);
    });
    item.appendChild(btn);
    return item;
  }

  function render(terms: string[]): void {
    list.replaceChildren(...hits.map((m) => resultItem(m, terms)));
  }

  async function run(fresh: boolean): Promise<void> {
    const terms = searchTerms(input.value);
    if (terms.length === 0) {
      requestSeq++;
      hits = [];
      list.replaceChildren();
      moreBtn.hidden = true;
      status.textContent = "";
      return;
    }
    const seq = ++requestSeq;
    if (fresh) hits = [];
    status.textContent = "Searching…";
    const params = new URLSearchParams({ q: input.value, limit: String(PAGE_SIZE), ...scope.params });
    if (!fresh && hits.length > 0) params.set("before", hits[hits.length - 1].id);
    try {
      const page = await api.get<Message[]>(`/api/search?${params.toString()}`);
      if (seq !== requestSeq) return; // a newer search superseded this one
      hits = fresh ? page : [...hits, ...page];
      render(terms);
      moreBtn.hidden = page.length < PAGE_SIZE;
      status.textContent =
        hits.length === 0
          ? "No messages found."
          : `${hits.length}${moreBtn.hidden ? "" : "+"} result${hits.length === 1 ? "" : "s"}`;
    } catch {
      if (seq !== requestSeq) return;
      status.textContent = "Couldn't search right now.";
    }
  }

  input.addEventListener("input", () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void run(true), TYPING_DELAY_MS);
  });
  moreBtn.addEventListener("click", () => void run(false));
  input.focus();
}
