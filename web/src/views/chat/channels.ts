// Channels: who is in each voice channel, the channel and conversation rows, selecting a channel, and joining a voice channel.

import { type Channel, type DmSummary, type Guild, type User } from "../../api";
import { icon } from "../../icons";
import { renderAvatarEl } from "../../ui";
import { MAX_REMOTE_VOLUME } from "../../voice";
import { renderInviteToVoiceModal, renderManageChannelModal } from "../servers";
import { type ComposerDomParts } from "./composer-dom";
import { type HeaderParts } from "./header";
import { type HistoryParts } from "./history";
import { createCallGuard } from "./call-guard";
import { type PeopleParts } from "./people";
import { type SidebarParts } from "./sidebar";
import { type VoiceControlsParts } from "./voice-controls";
import type { ChatState } from "./state";

/** What this part of the chat screen needs from the rest of it. */
export interface createChannelsContext {
  headerParts: HeaderParts;
  sidebarParts: SidebarParts;
  people: PeopleParts;
  composerDom: ComposerDomParts;
  history: HistoryParts;
  voiceControls: VoiceControlsParts;
  state: ChatState;
  user: User;
  isSelfDm: (dm: DmSummary) => boolean;
  switchGuild: (guild: Guild) => Promise<void>;
  readonly renderDmCallStage: () => void;
}

export function createChannels(ctx: createChannelsContext) {
  const { state, user, isSelfDm, switchGuild, voiceControls } = ctx;
  const { channelHeaderLabel, dmCallBtn, dmOptionsBtn } = ctx.headerParts;
  const { channelList } = ctx.sidebarParts;
  const { clearReplyingTo, knownUsers, voiceParticipants } = ctx.people;
  const { composer, exitPreviewMode } = ctx.composerDom;
  const { loadMessages } = ctx.history;
  const { voiceClient, wireRemoteVolumeSlider } = ctx.voiceControls;
  const { confirmSwitchCall } = createCallGuard({ state, voiceClient });

  function renderVoiceParticipants(channelId: string): HTMLElement | null {
    const ids = voiceParticipants.get(channelId);
    if (!ids || ids.size === 0) return null;
    const list = document.createElement("div");
    list.className = "voice-participants";
    for (const uid of ids) {
      const member = knownUsers.get(uid);
      if (!member) continue;
      const row = document.createElement("div");
      row.className = "voice-participant";
      row.dataset.userId = uid;
      if (uid === user.id && voiceControls.voiceSpeaking) row.classList.add("speaking");
      row.appendChild(renderAvatarEl(member.display_name, member.avatar_file_id));
      const name = document.createElement("span");
      name.className = "voice-participant-name";
      name.textContent = member.display_name;
      row.appendChild(name);
      if (uid !== user.id) {
        const volumeSlider = document.createElement("input");
        volumeSlider.type = "range";
        volumeSlider.className = "voice-participant-volume";
        volumeSlider.min = "0";
        volumeSlider.max = String(Math.round(MAX_REMOTE_VOLUME * 100));
        volumeSlider.title = `${member.display_name}'s volume`;
        volumeSlider.value = String(Math.round(voiceClient.getRemoteVolume(uid) * 100));
        wireRemoteVolumeSlider(volumeSlider, uid);
        row.appendChild(volumeSlider);
      }
      list.appendChild(row);
    }
    return list;
  }

  function channelInviteBtn(channel: Channel): HTMLElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "icon-button channel-invite-btn";
    btn.title = "Invite to Voice";
    btn.appendChild(icon("user-plus", 13));
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      renderInviteToVoiceModal({
        guildName: state.activeGuild?.name ?? "this server",
        channelId: channel.id,
        channelName: channel.name,
        currentUserId: user.id,
      });
    });
    return btn;
  }

  function channelManageBtn(channel: Channel): HTMLElement | null {
    if (!channel.can_manage) return null;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "icon-button channel-manage-btn";
    btn.title = "Manage channel";
    btn.appendChild(icon("settings", 13));
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      renderManageChannelModal({
        channel,
        onDeleted: () => {
          if (state.activeGuild) void switchGuild(state.activeGuild);
        },
      });
    });
    return btn;
  }

  /** Replaces the channel/conversation list's rows. A keyboard user
   * sitting on a row would otherwise lose their place every time the
   * list refreshes (a message arrives, someone comes online), because the
   * focused element is replaced by a new one — so focus is put back on
   * the row for the same channel, if it's still there. */
  function setChannelListRows(rows: HTMLElement[]): void {
    const focused = document.activeElement;
    const focusedId =
      focused instanceof HTMLElement && channelList.contains(focused)
        ? focused.closest<HTMLElement>("[data-channel-id]")?.dataset.channelId
        : undefined;
    channelList.replaceChildren(...rows);
    if (focusedId) {
      channelList.querySelector<HTMLElement>(`[data-channel-id="${focusedId}"]`)?.focus();
    }
  }

  function renderChannelItems(): void {
    const items = state.currentChannels
      .filter((channel) => channel.kind !== "category")
      .map((channel) => {
        const item = document.createElement("div");
        item.className = "channel-item";
        item.dataset.channelId = channel.id;
        item.dataset.channelName = channel.name;
        const manageBtn = channelManageBtn(channel);
        if (channel.kind === "voice") {
          item.classList.add("voice");
          if (voiceClient.currentChannelId === channel.id) item.classList.add("voice-connected");
          const topRow = document.createElement("div");
          topRow.className = "channel-item-top";
          topRow.appendChild(icon("volume-2", 16));
          if (channel.restricted) topRow.appendChild(icon("lock", 12));
          const label = document.createElement("span");
          label.className = "channel-item-label";
          label.textContent = channel.name;
          topRow.appendChild(label);
          topRow.appendChild(channelInviteBtn(channel));
          if (manageBtn) topRow.appendChild(manageBtn);
          item.appendChild(topRow);
          const participants = renderVoiceParticipants(channel.id);
          if (participants) item.appendChild(participants);
          item.addEventListener("click", () => void toggleVoiceChannel(channel));
        } else {
          if (state.activeChannel?.id === channel.id) item.classList.add("active");
          item.appendChild(icon("hash", 16));
          if (channel.restricted) item.appendChild(icon("lock", 12));
          const label = document.createElement("span");
          label.className = "channel-item-label";
          label.textContent = channel.name;
          item.appendChild(label);
          if (manageBtn) item.appendChild(manageBtn);
          item.addEventListener("click", () => selectChannel(channel));
        }
        return item;
      });
    setChannelListRows(items);
  }

  function markActiveChannelItem(channelId: string): void {
    for (const child of Array.from(channelList.children)) {
      (child as HTMLElement).classList.toggle(
        "active",
        (child as HTMLElement).dataset.channelId === channelId,
      );
    }
  }

  function selectChannel(channel: Channel): void {
    state.activeChannel = channel;
    channelHeaderLabel.replaceChildren(icon("hash", 18), document.createTextNode(channel.name));
    composer.placeholder = `Message #${channel.name}`;
    markActiveChannelItem(channel.id);
    clearReplyingTo();
    exitPreviewMode();
    dmCallBtn.hidden = true;
    dmOptionsBtn.hidden = true;
    state.activeDm = null;
    void loadMessages(channel.id);
  }

  /** Leaves this call if you are on it; otherwise joins it, first asking
   * whether to leave the call you are on. True unless you said no. */
  async function toggleVoiceChannel(channel: Channel): Promise<boolean> {
    if (voiceClient.currentChannelId === channel.id) {
      voiceClient.leave();
      return true;
    }
    if (!(await confirmSwitchCall(channel.id))) return false;
    void voiceClient.join(channel.id);
    return true;
  }

  function updateDmCallBtn(): void {
    ctx.renderDmCallStage();
    if (!state.activeChannel || !state.onHome) return;
    // Only ever "start a call" now — `endCallBtn` (channel header) and
    // the call stage's own hang-up are the ways to leave, so this
    // hides itself instead of also turning into a second "leave call"
    // button the moment you're already in this one. Still respects the
    // separate self-DM check `selectDm` made — there's no one to call
    // there either way, in-call or not.
    const inThisCall = voiceClient.currentChannelId === state.activeChannel.id;
    dmCallBtn.hidden = inThisCall || (state.activeDm ? isSelfDm(state.activeDm) : false);
    dmCallBtn.replaceChildren(icon("phone", 16));
    dmCallBtn.title = "Call";
  }

  return {
    confirmSwitchCall,
    markActiveChannelItem,
    renderChannelItems,
    selectChannel,
    setChannelListRows,
    toggleVoiceChannel,
    updateDmCallBtn,
  };
}

export type ChannelsParts = ReturnType<typeof createChannels>;
