import { fuzzyMatch } from "./fuzzy";
import { icon, type IconName } from "./icons";

export type CommandGroup = "channel" | "dm" | "server" | "action";

export interface Command {
  id: string;
  label: string;
  group: CommandGroup;
  hint?: string;
  iconName?: IconName;
  keywords?: string;
  run: () => void;
}

/** Where the palette gets its entries. `commands` is asked afresh every time
 * it opens, so it never needs keeping in sync. `more` supplies entries that
 * take a request to find (other servers' channels); they appear as they
 * arrive. `searchMessages` turns whatever is typed into a message search. */
export interface PaletteSource {
  commands: () => Command[];
  more?: () => Promise<Command[]>;
  searchMessages?: (query: string) => void;
}

interface Row {
  command: Command;
  ranges: [number, number][];
  /** A section heading is drawn above this row. */
  heading?: string;
}

/** What a leading character narrows the list to. */
const MODES: Record<string, { group: CommandGroup; label: string }> = {
  "#": { group: "channel", label: "channels" },
  "@": { group: "dm", label: "people and chats" },
  ">": { group: "action", label: "actions" },
};

const GROUP_ORDER: CommandGroup[] = ["channel", "dm", "server", "action"];
const GROUP_HEADING: Record<CommandGroup, string> = {
  channel: "Channels",
  dm: "Direct messages",
  server: "Servers",
  action: "Actions",
};

const RECENT_KEY = "chatty:palette-recent";
const RECENT_MAX = 5;
const MAX_ROWS = 60;

function loadRecent(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function saveRecent(id: string): void {
  try {
    const next = [id, ...loadRecent().filter((x) => x !== id)].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* private browsing: recents just don't persist */
  }
}

/** A Cmd/Ctrl+K quick switcher: jump to any channel, conversation or server,
 * or run an action, from the keyboard. Type to narrow (every word must match);
 * start with `#` for channels, `@` for people, `>` for actions, or `?` to
 * search messages. */
export class CommandPalette {
  private backdrop: HTMLDivElement | null = null;
  private input: HTMLInputElement | null = null;
  private list: HTMLDivElement | null = null;
  private status: HTMLDivElement | null = null;
  private previouslyFocused: HTMLElement | null = null;
  private rows: Row[] = [];
  private optionEls: HTMLElement[] = [];
  private selected = 0;
  private all: Command[] = [];
  private openCount = 0;

  constructor(private readonly source: PaletteSource) {
    document.addEventListener("keydown", (e) => this.handleGlobalKeydown(e));
  }

  private handleGlobalKeydown(e: KeyboardEvent): void {
    const isMac = navigator.platform.toLowerCase().includes("mac");
    const mod = isMac ? e.metaKey : e.ctrlKey;
    if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "k") {
      e.preventDefault();
      this.toggle();
    } else if (e.key === "Escape" && this.backdrop) {
      e.stopPropagation();
      this.close();
    }
  }

  toggle(): void {
    if (this.backdrop) this.close();
    else this.open();
  }

  private open(): void {
    this.previouslyFocused = document.activeElement as HTMLElement | null;
    const session = ++this.openCount;

    const backdrop = document.createElement("div");
    backdrop.className = "palette-backdrop";
    backdrop.addEventListener("mousedown", (e) => {
      if (e.target === backdrop) this.close();
    });

    const box = document.createElement("div");
    box.className = "palette-box";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    box.setAttribute("aria-label", "Quick switcher");
    backdrop.appendChild(box);

    const inputRow = document.createElement("div");
    inputRow.className = "palette-input-row";
    inputRow.appendChild(icon("search", 16));
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Jump to a channel or person, or run a command…";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-label", "Search channels, people and commands");
    input.setAttribute("aria-expanded", "true");
    input.setAttribute("aria-controls", "palette-list");
    input.setAttribute("aria-autocomplete", "list");
    inputRow.appendChild(input);
    box.appendChild(inputRow);

    const list = document.createElement("div");
    list.className = "palette-results";
    list.id = "palette-list";
    list.setAttribute("role", "listbox");
    list.setAttribute("aria-label", "Results");
    box.appendChild(list);

    const footer = document.createElement("div");
    footer.className = "palette-footer";
    footer.textContent = "↑↓ move · Enter open · Esc close · # channels · @ people · > actions · ? messages";
    box.appendChild(footer);

    const status = document.createElement("div");
    status.className = "visually-hidden";
    status.setAttribute("aria-live", "polite");
    box.appendChild(status);

    this.backdrop = backdrop;
    this.input = input;
    this.list = list;
    this.status = status;
    this.all = this.source.commands();

    input.addEventListener("input", () => this.refresh(true));
    input.addEventListener("keydown", (e) => this.handleInputKeydown(e));
    // Keep focus in the box: Tab has nowhere else to go.
    box.addEventListener("keydown", (e) => {
      if (e.key === "Tab") {
        e.preventDefault();
        this.move(e.shiftKey ? -1 : 1);
      }
    });

    document.body.appendChild(backdrop);
    this.refresh(true);
    input.focus();

    void this.source.more?.().then((extra) => {
      if (this.openCount !== session || !this.backdrop) return;
      const known = new Set(this.all.map((c) => c.id));
      this.all = [...this.all, ...extra.filter((c) => !known.has(c.id))];
      this.refresh(false);
    });
  }

  private close(): void {
    this.backdrop?.remove();
    this.backdrop = null;
    this.input = null;
    this.list = null;
    this.status = null;
    const back = this.previouslyFocused;
    this.previouslyFocused = null;
    if (back?.isConnected) back.focus();
  }

  /** Works out the rows for what is typed. `resetSelection` is false when
   * only more entries arrived, so the highlight does not jump under the
   * user's hands. */
  private refresh(resetSelection: boolean): void {
    const raw = this.input?.value ?? "";
    const previousId = this.rows[this.selected]?.command.id;
    this.rows = this.buildRows(raw);
    if (resetSelection) {
      this.selected = 0;
    } else {
      const index = this.rows.findIndex((r) => r.command.id === previousId);
      this.selected = index >= 0 ? index : 0;
    }
    this.render();
  }

  private buildRows(raw: string): Row[] {
    const modeKey = raw[0];
    if (modeKey === "?") {
      const query = raw.slice(1).trim();
      if (!this.source.searchMessages) return [];
      return [this.searchRow(query)];
    }
    const mode = MODES[modeKey];
    const query = (mode ? raw.slice(1) : raw).trim();
    const pool = mode ? this.all.filter((c) => c.group === mode.group) : this.all;

    if (!query) return this.unfilteredRows(pool, Boolean(mode));

    const scored: { row: Row; score: number; order: number }[] = [];
    pool.forEach((command, order) => {
      const match = fuzzyMatch(query, command.label, `${command.keywords ?? ""} ${command.hint ?? ""}`);
      if (match) scored.push({ row: { command, ranges: match.ranges }, score: match.score, order });
    });
    scored.sort((a, b) => b.score - a.score || a.order - b.order);
    const rows = scored.slice(0, MAX_ROWS).map((s) => s.row);
    if (!mode && this.source.searchMessages) rows.push(this.searchRow(query));
    return rows;
  }

  private searchRow(query: string): Row {
    const label = query ? `Search messages for “${query}”` : "Search messages";
    return {
      ranges: [],
      command: {
        id: "action:search-messages",
        label,
        group: "action",
        iconName: "search",
        run: () => this.source.searchMessages?.(query),
      },
    };
  }

  /** No query: recent choices first, then everything grouped. */
  private unfilteredRows(pool: Command[], singleGroup: boolean): Row[] {
    const rows: Row[] = [];
    const shown = new Set<string>();
    if (!singleGroup) {
      for (const id of loadRecent()) {
        const command = pool.find((c) => c.id === id);
        if (command) {
          rows.push({ command, ranges: [], heading: rows.length === 0 ? "Recent" : undefined });
          shown.add(id);
        }
      }
    }
    for (const group of GROUP_ORDER) {
      let first = true;
      for (const command of pool) {
        if (command.group !== group || shown.has(command.id)) continue;
        rows.push({ command, ranges: [], heading: first && !singleGroup ? GROUP_HEADING[group] : undefined });
        first = false;
      }
    }
    return rows.slice(0, MAX_ROWS);
  }

  private render(): void {
    const list = this.list;
    if (!list) return;
    this.optionEls = [];
    if (this.rows.length === 0) {
      const empty = document.createElement("p");
      empty.className = "muted-text palette-empty";
      empty.textContent = "No matches.";
      list.replaceChildren(empty);
      this.input?.removeAttribute("aria-activedescendant");
      this.announce("No matches");
      return;
    }
    const nodes: HTMLElement[] = [];
    this.rows.forEach((row, index) => {
      if (row.heading) {
        const heading = document.createElement("div");
        heading.className = "palette-heading";
        heading.setAttribute("role", "presentation");
        heading.textContent = row.heading;
        nodes.push(heading);
      }
      const el = this.renderRow(row, index);
      this.optionEls.push(el);
      nodes.push(el);
    });
    list.replaceChildren(...nodes);
    this.applySelection();
    this.announce(`${this.rows.length} ${this.rows.length === 1 ? "result" : "results"}`);
  }

  private renderRow(row: Row, index: number): HTMLElement {
    const { command } = row;
    const el = document.createElement("div");
    el.id = `palette-option-${index}`;
    el.className = "palette-row";
    el.setAttribute("role", "option");
    if (command.iconName) el.appendChild(icon(command.iconName, 16));
    const label = document.createElement("span");
    label.className = "palette-row-label";
    let at = 0;
    for (const [start, end] of row.ranges) {
      if (start > at) label.append(command.label.slice(at, start));
      const mark = document.createElement("mark");
      mark.textContent = command.label.slice(start, end);
      label.append(mark);
      at = end;
    }
    label.append(command.label.slice(at));
    el.appendChild(label);
    if (command.hint) {
      const hint = document.createElement("span");
      hint.className = "palette-row-hint";
      hint.textContent = command.hint;
      el.appendChild(hint);
    }
    el.addEventListener("mousemove", () => {
      if (this.selected !== index) {
        this.selected = index;
        this.applySelection();
      }
    });
    el.addEventListener("click", () => this.run(command));
    return el;
  }

  private applySelection(): void {
    this.optionEls.forEach((el, i) => {
      const active = i === this.selected;
      el.classList.toggle("active", active);
      el.setAttribute("aria-selected", String(active));
    });
    const current = this.optionEls[this.selected];
    if (current) {
      this.input?.setAttribute("aria-activedescendant", current.id);
      current.scrollIntoView({ block: "nearest" });
    }
  }

  private move(delta: number): void {
    if (this.rows.length === 0) return;
    this.selected = (this.selected + delta + this.rows.length) % this.rows.length;
    this.applySelection();
  }

  private announce(text: string): void {
    if (this.status) this.status.textContent = text;
  }

  private handleInputKeydown(e: KeyboardEvent): void {
    if (e.key === "ArrowDown" || (e.ctrlKey && e.key.toLowerCase() === "n")) {
      e.preventDefault();
      this.move(1);
    } else if (e.key === "ArrowUp" || (e.ctrlKey && e.key.toLowerCase() === "p")) {
      e.preventDefault();
      this.move(-1);
    } else if (e.key === "PageDown") {
      e.preventDefault();
      this.selected = Math.min(this.rows.length - 1, this.selected + 8);
      this.applySelection();
    } else if (e.key === "PageUp") {
      e.preventDefault();
      this.selected = Math.max(0, this.selected - 8);
      this.applySelection();
    } else if (e.key === "Enter") {
      e.preventDefault();
      const row = this.rows[this.selected];
      if (row) this.run(row.command);
    }
  }

  private run(command: Command): void {
    this.close();
    if (command.id !== "action:search-messages") saveRecent(command.id);
    command.run();
  }
}
