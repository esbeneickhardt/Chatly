// The elements of the DM call stage: participant avatars, status line and
// the control buttons. The behaviour that drives them is in `dm-call.ts`.

import { icon } from "../../icons";

export function createStageDom() {
  // The DM call "stage" — a Discord-style panel that owns everything
  // about being in (or about to join) a DM call: big avatars for who's
  // in it (ringing ones dimmed and pulsing while you wait for them to
  // pick up, a green ring on whoever's talking), a status line, and
  // the call controls. This replaces a thin "🔊 In this call" bar
  // that read as a stray banner rather than a call, gave the caller
  // nothing to look at while waiting, and left the controls tucked in
  // the sidebar footer. See `renderDmCallStage`.
  const dmCallParticipants = document.createElement("div");
  dmCallParticipants.className = "dm-call-participants";

  const dmCallStatus = document.createElement("div");
  dmCallStatus.className = "dm-call-status";

  const dmCallCenter = document.createElement("div");
  dmCallCenter.className = "dm-call-center";
  dmCallCenter.append(dmCallParticipants, dmCallStatus);

  function makeStageButton(
    iconName: Parameters<typeof icon>[0],
    title: string,
    extraClass = "",
  ): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `dm-call-control ${extraClass}`.trim();
    btn.title = title;
    btn.appendChild(icon(iconName, 20));
    return btn;
  }
  const stageMuteBtn = makeStageButton("mic", "Mute microphone");
  // Muting only ever stops *your own* mic — it can't do anything about
  // two nearby devices' speakers and mics acoustically coupling, which
  // is what actually causes an echo when two people on the same call
  // sit close together without headphones. Deafening silences the
  // nearby *speaker* too, which is the real fix — the tip that used to
  // live in a paragraph under the old call banner, now where someone
  // reaching for the button will actually see it.
  const stageDeafenBtn = makeStageButton(
    "headphones",
    "Deafen — also silences your speaker. Hearing an echo? Muting only stops your mic; deafening (or headphones) stops the nearby speaker their mic is picking up.",
  );
  const stageCameraBtn = makeStageButton("video", "Turn on camera");
  const stageScreenBtn = makeStageButton("monitor", "Share your screen");
  if (typeof navigator.mediaDevices.getDisplayMedia !== "function") {
    stageScreenBtn.hidden = true;
  }
  const stageHangupBtn = makeStageButton("phone-off", "Leave call", "hangup");

  const dmCallControlPill = document.createElement("div");
  dmCallControlPill.className = "dm-call-control-pill";
  dmCallControlPill.append(stageMuteBtn, stageDeafenBtn, stageCameraBtn, stageScreenBtn);

  const stageJoinBtn = document.createElement("button");
  stageJoinBtn.type = "button";
  stageJoinBtn.className = "dm-call-join";
  stageJoinBtn.append(icon("phone", 18), document.createTextNode("Join Call"));

  const dmCallControls = document.createElement("div");
  dmCallControls.className = "dm-call-controls";
  dmCallControls.append(dmCallControlPill, stageHangupBtn, stageJoinBtn);

  const dmCallStage = document.createElement("div");
  dmCallStage.className = "dm-call-stage";
  dmCallStage.hidden = true;
  dmCallStage.append(dmCallCenter, dmCallControls);

  // The divider between the call stage and the conversation below it —
  // drag to trade space between them (see `wireDmCallStageResize`).
  const dmCallStageHandle = document.createElement("div");

  return {
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
  };
}

export type StageDomParts = ReturnType<typeof createStageDom>;
