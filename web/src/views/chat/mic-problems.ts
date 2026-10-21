// Who in a call can't be heard because of their own microphone (see
// `MicProblem` in voice/client.ts and gateway op 13), shown as a red
// mic on their avatar everywhere they appear in a call, and your own
// warning banner with the way to fix it.

import { icon } from "../../icons";
import { type MicProblem, type VoiceClient } from "../../voice";

const withProblem = new Set<string>();

/** The places a call participant is drawn, by user id. */
function participantEls(userId: string): NodeListOf<HTMLElement> {
  const id = CSS.escape(userId);
  return document.querySelectorAll<HTMLElement>(
    `.voice-participant[data-user-id="${id}"], .dm-call-participant[data-user-id="${id}"]`,
  );
}

export function setMicProblem(userId: string, problem: boolean): void {
  if (problem) withProblem.add(userId);
  else withProblem.delete(userId);
  for (const el of participantEls(userId)) el.classList.toggle("mic-problem", problem);
}

/** For a renderer drawing `userId` into `el`: the badge (shown only
 * while `el` has `.mic-problem`) and the current state. */
export function markMicProblem(el: HTMLElement, userId: string, badgeHost: HTMLElement = el): void {
  el.classList.toggle("mic-problem", withProblem.has(userId));
  const badge = document.createElement("span");
  badge.className = "mic-problem-badge";
  badge.title = "Can't be heard: microphone problem";
  badge.setAttribute("aria-label", badge.title);
  badge.appendChild(icon("mic-off", 12));
  badgeHost.appendChild(badge);
}

const MESSAGES: Record<MicProblem, string> = {
  blocked: "Microphone blocked. Nobody can hear you.",
  stopped: "Your microphone stopped. Nobody can hear you.",
  silent: "No sound from your microphone. Nobody can hear you.",
  paused: "Tap to turn on your microphone.",
};

/** Your own warning: stays up for as long as the problem lasts. */
export function createMicBanner(voiceClient: VoiceClient): (problem: MicProblem | null) => void {
  const banner = document.createElement("div");
  banner.className = "mic-problem-banner";
  banner.setAttribute("role", "alert");
  const text = document.createElement("span");
  text.className = "mic-problem-banner-text";
  const button = document.createElement("button");
  button.type = "button";
  banner.append(icon("mic-off", 16), text, button);

  let current: MicProblem | null = null;
  button.addEventListener("click", async () => {
    button.disabled = true;
    const ok = await voiceClient.retryMic();
    button.disabled = false;
    if (!ok && current === "blocked") {
      text.textContent = "Still blocked. Allow the microphone for this site in the browser, then try again.";
    }
  });

  return (problem) => {
    current = problem;
    if (!problem) {
      banner.remove();
      return;
    }
    text.textContent = MESSAGES[problem];
    button.textContent = problem === "paused" ? "Turn on" : "Try again";
    if (!banner.isConnected) document.body.appendChild(banner);
  };
}
