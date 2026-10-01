// Offer/answer bookkeeping for the one peer connection, and the three
// outgoing slots (camera, screen video, screen audio) that come and go.
//
// Turning the camera or a screen share on or off changes the live
// connection in place: a slot's transceiver is reused (its track swapped, its
// direction flipped) and a new offer is sent flagged as a renegotiation, so
// the microphone, everyone else's audio and every remote video carry on
// untouched. The server also makes offers of its own (when someone else
// starts a stream), so the two sides can offer at the same moment. The server
// always wins that collision: the client accepts the server's offer (which
// rolls back its own) and then offers again.

import { addSendTransceiver, screenSendEncoding } from "./util";

/** How long a renegotiation offer may go unanswered before we give up on it
 * and rebuild the connection from scratch. */
const ANSWER_TIMEOUT_MS = 8000;

type Slot = "camera" | "screenVideo" | "screenAudio";

export interface SignalingOptions {
  pc: RTCPeerConnection;
  /** Sends an SDP message to the server. `purposes` maps a media line's mid
   * to "camera" or "screen"; `renegotiate` marks an offer that changes a
   * connection that stays up. */
  send: (sdp: RTCSessionDescriptionInit, purposes: Record<string, string>, renegotiate: boolean) => void;
  /** Called when negotiation is stuck or failed: rebuild the connection. */
  recover: () => void;
}

export class Signaling {
  private readonly pc: RTCPeerConnection;
  private readonly sendSdp: SignalingOptions["send"];
  private readonly recover: () => void;
  private readonly slots: Record<Slot, RTCRtpTransceiver | null> = {
    camera: null,
    screenVideo: null,
    screenAudio: null,
  };
  /** Everything runs one after another, so an offer being made never
   * interleaves with an answer being applied. */
  private queue: Promise<void> = Promise.resolve();
  private offerAgain = false;
  private answerTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(options: SignalingOptions) {
    this.pc = options.pc;
    this.sendSdp = options.send;
    this.recover = options.recover;
  }

  /** Sets what is being sent. Adds, re-uses or silences the slots as needed;
   * does not send anything by itself. */
  async setSendTracks(camera: MediaStream | null, screen: MediaStream | null): Promise<void> {
    await this.syncSlot("camera", camera?.getVideoTracks()[0] ?? null, camera);
    await this.syncSlot("screenVideo", screen?.getVideoTracks()[0] ?? null, screen);
    await this.syncSlot("screenAudio", screen?.getAudioTracks()[0] ?? null, screen);
  }

  private async syncSlot(
    slot: Slot,
    track: MediaStreamTrack | null,
    stream: MediaStream | null,
  ): Promise<void> {
    const transceiver = this.slots[slot];
    if (track && stream) {
      const encoding = slot === "camera" ? null : screenSendEncoding(track);
      if (!transceiver) {
        this.slots[slot] = addSendTransceiver(this.pc, track, {
          direction: "sendonly",
          streams: [stream],
          ...(encoding ? { sendEncodings: [encoding] } : {}),
        });
        return;
      }
      await transceiver.sender.replaceTrack(track);
      transceiver.direction = "sendonly";
      if (encoding) {
        const params = transceiver.sender.getParameters();
        params.encodings = [{ ...params.encodings[0], ...encoding }];
        await transceiver.sender.setParameters(params).catch(() => undefined);
      }
    } else if (transceiver) {
      await transceiver.sender.replaceTrack(null);
      transceiver.direction = "inactive";
    }
  }

  private purposes(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [slot, transceiver] of Object.entries(this.slots) as [Slot, RTCRtpTransceiver | null][]) {
      if (transceiver?.mid && transceiver.sender.track) {
        out[transceiver.mid] = slot === "camera" ? "camera" : "screen";
      }
    }
    return out;
  }

  /** The first offer of a join (a fresh connection on the server too). */
  async firstOffer(): Promise<void> {
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    this.sendSdp(offer, this.purposes(), false);
  }

  /** Tells the server about a change to what is being sent. */
  offer(): Promise<void> {
    return this.enqueue(() => this.renegotiate());
  }

  /** The server's offer or answer arrived. */
  handleRemote(sdp: RTCSessionDescriptionInit): Promise<void> {
    return this.enqueue(async () => {
      if (sdp.type === "answer") {
        await this.pc.setRemoteDescription(sdp);
        this.clearAnswerTimer();
        if (this.offerAgain) await this.renegotiate();
        return;
      }
      // Our own offer (if any) is rolled back by the browser when the
      // server's arrives; it goes out again once this one is answered.
      if (this.pc.signalingState === "have-local-offer") {
        this.offerAgain = true;
        this.clearAnswerTimer();
      }
      await this.pc.setRemoteDescription(sdp);
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      this.sendSdp(answer, {}, false);
      if (this.offerAgain) await this.renegotiate();
    });
  }

  close(): void {
    this.closed = true;
    this.clearAnswerTimer();
  }

  private async renegotiate(): Promise<void> {
    if (this.closed) return;
    if (this.pc.signalingState !== "stable") {
      this.offerAgain = true;
      return;
    }
    this.offerAgain = false;
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    this.sendSdp(offer, this.purposes(), true);
    this.clearAnswerTimer();
    this.answerTimer = setTimeout(() => {
      console.log("[voice] renegotiation offer was not answered, rejoining");
      this.recover();
    }, ANSWER_TIMEOUT_MS);
  }

  private clearAnswerTimer(): void {
    if (this.answerTimer !== null) {
      clearTimeout(this.answerTimer);
      this.answerTimer = null;
    }
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const run = this.queue.then(task).catch((err) => {
      console.log("[voice] negotiation failed, rejoining to recover", err);
      this.recover();
    });
    this.queue = run;
    return run;
  }
}
