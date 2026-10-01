// Direct messages: the DM call (ringing, stage, incoming card), DM labels and avatars, selecting a conversation, opening a message, and the entry points into search.

import { type DmSummary, type Message, type User } from "../../api";
import { onNotificationClick } from "../../notifications";
import { renderAvatarEl } from "../../ui";
import { createDmCall } from "../dm-call";
import { type SearchScopeOption, openSearchPanel } from "../search";
import { type ChannelsParts } from "./channels";
import { type ComposerDomParts } from "./composer-dom";
import { type HeaderParts } from "./header";
import { type HistoryParts } from "./history";
import { type PanesParts } from "./panes";
import { type PeopleParts } from "./people";
import { type StageDomParts } from "./stage-dom";
import { type VoiceControlsParts } from "./voice-controls";
import type { ChatState } from "./state";

/** What this part of the chat screen needs from the rest of it. */
export interface createDirectMessagesContext {
  headerParts: HeaderParts;
  people: PeopleParts;
  composerDom: ComposerDomParts;
  stageDom: StageDomParts;
  voiceControls: VoiceControlsParts;
  history: HistoryParts;
  panes: PanesParts;
  channels: ChannelsParts;
  state: ChatState;
  user: User;
  switchToHome: () => Promise<void>;
}

export function createDirectMessages(ctx: createDirectMessagesContext) {
  const { state, user, switchToHome, history, voiceControls } = ctx;
  const { channelHeader, channelHeaderLabel, dmCallBtn, dmOptionsBtn, videoTilesPanel } = ctx.headerParts;
  const { clearReplyingTo, knownUsers, rememberUsers, voiceParticipants } = ctx.people;
  const { composer, exitPreviewMode } = ctx.composerDom;
  const {
    dmCallControlPill,
    dmCallParticipants,
    dmCallStage,
    dmCallStageHandle,
    dmCallStatus,
    stageCameraBtn,
    stageDeafenBtn,
    stageHangupBtn,
    stageJoinBtn,
    stageMuteBtn,
    stageScreenBtn,
  } = ctx.stageDom;
  const {
    handleLeaveVoice,
    handleToggleCamera,
    handleToggleDeafen,
    handleToggleMute,
    handleToggleScreen,
    voiceClient,
  } = ctx.voiceControls;
  const { loadMessages } = ctx.history;
  const { mainColumn } = ctx.panes;
  const { confirmSwitchCall, markActiveChannelItem, selectChannel, toggleVoiceChannel, updateDmCallBtn } =
    ctx.channels;

  const dmCall = createDmCall({
    user,
    channelHeader,
    dmCallBtn,
    dmCallControlPill,
    dmCallParticipants,
    dmCallStage,
    dmCallStageHandle,
    dmCallStatus,
    dmLabel,
    handleLeaveVoice,
    handleToggleCamera,
    handleToggleDeafen,
    handleToggleMute,
    handleToggleScreen,
    isSelfDm,
    knownUsers,
    mainColumn,
    selectDm,
    stageCameraBtn,
    stageDeafenBtn,
    stageHangupBtn,
    stageJoinBtn,
    stageMuteBtn,
    stageScreenBtn,
    switchToHome,
    toggleVoiceChannel,
    confirmSwitchCall,
    videoTilesPanel,
    voiceClient,
    voiceParticipants,
    get activeChannel() {
      return state.activeChannel;
    },
    get activeDm() {
      return state.activeDm;
    },
    get chatHidden() {
      return voiceControls.chatHidden;
    },
    get dms() {
      return state.dms;
    },
  });
  const {
    callDeclined,
    dismissIncomingCallFor,
    dismissIncomingCallIfFrom,
    renderDmCallStage,
    ringTimedOut,
    setStageSpeaking,
    showIncomingCall,
    stageSpeaking,
    startOutgoingRing,
    stopOutgoingRing,
  } = dmCall;

  /** A real group conversation — several other people, not a 1:1 or
   * your private chat. */
  function isGroupDm(dm: DmSummary): boolean {
    return !isSelfDm(dm) && dm.participants.length > 1;
  }

  /** `participants` never includes you (except in your own private
   * chat), so the group's size is one more than that. */
  function groupMemberCountLabel(dm: DmSummary): string {
    return `${dm.participants.length + 1} Members`;
  }

  function isSelfDm(dm: DmSummary): boolean {
    return dm.participants.length === 1 && dm.participants[0].username === user.username;
  }

  function dmLabel(dm: DmSummary): string {
    if (isSelfDm(dm)) return "You";
    return dm.participants.map((p) => p.display_name).join(", ");
  }

  function dmAvatarEl(dm: DmSummary): HTMLElement {
    if (isSelfDm(dm)) return renderAvatarEl(user.display_name, user.avatar_file_id);
    if (dm.participants.length > 1) {
      // Two overlapping avatars (the first two other people, the way
      // Discord's group DMs show it) instead of one generic "people"
      // glyph, so two different group chats never look alike in the list.
      const stack = document.createElement("div");
      stack.className = "avatar-stack";
      dm.participants.slice(0, 2).forEach((p, i) => {
        const av = renderAvatarEl(p.display_name, p.avatar_file_id);
        av.classList.add(i === 0 ? "avatar-stack-a" : "avatar-stack-b");
        stack.appendChild(av);
      });
      return stack;
    }
    // Online status only makes unambiguous sense for a 1:1 — a group
    // DM has several participants, and "online" for the group as a
    // whole isn't a thing anyone asked for. Reuses the same
    // `.avatar-wrap`/`.status-dot` pattern the sidebar footer's own
    // (always-on) status dot already uses, for a consistent look.
    const other = dm.participants[0];
    const wrap = document.createElement("div");
    wrap.className = "avatar-wrap";
    wrap.appendChild(renderAvatarEl(other.display_name, other.avatar_file_id));
    const dot = document.createElement("span");
    dot.className = "status-dot online";
    dot.title = "Online";
    dot.dataset.userId = other.id;
    dot.hidden = !state.onlineUserIds.has(other.id);
    wrap.appendChild(dot);
    return wrap;
  }

  function selectDm(dm: DmSummary): void {
    state.activeChannel = dm.channel;
    state.activeDm = dm;
    channelHeaderLabel.textContent = dmLabel(dm);
    if (isGroupDm(dm)) {
      const sub = document.createElement("span");
      sub.className = "channel-header-sub";
      sub.textContent = groupMemberCountLabel(dm);
      channelHeaderLabel.appendChild(sub);
    }
    composer.placeholder = isSelfDm(dm)
      ? "Jot something down for yourself…"
      : `Message ${dm.participants.map((p) => `@${p.username}`).join(", ")}`;
    markActiveChannelItem(dm.channel.id);
    clearReplyingTo();
    exitPreviewMode();
    state.mentionCandidates = isSelfDm(dm) ? [user] : [user, ...dm.participants];
    rememberUsers(dm.participants);
    dmCallBtn.hidden = isSelfDm(dm);
    // Your private chat has nothing to configure: no adding people (see
    // `api::dms::add_participant`), no invite link, and it can't be
    // closed or left either — every entry in that menu is off-limits.
    dmOptionsBtn.hidden = isSelfDm(dm);
    updateDmCallBtn();
    void loadMessages(dm.channel.id);
  }

  // --- Search -----------------------------------------------------------
  function channelLabelFor(channelId: string): string {
    const dm = state.dms.find((d) => d.channel.id === channelId);
    if (dm) return dmLabel(dm);
    const channel = state.currentChannels.find((c) => c.id === channelId);
    return channel ? `#${channel.name}` : "";
  }

  /** Opens the app at `message`: switches to its conversation or channel
   * and loads the history around it. */
  async function openMessage(message: Message): Promise<void> {
    const dm = state.dms.find((d) => d.channel.id === message.channel_id);
    if (dm) {
      if (!state.onHome) await switchToHome();
      history.pendingJump = message.id;
      selectDm(dm);
      return;
    }
    const channel = state.currentChannels.find((c) => c.id === message.channel_id);
    if (channel) {
      history.pendingJump = message.id;
      selectChannel(channel);
    }
  }

  /** Brings the app to a conversation — what clicking a notification does. */
  async function openConversation(channelId: string): Promise<void> {
    const dm = state.dms.find((d) => d.channel.id === channelId);
    if (dm) {
      if (!state.onHome) await switchToHome();
      selectDm(dm);
      return;
    }
    const channel = state.currentChannels.find((c) => c.id === channelId);
    if (channel) selectChannel(channel);
  }
  onNotificationClick((channelId) => void openConversation(channelId));

  function openSearch(): void {
    const scopes: SearchScopeOption[] = [];
    if (state.activeChannel) {
      scopes.push({
        id: "channel",
        label: state.activeDm ? "This chat" : "This channel",
        params: { channel_id: state.activeChannel.id },
      });
    }
    if (state.activeGuild && !state.onHome) {
      scopes.push({ id: "guild", label: "This server", params: { guild_id: state.activeGuild.id } });
    }
    scopes.push({ id: "dms", label: "Direct messages", params: { scope: "dms" } });
    openSearchPanel({
      scopes,
      initialScopeId: scopes[0].id,
      channelLabel: channelLabelFor,
      onOpen: (message) => void openMessage(message),
    });
  }

  return {
    callDeclined,
    channelLabelFor,
    dismissIncomingCallFor,
    dismissIncomingCallIfFrom,
    dmAvatarEl,
    dmCall,
    dmLabel,
    groupMemberCountLabel,
    isGroupDm,
    isSelfDm,
    openSearch,
    renderDmCallStage,
    ringTimedOut,
    selectDm,
    setStageSpeaking,
    showIncomingCall,
    stageSpeaking,
    startOutgoingRing,
    stopOutgoingRing,
  };
}

export type DirectMessagesParts = ReturnType<typeof createDirectMessages>;
