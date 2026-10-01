// Rendering a message: its body, reactions, reply quote, edit box and action menu; appending, updating and removing rows in the message list.

import { ApiError, type FileMeta, type Message, type User, api } from "../../api";
import { REACTION_EMOJI, renderEmojiPopover } from "../../emoji";
import { friendlyFileLabel } from "../../file-labels";
import { icon } from "../../icons";
import { renderInline, renderMarkdown } from "../../markdown";
import { renderAvatarEl } from "../../ui";
import { GROUP_WINDOW_MS, dateKey, formatDayDivider, renderAttachments } from "../chat/helpers";
import { type ComposerDomParts } from "./composer-dom";
import type { ChatState } from "./state";

/** What this part of the chat screen needs from the rest of it. */
export interface createMessagesContext {
  composerDom: ComposerDomParts;
  state: ChatState;
  user: User;
  loadMessages: (channelId: string) => Promise<void>;
  mentionUsernamesFor: (message: Message) => Set<string>;
  setReplyingTo: (message: Message) => void;
  trackLoadedRange: (id: string) => void;
  pendingJump: string | null;
}

export function createMessages(ctx: createMessagesContext) {
  const { state, user, loadMessages, mentionUsernamesFor, setReplyingTo, trackLoadedRange } = ctx;
  const { messageList } = ctx.composerDom;

  // Only renders existing reaction pills — adding a new one lives in
  // the "..." menu now (see renderMoreMenu), so a message with no
  // reactions yet doesn't need a permanent "+" row taking up space.
  function renderReactions(message: Message): HTMLElement | null {
    if (message.reactions.length === 0) return null;

    const row = document.createElement("div");
    row.className = "reactions-row";

    for (const reaction of message.reactions) {
      const pill = document.createElement("button");
      pill.type = "button";
      pill.className = `reaction-pill${reaction.reacted_by_me ? " mine" : ""}`;
      pill.textContent = `${reaction.emoji} ${reaction.count}`;
      pill.addEventListener("click", async () => {
        const encoded = encodeURIComponent(reaction.emoji);
        if (reaction.reacted_by_me) {
          await api.del(`/api/messages/${message.id}/reactions/${encoded}`);
        } else {
          await api.post(`/api/messages/${message.id}/reactions/${encoded}`);
        }
      });
      row.appendChild(pill);
    }

    return row;
  }

  const EDIT_WINDOW_MS = 5 * 60 * 1000;

  function canEditMessage(message: Message): boolean {
    return message.author_id === user.id && Date.now() - message.created_at <= EDIT_WINDOW_MS;
  }

  function canDeleteMessage(message: Message): boolean {
    return message.author_id === user.id || Boolean(state.activeChannel?.can_moderate);
  }

  /** Collapses possibly-multi-line, possibly-block markdown into a
   * single line safe to hand to `renderInline` — shared by this
   * message-list reply quote and the composer's "Replying to" banner.
   * Rendering the *full* block-aware renderer (fenced code, math,
   * tables — each producing block elements with their own margin/
   * padding) into either's clipped one-line-tall container routinely
   * pushed the actual text below the visible area entirely, rendering
   * as blank for anything but a plain one-line message — confirmed
   * live, not just a theoretical concern. A reply preview is a label,
   * not a full re-render of the original, so bare fence-marker lines
   * are dropped outright (their *content* still shows, just not
   * block-styled) and everything else is joined onto one line. */
  function flattenForReplyPreview(content: string): string {
    return content
      .split("\n")
      .filter((line) => !/^```/.test(line.trim()))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }

  /** A compact "thumbnail (or file icon) + filename" chip for a reply
   * quote/banner whose original message had an attachment — the same
   * summary Discord/Slack/Teams all show instead of a bare
   * "(attachment)" label with no idea what it actually was. `extraCount`
   * (if any) becomes a "+N more" suffix for a multi-attachment original,
   * rather than silently showing only the first and dropping the rest. */
  function renderReplyAttachmentChip(file: FileMeta, extraCount: number): HTMLElement {
    const chip = document.createElement("span");
    chip.className = "reply-attachment-chip";
    if (file.mime.startsWith("image/")) {
      const img = document.createElement("img");
      img.className = "reply-attachment-thumb";
      img.src = `/api/files/${file.id}`;
      img.alt = file.filename;
      img.loading = "lazy";
      chip.appendChild(img);
    } else {
      chip.appendChild(icon("paperclip", 12));
    }
    const name = document.createElement("span");
    name.className = "reply-attachment-filename";
    const shown = friendlyFileLabel(file.filename, file.mime);
    name.textContent = extraCount > 0 ? `${shown} +${extraCount} more` : shown;
    // The real name is never lost — a generated-looking one is swapped
    // for a plain label above, and stays available on hover.
    chip.title = file.filename;
    chip.appendChild(name);
    return chip;
  }

  function renderReplyPreview(message: Message): HTMLElement | null {
    if (!message.reply_preview) return null;
    const preview = message.reply_preview;
    const quote = document.createElement("div");
    quote.className = "reply-quote";
    quote.appendChild(icon("reply", 12));
    if (message.reply_to) {
      // Clicking the quote jumps to (and briefly highlights) the
      // original message if it's already loaded in this channel's
      // scrollback — the one thing a quote like this is *for*, not
      // just a label of who said it.
      quote.classList.add("reply-quote-link");
      quote.title = "Jump to message";
      const replyTarget = message.reply_to;
      quote.addEventListener("click", () => jumpToMessage(replyTarget));
    }
    const author = document.createElement("span");
    author.className = "reply-quote-author";
    author.textContent = preview.author_display_name;
    quote.appendChild(author);

    if (preview.first_attachment) {
      quote.appendChild(renderReplyAttachmentChip(preview.first_attachment, preview.attachment_count - 1));
    }

    const flattened = preview.content ? flattenForReplyPreview(preview.content) : "";
    if (flattened) {
      const text = document.createElement("div");
      text.className = "reply-quote-text";
      renderInline(flattened, text);
      quote.appendChild(text);
    } else if (!preview.first_attachment) {
      // Only reachable if the original message somehow has neither
      // text nor an attachment — every real message has at least one,
      // so this is a defensive label, not an expected path.
      const text = document.createElement("div");
      text.className = "reply-quote-text";
      text.textContent = "(message)";
      quote.appendChild(text);
    }
    return quote;
  }

  /** Scrolls to and briefly highlights `messageId` if it's currently
   * loaded in the message list — a reply quote (see
   * `renderReplyPreview`) is otherwise just inert text with no way to
   * actually go look at what it's quoting. A no-op, not an error, if
   * the original message isn't loaded, it loads the history around it. */
  function jumpToMessage(messageId: string): void {
    const target = messageList.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`);
    if (!target) {
      // Not in the loaded window (older than what's been scrolled to):
      // load the history around it instead of doing nothing.
      if (state.activeChannel) {
        ctx.pendingJump = messageId;
        void loadMessages(state.activeChannel.id);
      }
      return;
    }
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.classList.add("message-jump-highlight");
    target.addEventListener("animationend", () => target.classList.remove("message-jump-highlight"), {
      once: true,
    });
  }

  function startEditingMessage(item: HTMLElement, message: Message): void {
    const line = item.querySelector(".message-line");
    const original = message.content;

    const editWrap = document.createElement("div");
    editWrap.className = "message-edit-wrap";
    const textarea = document.createElement("textarea");
    textarea.value = original;
    textarea.rows = 1;
    const actions = document.createElement("div");
    actions.className = "message-edit-actions";
    const hint = document.createElement("span");
    hint.className = "muted-text";
    hint.textContent = "escape to cancel • enter to save";
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "secondary";
    cancelBtn.textContent = "Cancel";
    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.textContent = "Save";
    actions.append(hint, cancelBtn, saveBtn);
    editWrap.append(textarea, actions);

    const target = line ?? item;
    target.replaceWith(editWrap);
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    textarea.addEventListener("input", () => {
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    });

    function cancel(): void {
      editWrap.replaceWith(...(line ? [line] : []));
    }

    async function save(): Promise<void> {
      const content = textarea.value.trim();
      if (!content || content === original) {
        cancel();
        return;
      }
      saveBtn.disabled = true;
      try {
        await api.patch(`/api/messages/${message.id}`, { content });
        // The gateway's MESSAGE_UPDATE echo rebuilds this item entirely.
      } catch (err) {
        alert(err instanceof ApiError ? err.message : "Couldn't save that edit.");
        saveBtn.disabled = false;
      }
    }

    cancelBtn.addEventListener("click", cancel);
    saveBtn.addEventListener("click", () => void save());
    textarea.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        cancel();
      } else if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        void save();
      }
    });
  }

  function buildMessageItem(message: Message): HTMLElement {
    const item = document.createElement("div");
    item.className = "message-item";
    item.dataset.messageId = message.id;

    const replyPreview = renderReplyPreview(message);
    if (replyPreview) item.appendChild(replyPreview);

    if (message.content) {
      const line = document.createElement("div");
      line.className = "message-line";
      line.appendChild(renderMarkdown(message.content, mentionUsernamesFor(message)));
      if (message.edited_at) {
        const edited = document.createElement("span");
        edited.className = "message-edited-marker";
        edited.textContent = " (edited)";
        line.appendChild(edited);
      }
      item.appendChild(line);
    }

    if (message.attachments.length > 0) {
      item.appendChild(renderAttachments(message.attachments));
    }

    const reactions = renderReactions(message);
    if (reactions) item.appendChild(reactions);

    const actions = document.createElement("div");
    actions.className = "message-actions";

    const replyBtn = document.createElement("button");
    replyBtn.type = "button";
    replyBtn.className = "icon-button message-action-btn";
    replyBtn.title = "Reply";
    replyBtn.appendChild(icon("reply", 14));
    replyBtn.addEventListener("click", () => setReplyingTo(message));
    actions.appendChild(replyBtn);

    if (canEditMessage(message)) {
      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "icon-button message-action-btn";
      editBtn.title = "Edit";
      editBtn.appendChild(icon("edit", 14));
      editBtn.addEventListener("click", () => startEditingMessage(item, message));
      actions.appendChild(editBtn);
    }

    const moreBtn = document.createElement("button");
    moreBtn.type = "button";
    moreBtn.className = "icon-button message-action-btn";
    moreBtn.title = "More";
    moreBtn.appendChild(icon("more-horizontal", 14));
    moreBtn.addEventListener("click", () => renderMoreMenu(moreBtn, message));
    actions.appendChild(moreBtn);

    item.appendChild(actions);

    return item;
  }

  // Less-frequent (and the one destructive) message actions live behind
  // "more" instead of as permanently-visible hover icons — mirrors how
  // Discord tucks Delete behind "..." rather than showing it up front.
  function renderMoreMenu(anchor: HTMLElement, message: Message): void {
    const existing = document.querySelector(".message-more-menu");
    if (existing) {
      existing.remove();
      return;
    }

    const menu = document.createElement("div");
    menu.className = "message-more-menu";

    const reactBtn = document.createElement("button");
    reactBtn.type = "button";
    reactBtn.className = "message-more-option";
    reactBtn.append(icon("smile", 14), document.createTextNode("Add reaction"));
    reactBtn.addEventListener("click", () => {
      menu.remove();
      renderEmojiPopover(anchor, REACTION_EMOJI, async (emoji) => {
        await api.post(`/api/messages/${message.id}/reactions/${encodeURIComponent(emoji)}`);
      });
    });
    menu.appendChild(reactBtn);

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "message-more-option";
    copyBtn.append(icon("copy", 14), document.createTextNode("Copy text"));
    copyBtn.addEventListener("click", async () => {
      menu.remove();
      try {
        await navigator.clipboard.writeText(message.content);
      } catch {
        /* clipboard permission denied; nothing else to fall back to here */
      }
    });
    menu.appendChild(copyBtn);

    if (canDeleteMessage(message)) {
      const divider = document.createElement("div");
      divider.className = "message-more-divider";
      menu.appendChild(divider);

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "message-more-option danger";
      deleteBtn.append(icon("trash", 14), document.createTextNode("Delete message"));
      deleteBtn.addEventListener("click", async () => {
        menu.remove();
        if (!confirm("Delete this message?")) return;
        try {
          await api.del(`/api/messages/${message.id}`);
        } catch (err) {
          alert(err instanceof ApiError ? err.message : "Couldn't delete that message.");
        }
      });
      menu.appendChild(deleteBtn);
    }

    document.body.appendChild(menu);
    const rect = anchor.getBoundingClientRect();
    menu.style.left = `${rect.right - menu.offsetWidth}px`;
    menu.style.top = `${rect.bottom + 4}px`;
  }

  function appendMessage(message: Message, scrollIntoView = false): void {
    messageList.querySelector(".message-list-empty")?.remove();

    const dayKey = dateKey(message.created_at);
    const isNewDay = dayKey !== state.lastRenderedDateKey;
    if (isNewDay) {
      const divider = document.createElement("div");
      divider.className = "date-divider";
      divider.textContent = formatDayDivider(message.created_at);
      divider.dataset.day = dayKey;
      messageList.appendChild(divider);
      state.lastRenderedDateKey = dayKey;
    }

    const isNewGroup =
      isNewDay ||
      message.author_id !== state.lastRenderedAuthor ||
      message.created_at - state.lastRenderedTime > GROUP_WINDOW_MS;

    if (isNewGroup) {
      const group = document.createElement("div");
      group.className = "message-group";

      const avatar = renderAvatarEl(message.author_display_name, message.author_avatar_file_id);

      const body = document.createElement("div");
      body.className = "message-group-body";

      const authorLine = document.createElement("div");
      authorLine.className = "message-author-line";
      const author = document.createElement("span");
      author.className = "message-author";
      author.textContent = message.author_display_name;
      const time = document.createElement("span");
      time.className = "message-timestamp";
      time.textContent = new Date(message.created_at).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
      authorLine.append(author, time);

      body.append(authorLine, buildMessageItem(message));
      group.append(avatar, body);
      messageList.appendChild(group);
    } else {
      messageList.lastElementChild
        ?.querySelector(".message-group-body")
        ?.appendChild(buildMessageItem(message));
    }

    state.lastRenderedAuthor = message.author_id;
    state.lastRenderedTime = message.created_at;
    trackLoadedRange(message.id);

    if (scrollIntoView) {
      messageList.scrollTop = messageList.scrollHeight;
    }
  }

  function updateMessage(message: Message): void {
    const existing = messageList.querySelector(`[data-message-id="${message.id}"]`);
    existing?.replaceWith(buildMessageItem(message));
  }

  function removeMessage(messageId: string): void {
    const item = messageList.querySelector(`[data-message-id="${messageId}"]`);
    const group = item?.closest(".message-group");
    item?.remove();
    if (group && group.querySelectorAll(".message-item").length === 0) {
      group.remove();
    }
    if (messageList.children.length === 0) {
      const empty = document.createElement("p");
      empty.className = "message-list-empty";
      empty.textContent = "No messages yet. Say hello!";
      messageList.appendChild(empty);
    }
  }

  return {
    appendMessage,
    flattenForReplyPreview,
    removeMessage,
    renderReplyAttachmentChip,
    updateMessage,
  };
}

export type MessagesParts = ReturnType<typeof createMessages>;
