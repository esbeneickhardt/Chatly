// Wiring the composer keys and the live message events (new, edited, deleted messages; voice state) to what they should do.

import { type User } from "../../api";
import { loadAudioPrefs } from "../../audio-prefs";
import { type VoiceStateUpdate } from "../../gateway";
import { playNotificationSound } from "../../notification-sound";
import { notify } from "../../notifications";
import { type ComposerActionsParts } from "./composer-actions";
import { type ComposerDomParts } from "./composer-dom";
import { type DirectMessagesParts } from "./direct-messages";
import { type MessagesParts } from "./messages";
import { type VoiceControlsParts } from "./voice-controls";
import type { ChatState } from "./state";

/** What this part of the chat screen needs from the rest of it. */
export interface wireLiveContext {
  messages: MessagesParts;
  directMessages: DirectMessagesParts;
  composerActions: ComposerActionsParts;
  composerDom: ComposerDomParts;
  voiceControls: VoiceControlsParts;
  history: {
    hasNewer: boolean;
    loadMessages: (channelId: string) => Promise<void>;
    pendingJump: string | null;
    trackLoadedRange: (id: string) => void;
  };
  state: ChatState;
  user: User;
  readonly handleVoiceStateUpdate: (data: VoiceStateUpdate) => void;
}

export function wireLive(ctx: wireLiveContext) {
  const { history, state, user, composerActions } = ctx;
  const { appendMessage, removeMessage, updateMessage } = ctx.messages;
  const { channelLabelFor } = ctx.directMessages;
  const { closeMentionPopover, pickMention, sendCurrentMessage, updateMentionPopover } = ctx.composerActions;
  const { composer, jumpToPresentBtn } = ctx.composerDom;
  const { gateway } = ctx.voiceControls;

  composer.addEventListener("keydown", (event) => {
    if (composerActions.mentionMatches.length > 0 && (event.key === "Enter" || event.key === "Tab")) {
      event.preventDefault();
      pickMention(composerActions.mentionMatches[0]);
      return;
    }
    if (event.key === "Escape" && composerActions.mentionMatches.length > 0) {
      closeMentionPopover();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendCurrentMessage();
    }
  });

  composer.addEventListener("input", () => {
    composer.style.height = "auto";
    composer.style.height = `${Math.min(composer.scrollHeight, 200)}px`;
    updateMentionPopover();
  });

  gateway.on("message_create", (message) => {
    const isActive = Boolean(state.activeChannel && message.channel_id === state.activeChannel.id);
    if (isActive && !history.hasNewer) {
      appendMessage(message, true);
    } else if (isActive) {
      // Viewing an older window: appending would leave a gap. The button
      // brings you back to the present, where this message is.
      jumpToPresentBtn.textContent = "New messages — jump to present";
    }
    const isMention = message.mentions.includes(user.id);
    if (
      message.author_id !== user.id &&
      (isMention || !isActive) &&
      loadAudioPrefs().notificationSoundsEnabled
    ) {
      playNotificationSound();
    }
    // Background notification (only shown if enabled in Settings and the
    // page isn't in front): every direct message, and mentions elsewhere.
    if (message.author_id !== user.id) {
      const inDm = state.dms.some((d) => d.channel.id === message.channel_id);
      if (inDm || isMention) {
        const where = channelLabelFor(message.channel_id);
        void notify({
          title: inDm ? message.author_display_name : `${message.author_display_name} in ${where}`,
          body: message.content.replace(/\s+/g, " ").slice(0, 140) || "Sent an attachment",
          tag: message.channel_id,
          data: { channelId: message.channel_id },
        });
      }
    }
  });
  gateway.on("message_update", (message) => {
    if (state.activeChannel && message.channel_id === state.activeChannel.id) {
      updateMessage(message);
    }
  });
  gateway.on("message_delete", (data) => {
    if (state.activeChannel && data.channel_id === state.activeChannel.id) {
      removeMessage(data.message_id);
    }
  });
  // Resolves once the DM list is known to be current. A `voice_state_update`
  // for a DM you were *just* added to arrives moments after the
  // `dm_channel_create` that introduces that DM — without waiting for
  // the refetch that event kicks off, the call event finds no such DM
  // and is dropped as "not a channel we know", so nobody who gets
  // added to a call in progress is ever rung.

  gateway.on("voice_state_update", (data) => {
    void state.dmsSync.then(() => ctx.handleVoiceStateUpdate(data));
  });
}
