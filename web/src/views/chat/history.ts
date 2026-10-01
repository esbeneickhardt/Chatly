// Message history: the newest page, older pages while scrolling up, and the window around a message after jumping to it (search result, reply quote).

import { type Message, api } from "../../api";
import { dateKey } from "../chat/helpers";
import { type ComposerDomParts } from "./composer-dom";
import { type MessagesParts } from "./messages";
import type { ChatState } from "./state";

/** What this part of the chat screen needs from the rest of it. */
export interface createHistoryContext {
  messages: MessagesParts;
  composerDom: ComposerDomParts;
  state: ChatState;
}

export function createHistory(ctx: createHistoryContext) {
  const { state } = ctx;
  const { appendMessage } = ctx.messages;
  const { jumpToPresentBtn, messageList } = ctx.composerDom;

  /** Bumped on every `loadMessages`, so a slower earlier fetch that
   * resolves *after* a newer one (answering a call runs
   * `switchToHome` — which selects the first DM — and then
   * `selectDm` on the actual caller, back to back; rapid channel
   * switching does the same) can tell it's stale and bail instead of
   * appending its messages (or a second "No messages yet" line) on
   * top of the newer list. */
  let loadMessagesSeq = 0;

  // --- History paging ---------------------------------------------------
  // The list shows a *window* of a channel's history: the newest page at
  // first, older pages as you scroll up, and — after jumping to a search
  // result or reply — a window around that message that scrolls both
  // ways until it reaches the present again.
  const HISTORY_PAGE = 50;
  const HISTORY_EDGE_PX = 160;
  let oldestLoadedId: string | null = null;
  let newestLoadedId: string | null = null;
  let hasOlder = false;
  let hasNewer = false;
  let loadingHistory = false;
  /** Set by "open this message" (search, a reply quote) and consumed by
   * the next `loadMessages`, which then loads around it. */
  let pendingJump: string | null = null;

  function trackLoadedRange(id: string): void {
    const value = BigInt(id);
    if (oldestLoadedId === null || value < BigInt(oldestLoadedId)) oldestLoadedId = id;
    if (newestLoadedId === null || value > BigInt(newestLoadedId)) newestLoadedId = id;
  }

  function syncJumpToPresent(): void {
    jumpToPresentBtn.hidden = !hasNewer;
    if (!hasNewer) jumpToPresentBtn.textContent = "Jump to present";
  }

  /** Puts `older` above what's shown without moving what the reader is
   * looking at. `appendMessage` only knows how to add to the bottom, so
   * the page is rendered there and then moved up. */
  function prependMessages(older: Message[]): void {
    const anchor = messageList.firstElementChild;
    if (older.length === 0 || !anchor) return;
    const saved = {
      author: state.lastRenderedAuthor,
      time: state.lastRenderedTime,
      day: state.lastRenderedDateKey,
    };
    const previousLast = messageList.lastElementChild;
    const heightBefore = messageList.scrollHeight;
    const topBefore = messageList.scrollTop;

    state.lastRenderedAuthor = null;
    state.lastRenderedTime = 0;
    state.lastRenderedDateKey = null;
    for (const message of older) appendMessage(message);

    const fresh: Element[] = [];
    for (let node = previousLast?.nextElementSibling; node; node = node.nextElementSibling) {
      fresh.push(node);
    }
    for (const node of fresh) messageList.insertBefore(node, anchor);
    // Where the pages meet on the same day there'd be two dividers for it;
    // the old first one is redundant now.
    if (
      anchor instanceof HTMLElement &&
      anchor.classList.contains("date-divider") &&
      anchor.dataset.day === dateKey(older[older.length - 1].created_at)
    ) {
      anchor.remove();
    }
    state.lastRenderedAuthor = saved.author;
    state.lastRenderedTime = saved.time;
    state.lastRenderedDateKey = saved.day;
    messageList.scrollTop = topBefore + (messageList.scrollHeight - heightBefore);
  }

  async function loadOlder(): Promise<void> {
    if (loadingHistory || !hasOlder || !state.activeChannel || oldestLoadedId === null) return;
    loadingHistory = true;
    const seq = loadMessagesSeq;
    const channelId = state.activeChannel.id;
    try {
      const page = await api.get<Message[]>(
        `/api/channels/${channelId}/messages?before=${oldestLoadedId}&limit=${HISTORY_PAGE}`,
      );
      if (seq !== loadMessagesSeq) return;
      hasOlder = page.length >= HISTORY_PAGE;
      prependMessages(page);
    } finally {
      loadingHistory = false;
    }
  }

  async function loadNewer(): Promise<void> {
    if (loadingHistory || !hasNewer || !state.activeChannel || newestLoadedId === null) return;
    loadingHistory = true;
    const seq = loadMessagesSeq;
    const channelId = state.activeChannel.id;
    try {
      const page = await api.get<Message[]>(
        `/api/channels/${channelId}/messages?after=${newestLoadedId}&limit=${HISTORY_PAGE}`,
      );
      if (seq !== loadMessagesSeq) return;
      hasNewer = page.length >= HISTORY_PAGE;
      for (const message of page) appendMessage(message);
      syncJumpToPresent();
    } finally {
      loadingHistory = false;
    }
  }

  messageList.addEventListener("scroll", () => {
    if (messageList.scrollTop < HISTORY_EDGE_PX) void loadOlder();
    const fromBottom = messageList.scrollHeight - messageList.scrollTop - messageList.clientHeight;
    if (hasNewer && fromBottom < HISTORY_EDGE_PX) void loadNewer();
  });
  jumpToPresentBtn.addEventListener("click", () => {
    if (state.activeChannel) void loadMessages(state.activeChannel.id);
  });

  async function loadMessages(channelId: string): Promise<void> {
    const seq = ++loadMessagesSeq;
    const jumpTo = pendingJump;
    pendingJump = null;
    messageList.replaceChildren();
    state.lastRenderedAuthor = null;
    state.lastRenderedTime = 0;
    state.lastRenderedDateKey = null;
    oldestLoadedId = null;
    newestLoadedId = null;
    loadingHistory = false;
    hasOlder = false;
    hasNewer = false;
    syncJumpToPresent();
    const messages = await api.get<Message[]>(
      jumpTo
        ? `/api/channels/${channelId}/messages?around=${jumpTo}&limit=${HISTORY_PAGE}`
        : `/api/channels/${channelId}/messages`,
    );
    if (seq !== loadMessagesSeq) return;
    if (messages.length === 0) {
      const empty = document.createElement("p");
      empty.className = "message-list-empty";
      empty.textContent = "No messages yet. Say hello!";
      messageList.appendChild(empty);
    } else {
      for (const message of messages) {
        appendMessage(message);
      }
    }
    if (jumpTo) {
      // A window around the target: history exists on both sides until a
      // fetch says otherwise.
      hasOlder = true;
      hasNewer = true;
      syncJumpToPresent();
      const target = messageList.querySelector<HTMLElement>(`[data-message-id="${jumpTo}"]`);
      if (target) {
        target.scrollIntoView({ block: "center" });
        target.classList.add("message-jump-highlight");
        target.addEventListener("animationend", () => target.classList.remove("message-jump-highlight"), {
          once: true,
        });
      }
    } else {
      hasOlder = messages.length >= HISTORY_PAGE;
      messageList.scrollTop = messageList.scrollHeight;
    }
  }

  return {
    get hasNewer() {
      return hasNewer;
    },
    set hasNewer(value: boolean) {
      hasNewer = value;
    },
    loadMessages,
    get pendingJump() {
      return pendingJump;
    },
    set pendingJump(value: string | null) {
      pendingJump = value;
    },
    trackLoadedRange,
  };
}

export type HistoryParts = ReturnType<typeof createHistory>;
