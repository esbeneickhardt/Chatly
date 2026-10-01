// Composing: attachments and uploads, the emoji and markdown pickers, @mention completion, and sending.

import { ApiError, type FileMeta, type User, api } from "../../api";
import { COMPOSER_EMOJI, renderEmojiPopover } from "../../emoji";
import { icon } from "../../icons";
import { renderMarkdownSnippetPopover } from "../../markdown-snippets";
import { renderAvatarEl } from "../../ui";
import { type ComposerDomParts } from "./composer-dom";
import { type PeopleParts } from "./people";
import type { ChatState } from "./state";

export interface PendingUpload {
  localId: string;
  file: File;
  error: string | null;
}

/** What this part of the chat screen needs from the rest of it. */
export interface createComposerActionsContext {
  composerDom: ComposerDomParts;
  people: PeopleParts;
  state: ChatState;
}

export function createComposerActions(ctx: createComposerActionsContext) {
  const { state } = ctx;
  const {
    attachBtn,
    composer,
    emojiBtn,
    exitPreviewMode,
    fileInput,
    markdownBtn,
    moreBtn,
    moreMenu,
    moreMenuItem,
    pendingAttachmentsBox,
    sendBtn,
    togglePreview,
  } = ctx.composerDom;
  const { clearReplyingTo } = ctx.people;

  let pendingUploads: PendingUpload[] = [];
  const progressEls = new Map<string, { fill: HTMLElement; percent: HTMLElement }>();

  function renderPendingAttachments(): void {
    progressEls.clear();
    if (pendingUploads.length === 0 && state.pendingAttachments.length === 0) {
      pendingAttachmentsBox.replaceChildren();
      return;
    }
    const uploadingChips = pendingUploads.map((u) => {
      const chip = document.createElement("span");
      chip.className = "attachment-chip attachment-chip-uploading";
      const label = document.createElement("span");
      label.className = "attachment-chip-label";
      label.append(icon("paperclip", 13), document.createTextNode(u.file.name));
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.appendChild(icon("x", 12));
      removeBtn.addEventListener("click", () => {
        // Doesn't abort the in-flight request (not worth the added
        // complexity for what's already a rare click) — just stops
        // this upload from turning into an attachment once it
        // finishes; see the `.then` below.
        pendingUploads = pendingUploads.filter((p) => p.localId !== u.localId);
        renderPendingAttachments();
      });
      chip.append(label, removeBtn);
      if (u.error) {
        chip.classList.add("attachment-chip-error");
        const errText = document.createElement("span");
        errText.className = "attachment-chip-error-text";
        errText.textContent = u.error;
        chip.appendChild(errText);
      } else {
        const bar = document.createElement("div");
        bar.className = "attachment-progress-bar";
        const fill = document.createElement("div");
        fill.className = "attachment-progress-bar-fill";
        bar.appendChild(fill);
        const percent = document.createElement("span");
        percent.className = "attachment-chip-percent";
        percent.textContent = "0%";
        chip.append(bar, percent);
        progressEls.set(u.localId, { fill, percent });
      }
      return chip;
    });
    const doneChips = state.pendingAttachments.map((file) => {
      const chip = document.createElement("span");
      chip.className = "attachment-chip";
      const label = document.createElement("span");
      label.append(icon("paperclip", 13), document.createTextNode(file.filename));
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.appendChild(icon("x", 12));
      removeBtn.addEventListener("click", () => {
        state.pendingAttachments = state.pendingAttachments.filter((f) => f.id !== file.id);
        renderPendingAttachments();
      });
      chip.append(label, removeBtn);
      return chip;
    });
    pendingAttachmentsBox.replaceChildren(...uploadingChips, ...doneChips);
  }

  function startUpload(file: File): void {
    const localId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    pendingUploads = [...pendingUploads, { localId, file, error: null }];
    renderPendingAttachments();

    void api
      .uploadWithProgress<FileMeta>("/api/uploads", file, (fraction) => {
        const els = progressEls.get(localId);
        if (!els) return;
        const percent = Math.round(fraction * 100);
        els.fill.style.width = `${percent}%`;
        els.percent.textContent = `${percent}%`;
      })
      .then((uploaded) => {
        // The user may have clicked the chip's "x" while this was
        // still in flight — don't resurrect it as a finished
        // attachment if so (the file did upload, it just becomes an
        // orphan on the server rather than a surprise attachment).
        if (!pendingUploads.some((p) => p.localId === localId)) return;
        pendingUploads = pendingUploads.filter((p) => p.localId !== localId);
        state.pendingAttachments = [...state.pendingAttachments, uploaded];
        renderPendingAttachments();
      })
      .catch((err) => {
        const upload = pendingUploads.find((p) => p.localId === localId);
        if (!upload) return;
        upload.error = err instanceof ApiError ? err.message : "Upload failed.";
        renderPendingAttachments();
      });
  }

  attachBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (!file) return;
    startUpload(file);
  });

  // Pasting an image (a screenshot, or one copied from a browser/image
  // editor) — or any other file copied from the OS file manager — into
  // the composer uploads it as an attachment exactly like picking it
  // via the paperclip button, instead of doing nothing or dumping raw
  // binary as garbled text. Plain text paste is left untouched.
  composer.addEventListener("paste", (event) => {
    const items = event.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (const item of items) {
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length === 0) return;
    event.preventDefault();
    for (const file of files) startUpload(file);
  });

  function openEmojiPicker(anchor: HTMLElement): void {
    renderEmojiPopover(anchor, COMPOSER_EMOJI, (emoji) => {
      composer.value += emoji;
      composer.focus();
    });
  }

  function openMarkdownSnippets(anchor: HTMLElement): void {
    renderMarkdownSnippetPopover(anchor, (snippet) => {
      const start = composer.selectionStart ?? composer.value.length;
      const end = composer.selectionEnd ?? composer.value.length;
      const selected = composer.value.slice(start, end);
      const { before, placeholder, after } = snippet.wrap(selected);
      const replacement = `${before}${placeholder}${after}`;
      composer.value = composer.value.slice(0, start) + replacement + composer.value.slice(end);
      composer.focus();
      composer.setSelectionRange(start + before.length, start + before.length + placeholder.length);
      composer.dispatchEvent(new Event("input"));
    });
  }

  emojiBtn.addEventListener("click", () => openEmojiPicker(emojiBtn));
  markdownBtn.addEventListener("click", () => openMarkdownSnippets(markdownBtn));
  moreMenu.append(
    moreMenuItem("paperclip", "Attach", () => fileInput.click()),
    moreMenuItem("smile", "Emoji", () => openEmojiPicker(moreBtn)),
    moreMenuItem("code", "Markdown", () => openMarkdownSnippets(moreBtn)),
    moreMenuItem("eye", "Preview", () => togglePreview()),
  );

  async function sendCurrentMessage(): Promise<void> {
    const content = composer.value.trim();
    if ((!content && state.pendingAttachments.length === 0) || !state.activeChannel) return;
    const attachmentIds = state.pendingAttachments.map((f) => f.id);
    const replyTo = state.replyingTo?.id;
    composer.value = "";
    composer.style.height = "auto";
    closeMentionPopover();
    state.pendingAttachments = [];
    renderPendingAttachments();
    clearReplyingTo();
    exitPreviewMode();
    try {
      await api.post(`/api/channels/${state.activeChannel.id}/messages`, {
        content,
        attachment_ids: attachmentIds,
        reply_to: replyTo,
      });
    } catch {
      composer.value = content;
    }
  }

  sendBtn.addEventListener("click", () => void sendCurrentMessage());

  let mentionMatches: User[] = [];
  let mentionStart = -1;

  function closeMentionPopover(): void {
    document.querySelector(".mention-popover")?.remove();
    mentionMatches = [];
    mentionStart = -1;
  }

  function pickMention(candidate: User): void {
    if (mentionStart < 0) return;
    const cursor = composer.selectionStart ?? composer.value.length;
    const before = composer.value.slice(0, mentionStart);
    const after = composer.value.slice(cursor);
    composer.value = `${before}@${candidate.username} ${after}`;
    const newPos = before.length + candidate.username.length + 2;
    closeMentionPopover();
    composer.focus();
    composer.setSelectionRange(newPos, newPos);
  }

  function updateMentionPopover(): void {
    closeMentionPopover();
    const cursor = composer.selectionStart ?? composer.value.length;
    const uptoCursor = composer.value.slice(0, cursor);
    const match = /(?:^|\s)@([a-zA-Z0-9_-]{0,32})$/.exec(uptoCursor);
    if (!match) return;

    const query = match[1].toLowerCase();
    const matches = state.mentionCandidates
      .filter(
        (u) => u.username.toLowerCase().startsWith(query) || u.display_name.toLowerCase().startsWith(query),
      )
      .slice(0, 8);
    if (matches.length === 0) return;

    mentionMatches = matches;
    mentionStart = cursor - query.length - 1;

    const popover = document.createElement("div");
    popover.className = "mention-popover";
    for (const candidate of matches) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "user-search-row";
      row.append(
        renderAvatarEl(candidate.display_name, candidate.avatar_file_id),
        (() => {
          const identity = document.createElement("div");
          identity.className = "identity";
          const name = document.createElement("div");
          name.className = "name";
          name.textContent = candidate.display_name;
          const uname = document.createElement("div");
          uname.className = "username";
          uname.textContent = `@${candidate.username}`;
          identity.append(name, uname);
          return identity;
        })(),
      );
      row.addEventListener("click", () => pickMention(candidate));
      popover.appendChild(row);
    }
    document.body.appendChild(popover);
    const rect = composer.getBoundingClientRect();
    popover.style.left = `${rect.left}px`;
    popover.style.top = `${rect.top - popover.offsetHeight - 8}px`;
    popover.style.width = `${Math.min(rect.width, 320)}px`;
  }

  return {
    closeMentionPopover,
    get mentionMatches() {
      return mentionMatches;
    },
    set mentionMatches(value: User[]) {
      mentionMatches = value;
    },
    pickMention,
    sendCurrentMessage,
    updateMentionPopover,
  };
}

export type ComposerActionsParts = ReturnType<typeof createComposerActions>;
