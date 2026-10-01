// The message list and the composer: the text box, attach/emoji/markdown/
// preview buttons, the send button, the "more" menu, the reply banner and
// the "jump to present" button.

import { type User } from "../../api";
import { icon } from "../../icons";
import { renderMarkdown } from "../../markdown";

/** What this part of the chat screen needs from the rest of it. */
export interface createComposerDomContext {
  readonly mentionCandidates: User[];
}

export function createComposerDom(ctx: createComposerDomContext) {
  const messageList = document.createElement("div");
  messageList.className = "message-list";
  // A live log: a screen reader announces messages as they arrive, but
  // not the whole list being rebuilt when you switch conversations.
  messageList.setAttribute("role", "log");
  messageList.setAttribute("aria-label", "Messages");
  messageList.setAttribute("aria-relevant", "additions");

  const attachBtn = document.createElement("button");
  attachBtn.type = "button";
  attachBtn.className = "icon-button composer-icon-button";
  attachBtn.appendChild(icon("paperclip", 18));
  attachBtn.title = "Attach a file";

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.hidden = true;

  const emojiBtn = document.createElement("button");
  emojiBtn.type = "button";
  emojiBtn.className = "icon-button composer-icon-button";
  emojiBtn.appendChild(icon("smile", 18));
  emojiBtn.title = "Emoji";

  const markdownBtn = document.createElement("button");
  markdownBtn.type = "button";
  markdownBtn.className = "icon-button composer-icon-button";
  markdownBtn.appendChild(icon("code", 18));
  markdownBtn.title = "Formatting snippets";

  const previewBtn = document.createElement("button");
  previewBtn.type = "button";
  previewBtn.className = "icon-button composer-icon-button";
  previewBtn.appendChild(icon("eye", 18));
  previewBtn.title = "Preview formatting";

  const composer = document.createElement("textarea");
  composer.setAttribute("aria-label", "Message");
  composer.placeholder = "Message #general";
  composer.rows = 1;

  const composerPreview = document.createElement("div");
  composerPreview.className = "composer-preview";
  composerPreview.hidden = true;

  function togglePreview(): void {
    const showingPreview = !composerPreview.hidden;
    if (showingPreview) {
      composerPreview.hidden = true;
      composer.hidden = false;
      previewBtn.classList.remove("active");
      composer.focus();
    } else {
      composerPreview.replaceChildren(
        composer.value.trim()
          ? renderMarkdown(composer.value, mentionUsernamesSet())
          : document.createTextNode("Nothing to preview yet."),
      );
      composer.hidden = true;
      composerPreview.hidden = false;
      previewBtn.classList.add("active");
    }
  }
  previewBtn.addEventListener("click", togglePreview);

  function exitPreviewMode(): void {
    if (!composerPreview.hidden) togglePreview();
  }

  function mentionUsernamesSet(): Set<string> {
    return new Set(ctx.mentionCandidates.map((m) => m.username.toLowerCase()));
  }

  const sendBtn = document.createElement("button");
  sendBtn.type = "button";
  sendBtn.className = "send-button";
  const sendBtnLabel = document.createElement("span");
  sendBtnLabel.className = "send-button-label";
  sendBtnLabel.textContent = "Send";
  sendBtn.append(icon("send", 16), sendBtnLabel);

  // Mobile only (see CSS): the four icon buttons above are hidden and
  // replaced by this one round "+" that opens a compact popover with
  // the same four actions — a phone-width composer can't fit five
  // separate controls plus an input and a send button in one row
  // without squeezing the input to a sliver, so instead of cramming
  // everything in, only one extra tap moves behind a single button
  // (the same "+" tray pattern Messenger and Planly's own mobile chat
  // use). Reuses the exact same handlers as the desktop buttons —
  // `openEmojiPicker`/`openMarkdownSnippets` just take the anchor
  // element as a parameter so the popover can point at `moreBtn`
  // instead of a hidden (and therefore position-less) desktop button.
  const moreBtn = document.createElement("button");
  moreBtn.type = "button";
  moreBtn.className = "icon-button composer-more-btn";
  moreBtn.title = "More options";
  moreBtn.appendChild(icon("plus", 20));

  const moreMenu = document.createElement("div");
  moreMenu.className = "composer-more-menu";
  moreMenu.hidden = true;

  function moreMenuItem(
    name: Parameters<typeof icon>[0],
    label: string,
    onClick: () => void,
  ): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "composer-more-item";
    const iconWrap = document.createElement("span");
    iconWrap.className = "composer-more-item-icon";
    iconWrap.appendChild(icon(name, 20));
    const labelEl = document.createElement("span");
    labelEl.textContent = label;
    btn.append(iconWrap, labelEl);
    btn.addEventListener("click", () => {
      moreMenu.hidden = true;
      onClick();
    });
    return btn;
  }

  moreBtn.addEventListener("click", () => {
    moreMenu.hidden = !moreMenu.hidden;
  });
  document.addEventListener("click", (e) => {
    const target = e.target as Node;
    if (!moreMenu.hidden && !moreMenu.contains(target) && !moreBtn.contains(target)) {
      moreMenu.hidden = true;
    }
  });

  const composerBox = document.createElement("div");
  composerBox.className = "composer";
  composerBox.append(
    attachBtn,
    fileInput,
    emojiBtn,
    markdownBtn,
    previewBtn,
    moreBtn,
    moreMenu,
    composer,
    composerPreview,
    sendBtn,
  );

  const pendingAttachmentsBox = document.createElement("div");

  const replyBanner = document.createElement("div");
  replyBanner.className = "reply-banner";
  replyBanner.hidden = true;

  const composerWrap = document.createElement("div");
  composerWrap.className = "composer-wrap";
  composerWrap.append(replyBanner, pendingAttachmentsBox, composerBox);

  // Video and chat side by side (Twitch/YouTube-style) rather than
  // stacked, so a call's video never has to fight the message list
  // for vertical space — the old stacked layout let one real,
  // full-resolution video tile grow taller than the space above the
  // chat could give it, which either clipped it (only the top half
  // visible, the rest needing a scroll no one would think to try) or
  // squeezed the message list down to a sliver. Side by side, video's
  // height is simply "the full column height," never negotiated
  // against chat content.
  const chatColumn = document.createElement("div");
  chatColumn.className = "chat-column";
  const jumpToPresentBtn = document.createElement("button");

  return {
    attachBtn,
    chatColumn,
    composer,
    composerWrap,
    emojiBtn,
    exitPreviewMode,
    fileInput,
    jumpToPresentBtn,
    markdownBtn,
    messageList,
    moreBtn,
    moreMenu,
    moreMenuItem,
    pendingAttachmentsBox,
    replyBanner,
    sendBtn,
    togglePreview,
  };
}

export type ComposerDomParts = ReturnType<typeof createComposerDom>;
