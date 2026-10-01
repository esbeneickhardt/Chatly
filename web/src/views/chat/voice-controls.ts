// Voice controls: the voice client and its gateway, the mute/deafen/
// camera/screen buttons (and their icons), hanging up, opening Settings,
// and the chat-hidden state that a call on a phone toggles.

import { type User } from "../../api";
import { GatewayClient } from "../../gateway";
import { icon } from "../../icons";
import { VoiceClient } from "../../voice";
import { type SettingsTab, renderSettings } from "../settings";
import { createVideoPanel } from "../video-panel";

/** What this part of the chat screen needs from the rest of it. */
export interface createVoiceControlsContext {
  chatColumn: HTMLDivElement;
  closeMobileNav: () => void;
  contentSplit: HTMLDivElement;
  globalCameraBtn: HTMLButtonElement;
  globalDeafenBtn: HTMLButtonElement;
  globalMuteBtn: HTMLButtonElement;
  globalScreenBtn: HTMLButtonElement;
  headerCameraBtn: HTMLButtonElement;
  headerMuteBtn: HTMLButtonElement;
  hideChatBtn: HTMLButtonElement;
  nameEl: HTMLDivElement;
  onLoggedOut: () => void;
  refreshUserAvatar: () => void;
  rotateGridBtn: HTMLButtonElement;
  separateWebcamBtn: HTMLButtonElement;
  stageCameraBtn: HTMLButtonElement;
  stageDeafenBtn: HTMLButtonElement;
  stageMuteBtn: HTMLButtonElement;
  stageScreenBtn: HTMLButtonElement;
  user: User;
  userChip: HTMLButtonElement;
  videoChatResizeHandle: HTMLDivElement;
  videoTiles: HTMLDivElement;
  videoTilesPanel: HTMLDivElement;
  readonly knownUsers: Map<string, User>;
  readonly renderDmCallStage: () => void;
}

export function createVoiceControls(ctx: createVoiceControlsContext) {
  const {
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
  } = ctx;

  const gateway = new GatewayClient();
  const voiceClient = new VoiceClient(gateway);
  let voiceSpeaking = false;

  let mfaEnabled = Boolean(user.mfa_enabled);
  // The profile chip itself opens Settings now — no separate gear
  // button needed alongside it (see `userChip` above).
  function openSettings(initialTab?: SettingsTab): void {
    closeMobileNav();
    renderSettings({
      user,
      isOwner: user.is_owner,
      mfaEnabled,
      onMfaChanged: () => {
        mfaEnabled = !mfaEnabled;
      },
      onUserUpdated: (updated) => {
        user.display_name = updated.display_name;
        user.username = updated.username;
        user.avatar_file_id = updated.avatar_file_id;
        nameEl.textContent = user.display_name;
        refreshUserAvatar();
        ctx.knownUsers.set(user.id, user);
      },
      voiceClient,
      onLoggedOut,
      initialTab,
    });
  }
  userChip.addEventListener("click", () => openSettings());

  function syncMuteIcons(): void {
    const muted = voiceClient.isMuted;
    const deafened = voiceClient.isDeafened;
    globalMuteBtn.replaceChildren(icon(muted ? "mic-off" : "mic", 16));
    globalMuteBtn.classList.toggle("muted", muted);
    globalDeafenBtn.replaceChildren(icon(deafened ? "headphones-off" : "headphones", 16));
    globalDeafenBtn.classList.toggle("muted", deafened);
    headerMuteBtn.replaceChildren(icon(muted ? "mic-off" : "mic", 16));
    headerMuteBtn.classList.toggle("muted", muted);
    stageMuteBtn.replaceChildren(icon(muted ? "mic-off" : "mic", 20));
    stageMuteBtn.classList.toggle("muted", muted);
    stageMuteBtn.title = muted ? "Unmute microphone" : "Mute microphone";
    stageDeafenBtn.replaceChildren(icon(deafened ? "headphones-off" : "headphones", 20));
    stageDeafenBtn.classList.toggle("muted", deafened);
  }

  const {
    layoutVideoTiles,
    renderVideoTile,
    screenAudioActive,
    syncVideoIcons,
    updateVideoTile,
    videoTileStreams,
  } = createVideoPanel({
    globalCameraBtn,
    globalScreenBtn,
    headerCameraBtn,
    hideChatBtn,
    // Resolved when called: the DM call slice is created further down.
    renderDmCallStage: () => ctx.renderDmCallStage(),
    rotateGridBtn,
    separateWebcamBtn,
    stageCameraBtn,
    stageScreenBtn,
    videoChatResizeHandle,
    videoTiles,
    videoTilesPanel,
    voiceClient,
    wireRemoteVolumeSlider,
    get chatHidden() {
      return chatHidden;
    },
  });

  // These sliders are only 56-72px wide (deliberately unobtrusive — see
  // their CSS), which makes landing the mouse on the *exact* pixel for
  // 0% or 100% error-prone: a drag that's a couple of percent short of
  // an edge reads as "the slider won't go all the way to min/max" even
  // though the input itself works fine (dragging clearly past an edge
  // does correctly clamp to 0/100 — confirmed live). Snapping to the
  // true edge once a drag gets close removes that precision requirement
  // entirely, the same trick Discord's own volume sliders use.
  function wireRemoteVolumeSlider(slider: HTMLInputElement, userId: string): void {
    // Goes past 100% (up to `MAX_REMOTE_VOLUME`) — a quiet shared video
    // needs more than the source level, which an audio element alone
    // can't give; the 100% mark gets the same edge-snapping as 0%.
    const baseTitle = slider.title;
    slider.title = `${baseTitle} — ${slider.value}%`;
    // Also swallows clicks/drags so they don't bubble into a parent
    // row's own click handler (the sidebar's voice-channel row toggles
    // joining/leaving the call on click) — harmless where there's no
    // such parent handler, like the video tile controls.
    slider.addEventListener("click", (e) => e.stopPropagation());
    slider.addEventListener("input", (e) => {
      e.stopPropagation();
      const raw = Number(slider.value);
      const snapped = raw <= 3 ? 0 : Math.abs(raw - 100) <= 3 ? 100 : raw;
      if (snapped !== raw) slider.value = String(snapped);
      slider.title = `${baseTitle} — ${snapped}%`;
      voiceClient.setRemoteVolume(userId, snapped / 100);
    });
  }

  let chatHidden = false;
  function setChatHidden(hidden: boolean): void {
    chatHidden = hidden;
    chatColumn.hidden = chatHidden;
    contentSplit.classList.toggle("chat-hidden", chatHidden);
    hideChatBtn.title = chatHidden ? "Show chat" : "Hide chat";
    hideChatBtn.classList.toggle("active", chatHidden);
    ctx.renderDmCallStage();
  }
  hideChatBtn.addEventListener("click", () => setChatHidden(!chatHidden));

  /** A phone screen has no room to spare for *both* a real video grid
   * and the message list at once — capped to a shallow strip up top
   * (see the `max-height: 45vh` mobile rule), a call with more than
   * one video tile shrinks each one to barely usable. Desktop has the
   * width for both side by side, which is why this only ever fires
   * below the same mobile breakpoint everything else in the app
   * switches on. Auto-hiding (not just leaving "Hide chat" as a manual
   * discovery) means the *first* time someone joins a call on a phone
   * already looks like a real call screen, not something they have to
   * find a button for first. Symmetrically restored on hanging up —
   * there's no video left to justify staying hidden once the call
   * itself is over. */
  const MOBILE_BREAKPOINT_PX = 768;
  function autoToggleChatForMobileCall(connected: boolean): void {
    if (window.innerWidth > MOBILE_BREAKPOINT_PX) return;
    setChatHidden(connected);
  }
  /** Guards `autoToggleChatForMobileCall` against re-firing on every
   * internal rejoin — see the matching comment where it's read, in
   * `voiceClient.onStateChange`. */
  let autoHidChatAppliedForThisCall = false;

  function handleToggleMute(): void {
    voiceClient.toggleMute();
    syncMuteIcons();
  }
  function handleToggleDeafen(): void {
    voiceClient.toggleDeafen();
    syncMuteIcons();
  }
  function handleToggleCamera(): void {
    void voiceClient.toggleCamera().then(syncVideoIcons);
  }
  function handleToggleScreen(): void {
    void voiceClient.toggleScreenShare().then(syncVideoIcons);
  }
  function handleLeaveVoice(): void {
    voiceClient.leave();
  }

  return {
    MOBILE_BREAKPOINT_PX,
    get autoHidChatAppliedForThisCall() {
      return autoHidChatAppliedForThisCall;
    },
    set autoHidChatAppliedForThisCall(value: boolean) {
      autoHidChatAppliedForThisCall = value;
    },
    autoToggleChatForMobileCall,
    get chatHidden() {
      return chatHidden;
    },
    set chatHidden(value: boolean) {
      chatHidden = value;
    },
    gateway,
    handleLeaveVoice,
    handleToggleCamera,
    handleToggleDeafen,
    handleToggleMute,
    handleToggleScreen,
    layoutVideoTiles,
    openSettings,
    renderVideoTile,
    screenAudioActive,
    syncMuteIcons,
    syncVideoIcons,
    updateVideoTile,
    videoTileStreams,
    voiceClient,
    get voiceSpeaking() {
      return voiceSpeaking;
    },
    set voiceSpeaking(value: boolean) {
      voiceSpeaking = value;
    },
    wireRemoteVolumeSlider,
  };
}

export type VoiceControlsParts = ReturnType<typeof createVoiceControls>;
