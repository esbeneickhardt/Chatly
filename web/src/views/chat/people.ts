// People and replies: the message being replied to, everyone the screen has seen so far, and who is online.

import { type FileMeta, type Message, type User } from "../../api";
import { icon } from "../../icons";
import { renderInline } from "../../markdown";
import { type ComposerDomParts } from "./composer-dom";
import { type SidebarParts } from "./sidebar";
import type { ChatState } from "./state";

/** What this part of the chat screen needs from the rest of it. */
export interface createPeopleContext {
  sidebarParts: SidebarParts;
  composerDom: ComposerDomParts;
  state: ChatState;
  user: User;
  readonly flattenForReplyPreview: (content: string) => string;
  readonly renderReplyAttachmentChip: (file: FileMeta, extraCount: number) => HTMLElement;
}

export function createPeople(ctx: createPeopleContext) {
  const { state, user } = ctx;
  const { channelList } = ctx.sidebarParts;
  const { composer, replyBanner } = ctx.composerDom;

  function setReplyingTo(message: Message): void {
    state.replyingTo = message;
    const label = document.createElement("span");
    label.className = "reply-banner-text";
    const who = document.createElement("span");
    who.className = "reply-banner-who";
    who.textContent = `Replying to ${message.author_display_name}`;
    label.append(icon("reply", 13), who);

    // Same reasoning as `renderReplyPreview`'s `flattenForReplyPreview`
    // (see there): the full block renderer routinely pushed this
    // banner's actual text below its own clipped one-line height,
    // rendering blank for anything but a plain one-line message — and,
    // separately, this used to show *nothing at all* here for a reply
    // to an image/file-only message, since there was no fallback once
    // `message.content` was empty.
    const previewChildren: Node[] = [];
    if (message.attachments.length > 0) {
      previewChildren.push(
        ctx.renderReplyAttachmentChip(message.attachments[0], message.attachments.length - 1),
      );
    }
    const flattened = message.content ? ctx.flattenForReplyPreview(message.content) : "";
    if (flattened) {
      const textEl = document.createElement("span");
      textEl.className = "reply-banner-preview-text";
      renderInline(flattened, textEl);
      previewChildren.push(textEl);
    }
    if (previewChildren.length > 0) {
      const preview = document.createElement("div");
      preview.className = "reply-banner-preview";
      preview.append(...previewChildren);
      label.appendChild(preview);
    }
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "icon-button";
    cancelBtn.appendChild(icon("x", 13));
    cancelBtn.addEventListener("click", clearReplyingTo);
    replyBanner.replaceChildren(label, cancelBtn);
    replyBanner.hidden = false;
    composer.focus();
  }

  function clearReplyingTo(): void {
    state.replyingTo = null;
    replyBanner.hidden = true;
    replyBanner.replaceChildren();
  }
  const voiceParticipants: Map<string, Set<string>> = new Map();
  /** Every user we've ever learned about (DM participants, guild
   * members), keyed by id — unlike `mentionCandidates` (scoped to
   * whichever channel/DM is currently *being viewed*), this is used
   * for resolving a voice/video participant's name, since a call
   * keeps running after you navigate away from the DM or channel it
   * started in and `mentionCandidates` would otherwise have moved on
   * to whatever you're looking at now. */
  const knownUsers: Map<string, User> = new Map([[user.id, user]]);
  function rememberUsers(users: Iterable<User>): void {
    for (const u of users) knownUsers.set(u.id, u);
  }
  for (const dm of state.dms) rememberUsers(dm.participants);

  /** Everyone with a live gateway connection right now, instance-wide
   * (see `gateway.ts`'s `ReadyData`/`PresenceUpdate`) — seeded from
   * `ready` and kept live via `presence_update`. */
  function setUserOnline(userId: string, online: boolean): void {
    if (online) state.onlineUserIds.add(userId);
    else state.onlineUserIds.delete(userId);
    // Patched directly rather than re-rendering the DM list — a
    // presence change is common enough (anyone signing in/out) that
    // refetching+rebuilding the whole list for it would be wasteful,
    // and would also fight with whatever the user's doing there
    // (scrolled position, an open menu) far more often than a pin or
    // a new message would.
    const dots = channelList.querySelectorAll<HTMLElement>(`.status-dot[data-user-id="${userId}"]`);
    for (const dot of dots) dot.hidden = !online;
  }

  return {
    clearReplyingTo,
    knownUsers,
    rememberUsers,
    setReplyingTo,
    setUserOnline,
    voiceParticipants,
  };
}

export type PeopleParts = ReturnType<typeof createPeople>;
