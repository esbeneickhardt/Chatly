import { api, type DmSummary, type Guild, type User } from "../api";
import { CommandPalette } from "../command-palette";
import { createCommands } from "./chat/commands";

import { installAudioUnlock, playVoiceJoinSound, playVoiceLeaveSound } from "../notification-sound";
import { renderSystemStatusButton } from "../system-status";
import { syncPushSubscription, takeLaunchTarget } from "../notifications";

import { createVoiceControls } from "./chat/voice-controls";
import { createPanes } from "./chat/panes";
import { createComposerDom } from "./chat/composer-dom";
import { createStageDom } from "./chat/stage-dom";
import { createHeader } from "./chat/header";
import { createMicBanner } from "./chat/mic-problems";
import { offerNotifications } from "./chat/notify-prompt";
import { createSidebar } from "./chat/sidebar";

import { createChatState } from "./chat/state";
import { PHONE_QUERY } from "./settings/widgets";
import { isRenderableDm } from "./chat/helpers";
import { createGuildRail } from "./chat/guild-rail";
import { createMessages } from "./chat/messages";
import { createHistory } from "./chat/history";
import { createPeople } from "./chat/people";
import { createChannels } from "./chat/channels";
import { createDirectMessages } from "./chat/direct-messages";
import { createNavigation } from "./chat/navigation";
import { createComposerActions } from "./chat/composer-actions";
import { createEvents } from "./chat/events";
import { wireLive } from "./chat/wiring";

export async function renderChat(
  root: HTMLElement,
  user: User,
  onLoggedOut: () => void,
  /** Where to land right after entering chat — set when this session
   * started by redeeming an invite (registration or a logged-in
   * redeem), instead of the usual "first guild, or Home" default. See
   * the initial-view logic near the end of this function. */
  initialDestination: { channelId: string | null; guildId: string | null } = {
    channelId: null,
    guildId: null,
  },
): Promise<void> {
  root.replaceChildren();
  root.className = "";

  const sidebarParts = createSidebar({
    user,
    closeMobileNav: (...args) => closeMobileNav(...args),
  });
  const {
    channelList,
    footerButtons,
    globalCameraBtn,
    globalDeafenBtn,
    globalMuteBtn,
    globalScreenBtn,
    guildRail,
    mobileServerList,
    nameEl,
    refreshUserAvatar,
    shell,
    sidebar,
    sidebarFooter,
    sidebarHeader,
    sidebarResizeHandle,
    userChip,
  } = sidebarParts;

  sidebarFooter.className = "sidebar-footer";
  sidebarFooter.append(userChip, footerButtons);

  const headerParts = createHeader({
    channelList,
    mobileServerList,
    shell,
    sidebar,
    sidebarFooter,
    sidebarHeader,
    get layoutVideoTiles() {
      return layoutVideoTiles;
    },
  });
  const {
    channelHeader,
    channelHeaderLabel,
    channelHeaderRight,
    closeMobileNav,
    dmCallBtn,
    dmOptionsBtn,
    endCallBtn,
    hamburgerBtn,
    headerCameraBtn,
    headerMuteBtn,
    hideChatBtn,
    mobileNavBackdrop,
    rotateGridBtn,
    searchBtn,
    separateWebcamBtn,
    toggleSidebarBtn,
    videoTiles,
    videoTilesPanel,
  } = headerParts;

  channelHeaderRight.className = "channel-header-right";
  channelHeaderRight.append(
    searchBtn,
    dmCallBtn,
    dmOptionsBtn,
    headerCameraBtn,
    headerMuteBtn,
    toggleSidebarBtn,
    endCallBtn,
    hideChatBtn,
    separateWebcamBtn,
    rotateGridBtn,
    renderSystemStatusButton(),
  );
  channelHeader.append(hamburgerBtn, channelHeaderLabel, channelHeaderRight);

  const stageDom = createStageDom();
  const { dmCallStage, dmCallStageHandle, stageCameraBtn, stageDeafenBtn, stageMuteBtn, stageScreenBtn } =
    stageDom;

  dmCallStageHandle.className = "dm-call-stage-handle";
  dmCallStageHandle.title = "Drag to resize";
  dmCallStageHandle.hidden = true;

  const composerDom = createComposerDom({
    get mentionCandidates() {
      return state.mentionCandidates;
    },
  });
  const { chatColumn, composerWrap, jumpToPresentBtn, messageList } = composerDom;

  jumpToPresentBtn.type = "button";
  jumpToPresentBtn.className = "jump-to-present";
  jumpToPresentBtn.textContent = "Jump to present";
  jumpToPresentBtn.hidden = true;
  chatColumn.append(messageList, jumpToPresentBtn, composerWrap);

  const panes = createPanes({
    chatColumn,
    videoTilesPanel,
    get MOBILE_BREAKPOINT_PX() {
      return MOBILE_BREAKPOINT_PX;
    },
  });
  const { contentSplit, mainColumn, videoChatResizeHandle } = panes;

  mainColumn.className = "main-column";
  mainColumn.setAttribute("role", "main");
  mainColumn.append(channelHeader, dmCallStage, dmCallStageHandle, contentSplit);

  shell.append(guildRail, sidebar, sidebarResizeHandle, mainColumn, mobileNavBackdrop);
  root.appendChild(shell);

  installAudioUnlock();
  const voiceControls = createVoiceControls({
    chatColumn,
    closeMobileNav,
    contentSplit,
    globalCameraBtn,
    globalDeafenBtn,
    globalMuteBtn,
    globalScreenBtn,
    headerCameraBtn,
    headerMuteBtn,
    hideChatBtn,
    nameEl,
    onLoggedOut,
    refreshUserAvatar,
    rotateGridBtn,
    separateWebcamBtn,
    stageCameraBtn,
    stageDeafenBtn,
    stageMuteBtn,
    stageScreenBtn,
    user,
    userChip,
    videoChatResizeHandle,
    videoTiles,
    videoTilesPanel,
    get knownUsers() {
      return knownUsers;
    },
    get renderDmCallStage() {
      return renderDmCallStage;
    },
  });
  const {
    MOBILE_BREAKPOINT_PX,
    autoToggleChatForMobileCall,
    gateway,
    handleLeaveVoice,
    handleToggleCamera,
    handleToggleDeafen,
    handleToggleMute,
    handleToggleScreen,
    layoutVideoTiles,
    renderVideoTile,
    screenAudioActive,
    syncMuteIcons,
    syncVideoIcons,
    updateVideoTile,
    videoTileStreams,
    voiceClient,
  } = voiceControls;

  globalMuteBtn.addEventListener("click", handleToggleMute);
  globalDeafenBtn.addEventListener("click", handleToggleDeafen);
  globalCameraBtn.addEventListener("click", handleToggleCamera);
  globalScreenBtn.addEventListener("click", handleToggleScreen);
  endCallBtn.addEventListener("click", handleLeaveVoice);
  headerMuteBtn.addEventListener("click", handleToggleMute);
  headerCameraBtn.addEventListener("click", handleToggleCamera);

  voiceClient.onLocalVideo = (purpose, stream) => {
    syncVideoIcons();
    if (stream) {
      const el = document.createElement("video");
      el.autoplay = true;
      el.muted = true;
      el.playsInline = true;
      // Some WebKit/mobile Safari versions specifically check the HTML
      // *attributes* (not just the DOM properties above, which is all
      // `autoplay`/`muted`/`playsInline` set) before allowing muted
      // autoplay of a video whose `srcObject` was assigned
      // programmatically rather than via a `src` URL — belt-and-
      // suspenders alongside the explicit `.play()` call in
      // `renderVideoTile` for a bug (a black local self-preview despite
      // the camera genuinely streaming — confirmed by remote viewers
      // seeing it fine) that persisted through the first fix attempt.
      el.setAttribute("autoplay", "");
      el.setAttribute("muted", "");
      el.setAttribute("playsinline", "");
      el.srcObject = stream;
      updateVideoTile("self", "You", purpose, el);
    } else {
      updateVideoTile("self", "You", purpose, null);
    }
  };
  voiceClient.onRemoteVideo = (userId, purpose, el) => {
    const member = knownUsers.get(userId);
    updateVideoTile(userId, member?.display_name ?? "Someone", purpose, el);
  };
  voiceClient.onRemoteScreenAudioChange = (userId, active) => {
    if (active) screenAudioActive.add(userId);
    else screenAudioActive.delete(userId);
    // Re-render just to flip the screen-volume slider's visibility —
    // reuses the existing tile/streams if there's one already, and is
    // a no-op if this person has no tile at all yet.
    const streams = videoTileStreams.get(userId);
    if (streams) {
      const member = knownUsers.get(userId);
      renderVideoTile(userId, member?.display_name ?? "Someone", streams, userId);
    }
  };

  voiceClient.onStateChange = (connected, channelId) => {
    for (const child of Array.from(channelList.children)) {
      const el = child as HTMLElement;
      el.classList.toggle("voice-connected", connected && el.dataset.channelId === channelId);
    }
    syncMuteIcons();
    updateDmCallBtn();
    endCallBtn.classList.remove("reconnecting");
    endCallBtn.hidden = !connected;
    if (connected) {
      // An explicit "start a call" (not a join, not an internal
      // rejoin) that's still fresh — see `dmCall.pendingOutgoingCall`.
      if (
        dmCall.pendingOutgoingCall &&
        dmCall.pendingOutgoingCall.channelId === channelId &&
        Date.now() - dmCall.pendingOutgoingCall.at < 15_000
      ) {
        const ringChannel = dmCall.pendingOutgoingCall.channelId;
        const always = dmCall.pendingOutgoingCall.always === true;
        dmCall.pendingOutgoingCall = null;
        // Ring only if nobody is on the call yet: pressing Call on a call
        // someone is already on just joins it. (Checked again here, now that
        // we are connected, because what was known when Call was pressed can
        // be out of date. The exception is bringing a call into a new group,
        // where whoever has not arrived yet is being rung.)
        const someoneThere = [...(people.voiceParticipants.get(ringChannel) ?? [])].some(
          (id) => id !== user.id,
        );
        if (always || !someoneThere) startOutgoingRing(ringChannel);
      }
    } else {
      dmCall.pendingOutgoingCall = null;
      stopOutgoingRing();
      ringTimedOut.clear();
      callDeclined.clear();
      stageSpeaking.clear();
      renderDmCallStage();
    }
    headerCameraBtn.hidden = !connected;
    headerMuteBtn.hidden = !connected;
    // Mobile-only (see style.css) — swaps the channel name/network-
    // status/webcam-popout controls for the mic/camera ones above
    // while a call has the phone's full attention.
    channelHeader.classList.toggle("in-call", connected);
    if (connected) {
      playVoiceJoinSound();
      // `join()` fires this same `connected: true` transition on
      // every *internal* rejoin too (a camera/screen toggle rebuilds
      // the whole peer connection — see `renegotiateVideo` in
      // voice.ts), not just a genuine fresh join. Only auto-hiding
      // chat the first time avoids fighting a mobile user who
      // deliberately showed chat again mid-call every time they touch
      // their camera or screen share afterward.
      if (!voiceControls.autoHidChatAppliedForThisCall) {
        voiceControls.autoHidChatAppliedForThisCall = true;
        autoToggleChatForMobileCall(true);
      }
    } else {
      playVoiceLeaveSound();
      voiceControls.voiceSpeaking = false;
      voiceControls.autoHidChatAppliedForThisCall = false;
      autoToggleChatForMobileCall(false);
    }
  };
  voiceClient.onMicProblemChange = createMicBanner(voiceClient);
  voiceClient.onError = (message) => {
    dmCall.pendingOutgoingCall = null;
    alert(message);
  };
  // A lagged connection now gets a grace period before actually being
  // torn down (see `RECONNECT_GRACE_MS` in voice.ts) — this just gives
  // that wait a visible cue instead of the call silently doing nothing
  // (or, before that grace period existed, instantly vanishing).
  voiceClient.onReconnecting = (reconnecting) => {
    endCallBtn.classList.toggle("reconnecting", reconnecting);
    endCallBtn.title = reconnecting ? "Reconnecting…" : "Disconnect";
  };
  voiceClient.onRemoteSpeakingChange = (userId, speaking) => {
    setStageSpeaking(userId, speaking);
    channelList
      .querySelector(`.voice-participant[data-user-id="${userId}"]`)
      ?.classList.toggle("speaking", speaking);
  };
  voiceClient.onSpeakingChange = (speaking) => {
    setStageSpeaking(user.id, speaking);
    voiceControls.voiceSpeaking = speaking;
    globalMuteBtn.classList.toggle("speaking", speaking);
    const ownRow = channelList.querySelector(`.voice-participant[data-user-id="${user.id}"]`);
    ownRow?.classList.toggle("speaking", speaking);
  };

  const state = createChatState(
    await api.get<Guild[]>("/api/guilds"),
    (await api.get<DmSummary[]>("/api/dms")).filter(isRenderableDm),
  );

  const people = createPeople({
    sidebarParts,
    composerDom,
    state,
    user,
    get flattenForReplyPreview() {
      return flattenForReplyPreview;
    },
    get renderReplyAttachmentChip() {
      return renderReplyAttachmentChip;
    },
  });
  const { knownUsers, setReplyingTo } = people;

  const guildRail2 = createGuildRail({
    sidebarParts,
    headerParts,
    composerDom,
    state,
    user,
    refreshDmList: (...args) => refreshDmList(...args),
    switchGuild: (...args) => switchGuild(...args),
    switchToHome: (...args) => switchToHome(...args),
  });
  const { refreshFriendRequestsBadge } = guildRail2;

  void refreshFriendRequestsBadge();

  const messages = createMessages({
    composerDom,
    state,
    user,
    loadMessages: (...args) => loadMessages(...args),
    mentionUsernamesFor: (...args) => mentionUsernamesFor(...args),
    setReplyingTo: (...args) => setReplyingTo(...args),
    trackLoadedRange: (...args) => trackLoadedRange(...args),
    get pendingJump() {
      return history.pendingJump;
    },
    set pendingJump(value) {
      history.pendingJump = value;
    },
  });
  const { flattenForReplyPreview, renderReplyAttachmentChip } = messages;

  const history = createHistory({
    messages,
    composerDom,
    state,
  });
  const { loadMessages, trackLoadedRange } = history;

  const channels = createChannels({
    headerParts,
    sidebarParts,
    people,
    composerDom,
    history,
    voiceControls,
    state,
    user,
    isSelfDm: (...args) => isSelfDm(...args),
    switchGuild: (...args) => switchGuild(...args),
    get renderDmCallStage() {
      return renderDmCallStage;
    },
  });
  const { selectChannel, toggleVoiceChannel, updateDmCallBtn } = channels;

  const directMessages = createDirectMessages({
    headerParts,
    people,
    composerDom,
    stageDom,
    voiceControls,
    history,
    panes,
    channels,
    state,
    user,
    switchToHome: (...args) => switchToHome(...args),
    switchGuild: (...args) => switchGuild(...args),
  });
  const {
    callDeclined,
    dmCall,
    isSelfDm,
    openSearch,
    renderDmCallStage,
    ringTimedOut,
    selectDm,
    setStageSpeaking,
    stageSpeaking,
    startOutgoingRing,
    stopOutgoingRing,
  } = directMessages;

  searchBtn.addEventListener("click", openSearch);
  window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "f") {
      e.preventDefault();
      openSearch();
    }
  });

  const navigation = createNavigation({
    guildRail2,
    headerParts,
    sidebarParts,
    directMessages,
    composerDom,
    people,
    channels,
    voiceControls,
    state,
    user,
  });
  const { enterDefaultView, mentionUsernamesFor, refreshDmList, switchGuild, switchToHome } = navigation;

  const launchTarget = takeLaunchTarget();

  // An invite's destination (see `main.ts`'s boot/registration flow)
  // overrides the usual "first guild, or Home" default for this one
  // initial render — falls back to that default if the destination
  // turns out to be stale (e.g. the guild/DM was somehow gone by the
  // time this loaded) rather than erroring.
  if (initialDestination.channelId && initialDestination.guildId) {
    const targetGuild = state.guilds.find((g) => g.id === initialDestination.guildId);
    if (targetGuild) {
      await switchGuild(targetGuild);
      const targetChannel = state.currentChannels.find((c) => c.id === initialDestination.channelId);
      if (targetChannel && targetChannel.kind === "text") {
        selectChannel(targetChannel);
      } else if (targetChannel && targetChannel.kind === "voice") {
        // "Invite to Voice" (see `renderInviteToVoiceModal`) explicitly
        // promises "Recipients will land in <this voice channel>" — a
        // text-channel-only landing silently broke that promise,
        // leaving the invited person on some unrelated first text
        // channel with no indication the voice channel even existed.
        // Joining the call directly is exactly what following that
        // specific invite link is *for*, not a surprise: the modal
        // already told them this is where they'd end up before they
        // ever clicked it.
        void toggleVoiceChannel(targetChannel);
      }
    } else {
      await enterDefaultView();
    }
  } else if (initialDestination.channelId) {
    await switchToHome();
    const targetDm = state.dms.find((d) => d.channel.id === initialDestination.channelId);
    if (targetDm) selectDm(targetDm);
  } else if (launchTarget) {
    // Started by tapping a notification while no Chatly window was open.
    await (launchTarget.guildId ? enterDefaultView() : switchToHome());
    await directMessages.openFromNotification(launchTarget);
  } else if (window.matchMedia(PHONE_QUERY).matches) {
    // A phone starts on the conversation list (with who is online), drawer
    // open: one tap from any conversation instead of three from a server.
    await switchToHome();
    shell.classList.add("mobile-nav-open");
  } else {
    await enterDefaultView();
  }

  const composerActions = createComposerActions({
    composerDom,
    people,
    state,
  });

  wireLive({
    messages,
    directMessages,
    composerActions,
    composerDom,
    voiceControls,
    history,
    state,
    user,
    get handleVoiceStateUpdate() {
      return handleVoiceStateUpdate;
    },
  });

  const events = createEvents({
    directMessages,
    sidebarParts,
    guildRail2,
    voiceControls,
    history,
    navigation,
    people,
    channels,
    onLoggedOut,
    state,
    user,
  });
  const { handleVoiceStateUpdate } = events;

  const { source } = createCommands({
    directMessages,
    sidebarParts,
    guildRail2,
    voiceControls,
    navigation,
    channels,
    onLoggedOut,
    state,
    user,
  });
  new CommandPalette(source);

  gateway.connect();
  syncPushSubscription();
  window.setTimeout(offerNotifications, 1500);
}
