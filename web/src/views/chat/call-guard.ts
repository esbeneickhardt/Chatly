// Asking before leaving one call for another.

import { confirmDialog } from "../../ui";
import { type VoiceClient } from "../../voice";
import type { ChatState } from "./state";

export function createCallGuard(deps: { state: ChatState; voiceClient: VoiceClient }) {
  const { state, voiceClient } = deps;

  /** Words for a call, for the question: a chat's call is named by who is in
   * it, a server's by its voice channel. */
  function describeCall(channelId: string): string {
    const dm = state.dms.find((d) => d.channel.id === channelId);
    if (dm) {
      const names = dm.participants.map((p) => p.display_name).join(", ");
      return names ? `a call with ${names}` : "a call with yourself";
    }
    const channel = state.currentChannels.find((c) => c.id === channelId);
    return channel ? `the voice channel "${channel.name}"` : "another call";
  }

  /** True if it is fine to join `targetChannelId`: you are not on a call, or
   * you are on that one, or you said yes to leaving the one you are on.
   * Ask this before every join you start yourself. (Not before a call
   * follows a conversation into a new group: that is the same call.) */
  async function confirmSwitchCall(targetChannelId: string): Promise<boolean> {
    const current = voiceClient.currentChannelId;
    // A call that has failed or dropped is not one worth asking about.
    if (current === null || current === targetChannelId || !voiceClient.isConnectionHealthy) return true;
    return confirmDialog({
      title: "Leave your current call?",
      message: `You're in ${describeCall(current)}. Leave it and join ${describeCall(targetChannelId)}?`,
      confirmLabel: "Switch call",
    });
  }

  return { confirmSwitchCall, describeCall };
}

export type CallGuard = ReturnType<typeof createCallGuard>;
