// Live events: voice-state updates (incoming calls, who is on a call).

import { type DmSummary, type User, api } from "../../api";
import { type DmCallMovedEvent, type VoiceStateUpdate } from "../../gateway";
import { playVoicePeerJoinSound, playVoicePeerLeaveSound } from "../../notification-sound";
import { showNotice } from "../../ui";
import { type ChannelsParts } from "./channels";
import { type DirectMessagesParts } from "./direct-messages";
import { type GuildRailParts } from "./guild-rail";
import { type HistoryParts } from "./history";
import { type NavigationParts } from "./navigation";
import { type PeopleParts } from "./people";
import { type SidebarParts } from "./sidebar";
import { type VoiceControlsParts } from "./voice-controls";
import type { ChatState } from "./state";

/** What this part of the chat screen needs from the rest of it. */
export interface createEventsContext {
  directMessages: DirectMessagesParts;
  sidebarParts: SidebarParts;
  guildRail2: GuildRailParts;
  voiceControls: VoiceControlsParts;
  history: HistoryParts;
  navigation: NavigationParts;
  people: PeopleParts;
  channels: ChannelsParts;
  onLoggedOut: () => void;
  state: ChatState;
  user: User;
}

export function createEvents(ctx: createEventsContext) {
  const { state, user } = ctx;
  const {
    callDeclined,
    dismissIncomingCallFor,
    dismissIncomingCallIfFrom,
    dmCall,
    dmLabel,
    renderDmCallStage,
    ringTimedOut,
    selectDm,
    showIncomingCall,
  } = ctx.directMessages;
  const { refreshFriendRequestsBadge } = ctx.guildRail2;
  const { gateway, updateVideoTile, voiceClient } = ctx.voiceControls;
  const { loadMessages } = ctx.history;
  const { refreshDmList, switchToHome, syncDmVoiceState, syncDms } = ctx.navigation;
  const { rememberUsers, setUserOnline, voiceParticipants } = ctx.people;
  const { renderChannelItems } = ctx.channels;

  /** Set while a call is being carried into a group chat, so the rings for
   * that group — which our own side is about to join — are not shown as
   * incoming calls. */
  let followingCall: { to: string; until: number } | null = null;
  const FOLLOW_WINDOW_MS = 20_000;

  function handleVoiceStateUpdate(data: VoiceStateUpdate): void {
    // A DM's voice channel never appears in `currentChannels` (that's
    // only ever populated for a *guild's* channel list) — this used
    // to mean every DM call's voice_state_update was silently ignored
    // entirely, sound and all, which was the actual reason a callee
    // "experienced nothing" when called: nothing here ever ran for
    // them at all, let alone showed an incoming-call banner.
    const dm = state.dms.find((d) => d.channel.id === data.channel_id);
    const isKnownChannel = state.currentChannels.some((c) => c.id === data.channel_id) || dm !== undefined;
    if (!isKnownChannel) return;

    // Your own join/leave already gets a sound from
    // voiceClient.onStateChange — this is only for hearing someone
    // else come and go in the voice channel you're currently in.
    if (data.user_id !== user.id && data.channel_id === voiceClient.currentChannelId) {
      if (data.connected) {
        playVoicePeerJoinSound();
      } else {
        playVoicePeerLeaveSound();
        // Belt-and-suspenders cleanup for that person's video tile,
        // not just relying on their WebRTC track firing "ended" (see
        // voice.ts's attachRemoteTrack) — that's a transport-level
        // event that reliably fires when someone gracefully turns
        // their camera off or hangs up, but not always on an abrupt
        // disconnect (network drop, tab closed, ICE failure). This
        // `voice_state_update` is the server's own authoritative "are
        // they still in this call" signal, already used for the
        // peer-leave sound right above — using it for tile cleanup
        // too means a stuck tile (and the video panel's "big empty
        // space" stuck open behind it) can no longer depend on a
        // WebRTC event that isn't guaranteed to fire. Harmless to
        // call for someone with no tile at all (updateVideoTile is a
        // no-op then) and harmless if the "ended" event *also* fires
        // moments later (removing an already-removed tile is a no-op).
        updateVideoTile(data.user_id, "", "camera", null);
        updateVideoTile(data.user_id, "", "screen", null);
      }
    }

    // Someone else joined a DM call that isn't the one we're already
    // in — that's an incoming call. Not relevant for guild voice
    // channels (`dm` is undefined there): joining a public-ish voice
    // channel isn't "calling" anyone in particular.
    const following =
      followingCall !== null && followingCall.to === data.channel_id && Date.now() < followingCall.until;
    if (dm && !following && data.user_id !== user.id && data.channel_id !== voiceClient.currentChannelId) {
      if (data.connected) {
        showIncomingCall(dm, data.user_id);
      } else {
        dismissIncomingCallIfFrom(data.channel_id, data.user_id);
      }
    }

    // Someone picked up (or joined) the call we've been ringing: the
    // ring-back sound's job is done. (The stage keeps showing anyone
    // who hasn't answered yet as still ringing, until the timeout —
    // that's what calling a group looks like.)
    if (dmCall.outgoingRing?.channelId === data.channel_id && data.user_id !== user.id && data.connected) {
      dmCall.outgoingRing.silence();
      ringTimedOut.delete(data.channel_id);
    }

    const set = voiceParticipants.get(data.channel_id) ?? new Set<string>();
    if (data.connected) {
      set.add(data.user_id);
    } else {
      set.delete(data.user_id);
    }
    voiceParticipants.set(data.channel_id, set);
    // Rendering the guild channel list only makes sense while looking
    // at one — while `onHome`, `currentChannels` is empty and this
    // would just blank out the DM list, which shares the same DOM
    // container.
    if (!state.onHome) renderChannelItems();
    if (state.activeDm && data.channel_id === state.activeDm.channel.id) renderDmCallStage();
  }
  // There's no gateway Resume yet, so every (re)connect is a fresh
  // Ready — reload the open channel in case anything was sent while
  // we were briefly disconnected.
  gateway.on("ready", (data) => {
    state.onlineUserIds = new Set(data.online_user_ids);
    // Calls that started while this page was loading or disconnected.
    void syncDmVoiceState();
    if (state.onHome) void refreshDmList();
    if (state.activeChannel) {
      void loadMessages(state.activeChannel.id);
    }
  });

  gateway.on("presence_update", (data) => {
    setUserOnline(data.user_id, data.online);
  });

  gateway.on("friend_request_create", () => {
    void refreshFriendRequestsBadge();
  });

  // A friend request you sent/received just got accepted, or someone
  // added you to a conversation — either way, a DM you weren't
  // subscribed to before now exists. Only re-render the list if
  // that's the view being looked at right now; otherwise it'll just
  // be fetched fresh next time `switchToHome` runs.
  gateway.on("dm_channel_create", () => {
    // Refetch even off Home: the DM has to be in `dms` for call events
    // on it to be recognized (see `dmsSync`), not just to render it.
    state.dmsSync = (state.onHome ? refreshDmList() : syncDms()).catch(() => {});
  });

  // Someone else left a group DM you're both in — refetch so the
  // participant list (visible in the header when it's the active
  // conversation, and implicitly in who's left to message) is
  // current. Same "just refetch, don't hand-patch local state"
  // approach as `dm_channel_create` above; one fetch covers both the
  // sidebar (if it's being looked at) and the open conversation's own
  // header (if this happened in the one you're currently viewing).
  gateway.on("dm_call_declined", (data) => {
    if (data.user_id === user.id) return;
    const declined = callDeclined.get(data.channel_id) ?? new Set<string>();
    declined.add(data.user_id);
    callDeclined.set(data.channel_id, declined);
    // Once everyone who was rung has said no, the ring-back tone has
    // nothing left to wait for.
    const dm = state.dms.find((d) => d.channel.id === data.channel_id);
    if (dm && dmCall.outgoingRing?.channelId === data.channel_id) {
      const rung = dm.participants.filter((p) => p.id !== user.id);
      if (rung.length > 0 && rung.every((p) => declined.has(p.id))) dmCall.outgoingRing.silence();
    }
    if (state.activeDm && state.activeDm.channel.id === data.channel_id) renderDmCallStage();
  });

  // Someone added a person to a 1:1 that has a call going: the call moves
  // into the new group chat, and everyone on it goes along, so the three of
  // them end up in one call. That is the same call gaining someone, so it does
  // not ask the way joining a different call does.
  gateway.on("dm_call_moved", (data) => {
    // A ring for the old 1:1 call would only strand whoever answered it.
    dismissIncomingCallFor(data.from_channel_id);
    if (voiceClient.currentChannelId === data.from_channel_id) void followCall(data);
  });

  async function followCall(data: DmCallMovedEvent): Promise<void> {
    followingCall = { to: data.to_channel_id, until: Date.now() + FOLLOW_WINDOW_MS };
    let dm = state.dms.find((d) => d.channel.id === data.to_channel_id);
    if (!dm) {
      await syncDms();
      dm = state.dms.find((d) => d.channel.id === data.to_channel_id);
    }
    if (!dm) {
      followingCall = null;
      return;
    }
    // Follow the conversation on screen too, if you were looking at the call.
    const viewingTheCall = state.activeChannel?.id === data.from_channel_id;
    if (data.by === user.id || viewingTheCall) {
      if (!state.onHome) await switchToHome();
      selectDm(dm);
    }
    // Ring whoever in the group has not joined yet, as a new call would.
    dmCall.pendingOutgoingCall = { channelId: data.to_channel_id, at: Date.now(), always: true };
    await voiceClient.join(data.to_channel_id);
    showNotice(`Your call moved to a group chat with ${dmLabel(dm)}, so everyone is in one call.`);
  }

  gateway.on("dm_participant_leave", (data) => {
    if (!state.onHome && state.activeDm?.channel.id !== data.channel_id) return;
    void api.get<DmSummary[]>("/api/dms").then((all) => {
      state.dms = all;
      for (const dm of state.dms) rememberUsers(dm.participants);
      if (state.onHome) void refreshDmList();
      if (state.activeDm?.channel.id === data.channel_id) {
        const updated = state.dms.find((d) => d.channel.id === data.channel_id);
        if (updated) selectDm(updated);
      }
    });
  });

  return {
    handleVoiceStateUpdate,
  };
}
