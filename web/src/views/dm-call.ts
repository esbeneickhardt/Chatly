// The DM call experience: ringing someone (with the ring-back tone), the
// incoming-call card, and the "stage" — the panel of big avatars, status
// line and call controls that sits above a conversation while a call is
// going on. Extracted from the chat view (see docs/architecture.md,
// "Decomposing the chat view"); it needs a fair amount from the rest of
// the screen, all of it listed in `DmCallContext`.

import { type Channel, type DmSummary, type User, api } from "../api";
import { icon } from "../icons";
import { playIncomingCallSound, playOutgoingCallSound } from "../notification-sound";
import { notify } from "../notifications";
import { renderAvatarEl } from "../ui";
import { markMicProblem } from "./chat/mic-problems";
import { type VoiceClient } from "../voice";

/** What this slice needs from the chat view. */
export interface DmCallContext {
  user: User;
  channelHeader: HTMLDivElement;
  dmCallBtn: HTMLButtonElement;
  dmCallControlPill: HTMLDivElement;
  dmCallParticipants: HTMLDivElement;
  dmCallStage: HTMLDivElement;
  dmCallStageHandle: HTMLDivElement;
  dmCallStatus: HTMLDivElement;
  dmLabel: (dm: DmSummary) => string;
  handleLeaveVoice: () => void;
  handleToggleCamera: () => void;
  handleToggleDeafen: () => void;
  handleToggleMute: () => void;
  handleToggleScreen: () => void;
  isSelfDm: (dm: DmSummary) => boolean;
  knownUsers: Map<string, User>;
  mainColumn: HTMLDivElement;
  selectDm: (dm: DmSummary) => void;
  stageCameraBtn: HTMLButtonElement;
  stageDeafenBtn: HTMLButtonElement;
  stageHangupBtn: HTMLButtonElement;
  stageJoinBtn: HTMLButtonElement;
  stageMuteBtn: HTMLButtonElement;
  stageScreenBtn: HTMLButtonElement;
  switchToHome: () => Promise<void>;
  toggleVoiceChannel: (channel: Channel) => Promise<boolean>;
  confirmSwitchCall: (targetChannelId: string) => Promise<boolean>;
  videoTilesPanel: HTMLDivElement;
  voiceClient: VoiceClient;
  voiceParticipants: Map<string, Set<string>>;
  readonly activeChannel: Channel | null;
  readonly activeDm: DmSummary | null;
  readonly chatHidden: boolean;
  readonly dms: DmSummary[];
}

export function createDmCall(ctx: DmCallContext) {
  const {
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
  } = ctx;

  // --- Outgoing ring (the caller's side) -------------------------------
  // Starting a call used to just... join voice, silently — nothing told
  // the caller anyone was being rung, or that the ringing had stopped
  // for any reason. Now the caller hears a distinct ring-back tone
  // (see `playOutgoingCallSound`) and the stage shows the person being
  // called as a dimmed, pulsing avatar, until they pick up, the caller
  // hangs up, or it's rung long enough (see `OUTGOING_RING_TIMEOUT_MS`).
  const OUTGOING_RING_TIMEOUT_MS = 45_000;
  let outgoingRing: { channelId: string; silence: () => void; stop: () => void } | null = null;
  /** Channels whose ring ran out with nobody answering — the stage
   * shows "No answer" instead of ringing forever. Cleared on hang-up. */
  const ringTimedOut = new Set<string>();
  /** Per channel: who declined the call being rung. Cleared when the
   * ring restarts or the call ends. */
  const callDeclined = new Map<string, Set<string>>();
  /** Set only by an explicit "start a call" action (see
   * `startDmCall`), never by joining an existing one — `onStateChange`
   * fires for every join *and* every internal rejoin (a camera toggle
   * rebuilds the connection), and neither of those should ring anyone
   * who's already on the call. Short-lived so a failed join (mic
   * permission denied) can't leave it armed for some later, unrelated
   * join. */
  let pendingOutgoingCall: { channelId: string; at: number; always?: boolean } | null = null;

  function startOutgoingRing(channelId: string): void {
    stopOutgoingRing();
    ringTimedOut.delete(channelId);
    callDeclined.delete(channelId);
    playOutgoingCallSound();
    const interval = window.setInterval(playOutgoingCallSound, 3000);
    const timeout = window.setTimeout(() => {
      stopOutgoingRing();
      // Only "No answer" if nobody at all picked up — in a group where
      // some did, the rest simply drop off the stage.
      const someoneJoined = [...(voiceParticipants.get(channelId) ?? [])].some((id) => id !== user.id);
      if (!someoneJoined) ringTimedOut.add(channelId);
      renderDmCallStage();
    }, OUTGOING_RING_TIMEOUT_MS);
    outgoingRing = {
      channelId,
      // The ring-back *sound* stops as soon as anyone answers, but in a
      // group the people who haven't yet stay shown as still-ringing
      // until the timeout — see the voice_state_update handler.
      silence: () => window.clearInterval(interval),
      stop: () => {
        window.clearInterval(interval);
        window.clearTimeout(timeout);
      },
    };
    renderDmCallStage();
  }

  function stopOutgoingRing(): void {
    outgoingRing?.stop();
    outgoingRing = null;
  }

  /** The one place a call is *started* (as opposed to joined): only
   * rings if nobody else is already on it. */
  function startDmCall(channel: Channel): void {
    if (voiceClient.currentChannelId !== channel.id) {
      const othersIn = [...(voiceParticipants.get(channel.id) ?? [])].some((id) => id !== user.id);
      pendingOutgoingCall = othersIn ? null : { channelId: channel.id, at: Date.now() };
    }
    void toggleVoiceChannel(channel).then((joined) => {
      // Said no to leaving the current call: nothing was started.
      if (!joined) pendingOutgoingCall = null;
    });
  }

  // --- The DM call stage -----------------------------------------------
  /** Who's currently making noise, by user id — kept outside the DOM
   * so a re-render (someone joins mid-sentence) doesn't drop a live
   * speaking ring. */
  const stageSpeaking = new Set<string>();

  function setStageSpeaking(userId: string, speaking: boolean): void {
    if (speaking) stageSpeaking.add(userId);
    else stageSpeaking.delete(userId);
    dmCallParticipants
      .querySelector(`.dm-call-participant[data-user-id="${userId}"]`)
      ?.classList.toggle("speaking", speaking);
  }

  /** The stage owns the call controls whenever it's on screen, so the
   * header's own copies (hang up, and on a phone mic/camera) step aside
   * via these classes instead of showing every control twice — see the
   * `.has-call-stage` rules in style.css. */
  function syncStageHeaderState(): void {
    const visible = !dmCallStage.hidden;
    channelHeader.classList.toggle("has-call-stage", visible);
    channelHeader.classList.toggle("stage-compact", visible && dmCallStage.classList.contains("compact"));
    dmCallStageHandle.hidden =
      !visible || dmCallStage.classList.contains("compact") || dmCallStage.classList.contains("fill");
  }

  function setStageStatus(text: string, animated = false): void {
    dmCallStatus.replaceChildren(document.createTextNode(text));
    if (animated) {
      const dots = document.createElement("span");
      dots.className = "dm-call-status-dots";
      dots.append(document.createElement("i"), document.createElement("i"), document.createElement("i"));
      dmCallStatus.appendChild(dots);
    }
    dmCallStatus.hidden = text === "";
  }

  function renderDmCallStage(): void {
    if (!ctx.activeDm || isSelfDm(ctx.activeDm)) {
      dmCallStage.hidden = true;
      syncStageHeaderState();
      return;
    }
    const dm = ctx.activeDm;
    const channelId = dm.channel.id;
    const youConnected = voiceClient.currentChannelId === channelId;
    const othersInCall = [...(voiceParticipants.get(channelId) ?? [])].filter((id) => id !== user.id);
    // Nothing to show until *someone* is on this call — you included.
    if (!youConnected && othersInCall.length === 0) {
      dmCallStage.hidden = true;
      syncStageHeaderState();
      return;
    }

    const ringing = outgoingRing?.channelId === channelId;
    const timedOut = ringTimedOut.has(channelId) && othersInCall.length === 0;
    const nameOf = (id: string): string =>
      id === user.id ? user.display_name : (knownUsers.get(id)?.display_name ?? "Someone");

    const present: string[] = youConnected ? [user.id, ...othersInCall] : othersInCall;
    // While ringing (or just after nobody answered), the people you
    // rang who aren't on the call yet are still shown — dimmed, so it
    // reads as "waiting on them" rather than them being absent.
    const declinedHere = callDeclined.get(channelId) ?? new Set<string>();
    const waitingOn =
      youConnected && (ringing || timedOut)
        ? dm.participants.filter((p) => p.id !== user.id && !present.includes(p.id))
        : [];

    const entries: { id: string; name: string; avatarFileId: string | null; state: string }[] = [
      ...present.map((id) => ({
        id,
        name: nameOf(id),
        avatarFileId:
          id === user.id
            ? user.avatar_file_id
            : (knownUsers.get(id)?.avatar_file_id ??
              dm.participants.find((p) => p.id === id)?.avatar_file_id ??
              null),
        state: "",
      })),
      ...waitingOn.map((p) => ({
        id: p.id,
        name: p.display_name,
        avatarFileId: p.avatar_file_id,
        state: declinedHere.has(p.id) ? "declined" : timedOut ? "missed" : "ringing",
      })),
    ];

    dmCallParticipants.replaceChildren(
      ...entries.map((entry) => {
        const wrap = document.createElement("div");
        wrap.className = "dm-call-participant";
        wrap.dataset.userId = entry.id;
        wrap.title = entry.name;
        if (entry.state) wrap.classList.add(entry.state);
        if (stageSpeaking.has(entry.id)) wrap.classList.add("speaking");
        const ring = document.createElement("div");
        ring.className = "dm-call-avatar";
        ring.appendChild(renderAvatarEl(entry.name, entry.avatarFileId));
        markMicProblem(wrap, entry.id, ring);
        const label = document.createElement("span");
        label.className = "dm-call-participant-name";
        label.textContent = entry.id === user.id ? "You" : entry.name;
        wrap.append(ring, label);
        return wrap;
      }),
    );

    if (!youConnected) {
      setStageStatus(
        `${othersInCall.map(nameOf).join(", ")} ${othersInCall.length === 1 ? "is" : "are"} in a call`,
      );
    } else if (
      othersInCall.length === 0 &&
      waitingOn.length > 0 &&
      waitingOn.every((p) => declinedHere.has(p.id))
    ) {
      setStageStatus(waitingOn.length === 1 ? "Declined" : "Everyone declined");
    } else if (ringing && othersInCall.length === 0) {
      setStageStatus("Ringing", true);
    } else if (timedOut) {
      setStageStatus("No answer");
    } else if (othersInCall.length === 0) {
      setStageStatus("Waiting for others to join", true);
    } else {
      setStageStatus("");
    }

    dmCallControlPill.hidden = !youConnected;
    stageHangupBtn.hidden = !youConnected;
    stageJoinBtn.hidden = youConnected;

    // Which of three shapes the stage takes, decided by what else is
    // competing for the screen: with video on show, it shrinks to a
    // slim bar (the tiles already show people); with no video and chat
    // hidden (a phone call, mostly) it claims everything left over,
    // like Discord's own mobile call screen; otherwise it's a
    // fixed-height panel above the chat.
    const videoVisible = !videoTilesPanel.hidden;
    dmCallStage.classList.toggle("compact", videoVisible);
    dmCallStage.classList.toggle("fill", !videoVisible && ctx.chatHidden);
    dmCallStage.hidden = false;
    syncStageHeaderState();
  }

  // --- Resizing the stage ---------------------------------------------
  // The stage's default height is just whatever its contents need; a
  // drag sets an explicit one (remembered across reloads), and below a
  // threshold it switches to a `tight` layout (smaller avatars, no name
  // labels, snugger spacing) so it can shrink well past the point the
  // roomy layout would start clipping its own controls.
  const DM_CALL_STAGE_HEIGHT_KEY = "chatty:dmCallStageHeight";
  const DM_CALL_STAGE_MIN_HEIGHT = 190;
  const DM_CALL_STAGE_TIGHT_BELOW = 310;

  function applyDmCallStageHeight(px: number | null): void {
    if (px === null) {
      dmCallStage.style.removeProperty("--dm-call-stage-height");
      dmCallStage.style.removeProperty("--dm-call-avatar-size");
      dmCallStage.classList.remove("tight");
      return;
    }
    const tight = px < DM_CALL_STAGE_TIGHT_BELOW;
    dmCallStage.style.setProperty("--dm-call-stage-height", `${px}px`);
    dmCallStage.style.setProperty(
      "--dm-call-avatar-size",
      `${Math.max(44, Math.min(96, px - (tight ? 130 : 240)))}px`,
    );
    dmCallStage.classList.toggle("tight", tight);
  }

  const savedDmCallStageHeight = Number(localStorage.getItem(DM_CALL_STAGE_HEIGHT_KEY));
  if (savedDmCallStageHeight >= DM_CALL_STAGE_MIN_HEIGHT) {
    applyDmCallStageHeight(savedDmCallStageHeight);
  }

  function startDmCallStageDrag(startY: number): void {
    const startHeight = dmCallStage.getBoundingClientRect().height;
    // Always leave the conversation some room — the header plus a
    // usable slice of chat.
    const maxHeight = Math.max(
      DM_CALL_STAGE_MIN_HEIGHT,
      mainColumn.getBoundingClientRect().height - channelHeader.getBoundingClientRect().height - 140,
    );
    dmCallStageHandle.classList.add("dragging");

    const apply = (y: number): void => {
      const next = Math.min(maxHeight, Math.max(DM_CALL_STAGE_MIN_HEIGHT, startHeight + (y - startY)));
      applyDmCallStageHeight(Math.round(next));
    };
    const finish = (): void => {
      dmCallStageHandle.classList.remove("dragging");
      localStorage.setItem(
        DM_CALL_STAGE_HEIGHT_KEY,
        String(Math.round(dmCallStage.getBoundingClientRect().height)),
      );
    };
    const onMouseMove = (e: MouseEvent): void => apply(e.clientY);
    const onMouseUp = (): void => {
      finish();
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
    const onTouchMove = (e: TouchEvent): void => {
      const touch = e.touches[0];
      if (touch) apply(touch.clientY);
    };
    const onTouchEnd = (): void => {
      finish();
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("touchmove", onTouchMove);
    window.addEventListener("touchend", onTouchEnd);
    window.addEventListener("touchcancel", onTouchEnd);
  }

  dmCallStageHandle.addEventListener("mousedown", (e) => {
    e.preventDefault();
    startDmCallStageDrag(e.clientY);
  });
  dmCallStageHandle.addEventListener(
    "touchstart",
    (e) => {
      const touch = e.touches[0];
      if (!touch) return;
      e.preventDefault();
      startDmCallStageDrag(touch.clientY);
    },
    { passive: false },
  );
  // A double-click snaps back to the default, content-sized height.
  dmCallStageHandle.addEventListener("dblclick", () => {
    applyDmCallStageHeight(null);
    localStorage.removeItem(DM_CALL_STAGE_HEIGHT_KEY);
  });

  stageMuteBtn.addEventListener("click", () => handleToggleMute());
  stageDeafenBtn.addEventListener("click", () => handleToggleDeafen());
  stageCameraBtn.addEventListener("click", () => handleToggleCamera());
  stageScreenBtn.addEventListener("click", () => handleToggleScreen());
  stageHangupBtn.addEventListener("click", () => handleLeaveVoice());
  stageJoinBtn.addEventListener("click", () => {
    if (ctx.activeDm) void toggleVoiceChannel(ctx.activeDm.channel);
  });

  dmCallBtn.addEventListener("click", () => {
    if (ctx.activeChannel) startDmCall(ctx.activeChannel);
  });

  // Someone calling a DM previously just... joined voice, with nothing
  // telling the other person at all — they'd only ever notice if they
  // happened to already be looking at that exact conversation. This
  // is the fix: a real incoming-call card, driven off the same
  // `voice_state_update` event a guild's voice-participant list
  // already uses, just applied to DM channels too.
  let incomingCall: { channelId: string; callerId: string; dismiss: () => void } | null = null;

  function showIncomingCall(dm: DmSummary, callerId: string): void {
    // Already showing one (from this same caller, most likely, since
    // a `connected` event can in principle repeat) — don't stack a
    // second banner or restart the ring.
    // In a group call every *later* joiner fires this too — the card
    // keeps naming whoever rang first rather than flipping to each
    // person who picks up after them.
    if (incomingCall && incomingCall.channelId === dm.channel.id) {
      return;
    }
    incomingCall?.dismiss();

    const caller = knownUsers.get(callerId) ?? dm.participants.find((p) => p.id === callerId);
    const callerName = caller?.display_name ?? "Someone";
    const banner = document.createElement("div");
    banner.className = "incoming-call-banner";
    banner.setAttribute("role", "alertdialog");
    banner.setAttribute("aria-live", "assertive");

    const avatar = document.createElement("div");
    avatar.className = "incoming-call-avatar";
    avatar.appendChild(renderAvatarEl(callerName, caller?.avatar_file_id ?? null));

    const text = document.createElement("div");
    text.className = "incoming-call-text";
    const who = document.createElement("strong");
    who.textContent = callerName;
    const sub = document.createElement("span");
    // A group call names the conversation too — "Sam" alone doesn't
    // say which of several shared group DMs is ringing.
    sub.textContent = dm.participants.length > 1 ? `Incoming call · ${dmLabel(dm)}` : "Incoming call…";
    text.append(who, sub);

    const declineBtn = document.createElement("button");
    declineBtn.type = "button";
    declineBtn.className = "incoming-call-btn decline";
    declineBtn.title = "Decline";
    declineBtn.appendChild(icon("phone-off", 20));
    const answerBtn = document.createElement("button");
    answerBtn.type = "button";
    answerBtn.className = "incoming-call-btn answer";
    answerBtn.title = "Answer";
    answerBtn.appendChild(icon("phone", 20));

    banner.append(avatar, text, declineBtn, answerBtn);
    document.body.appendChild(banner);

    playIncomingCallSound();
    void notify({
      title: `${callerName} is calling`,
      body: dm.participants.length > 1 ? dmLabel(dm) : "Incoming call",
      tag: `call-${dm.channel.id}`,
      data: { channelId: dm.channel.id },
    });
    const ringTimer = window.setInterval(playIncomingCallSound, 2000);
    // A call that's never answered shouldn't ring forever — matches
    // how a real phone call eventually gives up.
    const autoDismissTimer = window.setTimeout(() => dismiss(), 30_000);

    function dismiss(): void {
      window.clearInterval(ringTimer);
      window.clearTimeout(autoDismissTimer);
      banner.remove();
      if (incomingCall?.dismiss === dismiss) incomingCall = null;
    }

    answerBtn.addEventListener("click", () => {
      // Answering while on another call asks first; saying no leaves the
      // card up (it still rings) so it can be answered after all.
      void confirmSwitchCall(dm.channel.id).then((ok) => {
        if (!ok) return;
        dismiss();
        void switchToHome().then(() => {
          selectDm(dm);
          void voiceClient.join(dm.channel.id);
        });
      });
    });
    declineBtn.addEventListener("click", () => {
      dismiss();
      // Tell the caller, so they see "Declined" rather than ringing on.
      void api.post(`/api/dms/${dm.channel.id}/call/decline`).catch(() => {});
    });

    incomingCall = { channelId: dm.channel.id, callerId, dismiss };
  }

  /** The call this card is for moved elsewhere (see `dm_call_moved`). */
  function dismissIncomingCallFor(channelId: string): void {
    if (incomingCall?.channelId === channelId) incomingCall.dismiss();
  }

  function dismissIncomingCallIfFrom(channelId: string, callerId: string): void {
    if (incomingCall && incomingCall.channelId === channelId && incomingCall.callerId === callerId) {
      incomingCall.dismiss();
    }
  }

  return {
    callDeclined,
    dismissIncomingCallFor,
    dismissIncomingCallIfFrom,
    get outgoingRing() {
      return outgoingRing;
    },
    set outgoingRing(value: { channelId: string; silence: () => void; stop: () => void } | null) {
      outgoingRing = value;
    },
    get pendingOutgoingCall() {
      return pendingOutgoingCall;
    },
    set pendingOutgoingCall(value: { channelId: string; at: number; always?: boolean } | null) {
      pendingOutgoingCall = value;
    },
    renderDmCallStage,
    ringTimedOut,
    setStageSpeaking,
    showIncomingCall,
    stageSpeaking,
    startOutgoingRing,
    stopOutgoingRing,
  };
}
