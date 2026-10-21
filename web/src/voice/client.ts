// The voice client: the peer connection to the SFU, joining and leaving,
// camera and screen share, reconnecting. Playback of other people's audio
// lives in `remote-audio.ts` and the local microphone in `local-mic.ts`.

import { loadAudioPrefs, saveAudioPrefs } from "../audio-prefs";
import type { GatewayClient, VoiceServerUpdate } from "../gateway";
import { LocalMic } from "./local-mic";
import { MicStatus, type MicProblem } from "./mic-status";
import { RemoteAudio } from "./remote-audio";
import { RemoteVideo } from "./remote-video";
import { ConnectionWatch } from "./connection-watch";
import { captureScreen } from "./screen-capture";
import { Signaling } from "./signaling";
import {
  MAX_REMOTE_VOLUME,
  addSendTransceiver,
  VOICE_ENCODING,
  getIceServers,
  inputConstraints,
} from "./util";

/** Manages one voice-channel connection: local mic capture, the
 * RTCPeerConnection to the server's SFU, and remote audio playback.
 * Signaling rides the existing gateway WebSocket (op 4 /
 * VOICE_SERVER_UPDATE) rather than a separate channel — see
 * `docs/protocol.md`. ICE servers (see `getIceServers`) are a TURN
 * relay fallback for when the SFU's own advertised host/reflexive
 * candidates aren't enough to traverse both sides' NATs. */
export class VoiceClient {
  private gateway: GatewayClient;
  private readonly remoteAudio = new RemoteAudio({
    isDeafened: () => this.deafened,
    onSpeakingChange: (userId, speaking) => this.onRemoteSpeakingChange?.(userId, speaking),
    onScreenAudioChange: (userId, active) => this.onRemoteScreenAudioChange?.(userId, active),
  });
  private readonly mic = new LocalMic({
    isMuted: () => this.muted,
    onSpeakingChange: (speaking) => this.onSpeakingChange?.(speaking),
    onHealthChange: (health) => this.micStatus.setHealth(health),
  });
  private readonly micStatus = new MicStatus({
    inCall: () => this.channelId !== null,
    send: (problem) => this.gateway.sendMicProblem(problem),
    onChange: (problem) => this.onMicProblemChange?.(problem),
  });
  private pc: RTCPeerConnection | null = null;
  private signaling: Signaling | null = null;
  private localStream: MediaStream | null = null;
  private channelId: string | null = null;
  private readonly remoteVideo = new RemoteVideo({
    onChange: (userId, purpose, el) => this.onRemoteVideo?.(userId, purpose, el),
  });
  private muted = false;
  private deafened = false;
  /** Camera and screen share are independent now — both can be active
   * at once. Each offer tags its own video mids by purpose (see
   * `join`'s `video_purposes`) so the SFU can forward them under
   * distinguishable stream ids for every remote peer. */
  private cameraStream: MediaStream | null = null;
  private screenStream: MediaStream | null = null;
  private readonly connection = new ConnectionWatch({
    isCurrent: (pc) => this.pc === pc,
    onReconnecting: (reconnecting) => this.onReconnecting?.(reconnecting),
    onError: (message) => this.onError?.(message),
    leave: () => this.leave(),
  });

  onStateChange?: (connected: boolean, channelId: string | null) => void;
  onError?: (message: string) => void;
  /** Fires `true` when the connection drops into "disconnected" or
   * "failed" and we're giving it a grace period to recover (see
   * `RECONNECT_GRACE_MS`) rather than hanging up immediately, and
   * `false` either once it recovers or once the grace period expires
   * and the call actually ends. Lets the UI show a "Reconnecting…" cue
   * instead of the call just silently sitting there (or, before this
   * existed, instantly vanishing). */
  onReconnecting?: (reconnecting: boolean) => void;
  /** Fires whenever the local mic's detected speech-activity state
   * changes, so the UI can show a "you're talking" indicator — there's
   * no server-side speaking detection yet (PLAN.md 4.2), so this is
   * purely a local, client-side cue. */
  onSpeakingChange?: (speaking: boolean) => void;
  /** Fires with your own camera or screen-share stream when it starts,
   * and with `null` when it stops (including the browser's own native
   * "Stop sharing" control ending a screen share) — so the UI can
   * show/hide a self-preview tile. Camera and screen fire
   * independently of each other. */
  onLocalVideo?: (purpose: "camera" | "screen", stream: MediaStream | null) => void;
  /** Fires with a ready-to-mount `<video>` element for a remote
   * participant's camera or screen-share video, and with `null` when
   * that one stops — `userId` is the same id used everywhere else in
   * the app. Camera and screen fire independently, so a participant
   * sharing both fires this twice (once per purpose). */
  onRemoteVideo?: (userId: string, purpose: "camera" | "screen", el: HTMLVideoElement | null) => void;
  /** Fires when a remote participant's screen share starts or stops
   * carrying audio (mic audio is tied to the call itself, not to a
   * screen share, so this only ever concerns the "screen" purpose) —
   * lets the UI show/hide an independent volume control for it. */
  onRemoteScreenAudioChange?: (userId: string, active: boolean) => void;
  /** Fires when a remote participant starts/stops talking, detected
   * client-side from their incoming mic audio (there's no server-side
   * speaking detection) — lets the UI ring their avatar the way
   * `onSpeakingChange` already does for your own. */
  onRemoteSpeakingChange?: (userId: string, speaking: boolean) => void;
  /** Fires when your mic stops (or starts) reaching the others in the
   * call — see `MicProblem`. The others are told too (gateway op 13). */
  onMicProblemChange?: (problem: MicProblem | null) => void;

  constructor(gateway: GatewayClient) {
    this.gateway = gateway;
    gateway.on("voice_server_update", (data) => {
      void this.handleServerUpdate(data);
    });

    // A phone screen turning off for a while routinely suspends its
    // WiFi/cellular radio entirely, which leaves `pc.connectionState`
    // sitting in "disconnected"/"failed" — no candidates flowing for
    // either side to renegotiate on their own — for exactly the same
    // reason `GatewayClient` needs its own visibility-triggered
    // reconnect (see there). Waiting out the rest of
    // `RECONNECT_GRACE_MS` only to hang up anyway isn't the right call
    // once the person is actually back looking at the call: rejoin
    // immediately instead, the same full rebuild `join()` already does
    // for a plain camera/screen toggle (it preserves the still-live
    // camera/screen streams — only the peer connection itself gets
    // torn down and renegotiated from scratch).
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") return;
      if (!this.channelId || !this.pc) return;
      if (this.pc.connectionState === "disconnected" || this.pc.connectionState === "failed") {
        this.connection.clearReconnectTimer();
        void this.join(this.channelId);
      }
    });
  }

  get currentChannelId(): string | null {
    return this.channelId;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  get isDeafened(): boolean {
    return this.deafened;
  }

  get currentMicProblem(): MicProblem | null {
    return this.micStatus.current;
  }

  /** Tells the others in the call again (someone new joined). */
  reannounceMicProblem(): void {
    this.micStatus.reannounce();
  }

  private watchMicTrack(stream: MediaStream): void {
    this.micStatus.watchTrack(stream, () => this.localStream === stream);
  }

  /** Asks for the microphone again mid-call (the "Try again" on the
   * warning), and plugs it in without rejoining. Must run from a tap,
   * so the browser may prompt and may let a paused graph start. */
  async retryMic(): Promise<boolean> {
    this.mic.resume();
    if (!this.channelId) return false;
    if (this.micStatus.onlyPaused) return true;
    let stream: MediaStream;
    try {
      const prefs = loadAudioPrefs();
      stream = await navigator.mediaDevices.getUserMedia({
        audio: inputConstraints(prefs.inputDeviceId, prefs.noiseFilter),
      });
    } catch {
      return false;
    }
    await this.replaceMic(stream);
    return true;
  }

  /** Puts `newStream` in place of the current mic (if any) in a live call. */
  private async replaceMic(newStream: MediaStream): Promise<void> {
    const newTrack = newStream.getAudioTracks()[0];
    if (!newTrack || !this.pc) {
      newStream.getTracks().forEach((t) => t.stop());
      return;
    }
    newTrack.enabled = !this.muted;
    if (!this.mic.rewire(newStream)) {
      // No AudioContext (buildInputGraph's fallback) — the sender
      // holds the raw device track directly, so swap it there instead.
      const sender = this.pc.getSenders().find((s) => s.track?.kind === "audio");
      await sender?.replaceTrack(newTrack);
    }
    this.localStream?.getAudioTracks().forEach((track) => track.stop());
    this.localStream = newStream;
    this.watchMicTrack(newStream);
    this.mic.stopSpeakingDetection();
    this.mic.startSpeakingDetection(newStream);
    this.micStatus.setTrackProblem(null);
  }

  get hasLocalCamera(): boolean {
    return this.cameraStream !== null;
  }

  get hasLocalScreenShare(): boolean {
    return this.screenStream !== null;
  }

  async join(channelId: string): Promise<void> {
    const wasConnected = this.channelId !== null;
    // `false, false`: a rejoin (channel switch, or toggling
    // camera/screen — see setVideo) shouldn't drop an already-active
    // local video stream just because the underlying peer connection
    // is being rebuilt from scratch, and shouldn't announce a
    // departure either — the offer sent below announces the real
    // transition on its own (see `leave`'s `notifyLeave` doc).
    this.leave(false, false);
    this.channelId = channelId;

    const hasAudioGraph = Boolean(
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext,
    );
    try {
      const prefs = loadAudioPrefs();
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: inputConstraints(prefs.inputDeviceId, prefs.noiseFilter),
      });
      this.micStatus.noteTrackProblem(null);
    } catch {
      // Join anyway, listening only: the warning (and everyone else's
      // view of you) says why nobody can hear you, and "Try again"
      // plugs a mic in mid-call. Only a browser with no Web Audio at all
      // has no empty track to send, and still has to give up.
      this.localStream = null;
      this.micStatus.noteTrackProblem("blocked");
    }
    if (!this.localStream && !hasAudioGraph) {
      this.micStatus.noteTrackProblem(null);
      this.channelId = null;
      // The suppressed leave above means the UI wasn't told we
      // dropped out of the old channel yet — if this rejoin was one
      // (not a fresh join with nothing to lose), it needs to hear it
      // now, since there won't be a follow-up offer to do it instead.
      if (wasConnected) this.onStateChange?.(false, channelId);
      this.onError?.("Couldn't access your microphone. Check browser permissions.");
      return;
    }

    this.mic.buildInputGraph(this.localStream);
    if (this.localStream) this.watchMicTrack(this.localStream);

    const iceServers = await getIceServers();
    const pc = new RTCPeerConnection({ iceServers });
    this.pc = pc;

    // `sendonly`, not `addTrack`'s default `sendrecv`: the SFU never sends
    // on a client's own upload line, but a negotiated "recv" capability
    // still makes the browser fire a local `ontrack`, which showed up as a
    // phantom "Someone" tile for your own camera or screen.
    // The transceiver carries `processedStream`'s (post-gain) track,
    // not the raw device track directly — `buildInputGraph` set
    // `processedStream` up just above. `track.enabled` is still toggled
    // on the *raw* track: a disabled/muted MediaStreamTrack feeding a
    // `MediaStreamAudioSourceNode` produces silence, so mute keeps
    // working straight through the gain graph.
    for (const track of this.localStream?.getAudioTracks() ?? []) {
      track.enabled = !this.muted;
    }
    const sendStream = this.mic.processedStream ?? this.localStream;
    for (const track of sendStream?.getAudioTracks() ?? []) {
      track.contentHint = "speech";
      addSendTransceiver(pc, track, {
        direction: "sendonly",
        streams: sendStream ? [sendStream] : [],
        sendEncodings: [VOICE_ENCODING],
      });
    }
    const signaling = new Signaling({
      pc,
      send: (sdp, purposes, renegotiate) =>
        this.gateway.sendVoiceState(channelId, sdp, purposes, renegotiate),
      recover: () => {
        if (this.pc === pc && this.channelId) void this.join(this.channelId);
      },
    });
    this.signaling = signaling;
    await signaling.setSendTracks(this.cameraStream, this.screenStream);

    pc.addEventListener("track", (event) => this.attachRemoteTrack(event));
    pc.addEventListener("connectionstatechange", () => {
      console.log(`[voice] connectionState -> ${pc.connectionState}`);
      this.connection.stateChanged(pc);
    });
    pc.addEventListener("iceconnectionstatechange", () => {
      console.log(`[voice] iceConnectionState -> ${pc.iceConnectionState}`);
    });

    await signaling.firstOffer();
    this.connection.watchFirstConnection(pc);
    this.onStateChange?.(true, channelId);
    this.mic.startSpeakingDetection(this.localStream);
    // A fresh offer told everyone you joined; tell them about the mic
    // too, and show it locally.
    this.micStatus.announceAfresh();
  }

  /** Turns your camera on/off. Independent of screen share — both can
   * be on at once; the UI shows the camera as a small overlay on top
   * of the screen share in that case. */
  async toggleCamera(): Promise<void> {
    if (this.cameraStream) {
      await this.setCameraStream(null);
      return;
    }
    let stream: MediaStream;
    try {
      // `facingMode: "user"` (front camera) as a preference, not a hard
      // `exact` requirement — a phone with no front camera, or a plain
      // webcam with no concept of "front/back" at all, still gets
      // *a* camera instead of failing outright. Bare `video: true`
      // worked fine in testing, but an explicit facing mode is the
      // documented, more mobile-reliable way to ask for a camera.
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
    } catch {
      this.onError?.("Couldn't access your camera. Check browser permissions.");
      return;
    }
    const track = stream.getVideoTracks()[0];
    track?.addEventListener("ended", () => {
      console.log("[voice] camera track ended (browser/OS revoked or device lost)");
      if (this.cameraStream === stream) void this.setCameraStream(null);
    });
    track?.addEventListener("mute", () => console.log("[voice] camera track muted"));
    track?.addEventListener("unmute", () => console.log("[voice] camera track unmuted"));
    await this.setCameraStream(stream);
  }

  /** Turns screen sharing on/off. Independent of the camera — see
   * `toggleCamera`. */
  async toggleScreenShare(): Promise<void> {
    if (this.screenStream) {
      await this.setScreenStream(null);
      return;
    }
    const stream = await captureScreen((message) => this.onError?.(message));
    if (!stream) return;
    // The browser's own "Stop sharing" bar can end this without going
    // through toggleScreenShare — make sure that still turns it off
    // cleanly on our end too.
    stream.getVideoTracks()[0]?.addEventListener("ended", () => {
      if (this.screenStream === stream) void this.setScreenStream(null);
    });
    await this.setScreenStream(stream);
  }

  private async setCameraStream(newStream: MediaStream | null): Promise<void> {
    this.cameraStream?.getTracks().forEach((track) => track.stop());
    this.cameraStream = newStream;
    this.onLocalVideo?.("camera", newStream);
    await this.renegotiateVideo();
  }

  private async setScreenStream(newStream: MediaStream | null): Promise<void> {
    this.screenStream?.getTracks().forEach((track) => track.stop());
    this.screenStream = newStream;
    this.onLocalVideo?.("screen", newStream);
    await this.renegotiateVideo();
  }

  /** Tells the call about a camera or screen share turned on or off. The
   * live connection is changed in place (see `Signaling`): the mic and
   * everyone's audio carry on without a break. Only a connection that is
   * not up (or that fails to change) is rebuilt. */
  private async renegotiateVideo(): Promise<void> {
    if (!this.channelId) return;
    const signaling = this.signaling;
    if (!signaling || !this.pc || this.pc.connectionState === "failed") {
      await this.join(this.channelId);
      return;
    }
    try {
      await signaling.setSendTracks(this.cameraStream, this.screenStream);
      await signaling.offer();
    } catch (err) {
      console.log("[voice] could not change the live connection, rejoining", err);
      await this.join(this.channelId);
    }
  }

  /** @param clearVideo Pass `false` from an internal rejoin (see
   * `join`) so an active camera/screen share survives the peer
   * connection being rebuilt; the public API (a real "leave the call")
   * always wants the default `true`.
   * @param notifyLeave Pass `false` from an internal rejoin too —
   * sending the gateway an explicit "left voice" signal and firing
   * `onStateChange(false, ...)` here is only correct for an actual
   * departure. The offer `join()` sends right after this already
   * tells the server (and, through it, every other participant)
   * about the transition on its own — including correctly *not*
   * re-announcing a departure when rejoining the very same channel —
   * so doing it here too just broadcasts a spurious "left" a moment
   * before "joined" to everyone in the room (and locally, plays the
   * leave sound an instant before the join sound) every time a
   * camera/screen toggle or channel switch rebuilds the connection. */
  leave(clearVideo = true, notifyLeave = true): void {
    this.connection.clearReconnectTimer();
    this.connection.clearConnectTimer();
    const wasChannel = this.channelId;
    if (wasChannel && notifyLeave) {
      this.gateway.sendVoiceState(null);
    }

    this.signaling?.close();
    this.signaling = null;
    this.pc?.close();
    this.pc = null;

    this.mic.stopSpeakingDetection();

    this.localStream?.getTracks().forEach((track) => track.stop());
    this.localStream = null;

    this.mic.disposeInput();

    if (clearVideo) {
      this.cameraStream?.getTracks().forEach((track) => track.stop());
      this.cameraStream = null;
      this.screenStream?.getTracks().forEach((track) => track.stop());
      this.screenStream = null;
      this.onLocalVideo?.("camera", null);
      this.onLocalVideo?.("screen", null);
    }

    this.remoteAudio.clear();
    this.remoteVideo.clear();

    this.channelId = null;
    this.micStatus.setTrackProblem(null);
    if (wasChannel && notifyLeave) {
      this.onStateChange?.(false, wasChannel);
    }
  }

  /** Mutes/unmutes your own mic. Independent of `toggleDeafen` — muting
   * doesn't affect what you hear, and deafening doesn't affect whether
   * your mic is sending. */
  toggleMute(): boolean {
    this.muted = !this.muted;
    this.localStream?.getAudioTracks().forEach((track) => {
      track.enabled = !this.muted;
    });
    return this.muted;
  }

  /** Deafening mutes incoming audio only (by zeroing each remote
   * `<audio>` element's volume — server-side mute enforcement doesn't
   * exist yet, so this is purely a local playback cue). Independent of
   * `toggleMute`: your mic keeps sending unless you separately mute it. */
  toggleDeafen(): boolean {
    this.deafened = !this.deafened;
    this.applyOutputPrefs();
    return this.deafened;
  }

  /** Re-applies the current output volume/device preference to every
   * live remote audio element — call after the user changes them in
   * Settings, or after toggling deafen. */
  applyOutputPrefs(): void {
    this.remoteAudio.applyPrefs();
  }

  /** Live per-person output-volume adjustment for someone else's voice
   * in the current call — a multiplier on top of the master output
   * volume, persisted so it's remembered across calls. `key` is either
   * a plain user id (their mic) or `videoKey(userId, "screen")` (their
   * screen share's audio, adjustable independently of their mic). */
  /** Live mic-gain adjustment — takes effect immediately, no rejoin needed. */
  setInputVolume(value: number): void {
    this.mic.setInputVolume(value);
  }

  /** Applies the voice filter switches (`AudioPrefs.noiseFilter` /
   * `studioVoice`) to an active call, live. */
  applyVoiceFilters(): void {
    const prefs = loadAudioPrefs();
    for (const track of this.localStream?.getAudioTracks() ?? []) {
      void track.applyConstraints(inputConstraints(prefs.inputDeviceId, prefs.noiseFilter)).catch(() => {});
    }
    this.mic.applyFilters();
  }

  setRemoteVolume(key: string, value: number): void {
    const clamped = Math.min(MAX_REMOTE_VOLUME, Math.max(0, value));
    const prefs = loadAudioPrefs();
    prefs.remoteVolumes = { ...prefs.remoteVolumes, [key]: clamped };
    saveAudioPrefs(prefs);
    this.remoteAudio.applyTo(key);
  }

  getRemoteVolume(key: string): number {
    return loadAudioPrefs().remoteVolumes[key] ?? 1;
  }

  /** Swaps the local mic track for a different input device mid-call,
   * if one is active; a no-op otherwise (the new device just gets
   * picked up on the next `join`). */
  async switchInputDevice(deviceId: string | null): Promise<void> {
    if (!this.pc) return;
    let newStream: MediaStream;
    try {
      newStream = await navigator.mediaDevices.getUserMedia({
        audio: inputConstraints(deviceId, loadAudioPrefs().noiseFilter),
      });
    } catch {
      this.onError?.("Couldn't switch to that microphone.");
      return;
    }
    await this.replaceMic(newStream);
  }

  /** True while the call is up or still being set up; false once it has
   * failed or dropped for good, when it should not count as "a call you are
   * on" (for asking before switching to another). */
  get isConnectionHealthy(): boolean {
    const state = this.pc?.connectionState;
    return state !== undefined && state !== "failed" && state !== "closed" && state !== "disconnected";
  }

  private async handleServerUpdate(data: VoiceServerUpdate): Promise<void> {
    if (!this.pc || data.channel_id !== this.channelId) return;

    void this.signaling?.handleRemote(data.sdp);
  }

  private attachRemoteTrack(event: RTCTrackEvent): void {
    const stream = event.streams[0];
    if (!stream) return;
    // The SFU relays mic audio under a stream id equal to the sender's
    // user id, and both screen-share audio and any video under
    // `"<user id>-camera"` or `"<user id>-screen"` (see
    // voice::negotiate_if_needed on the server — `-`, not `:`: str0m
    // filters the stream id through RFC 8830's msid token-char set,
    // which silently strips `:`) — untagged video (shouldn't normally
    // happen) falls back to treating it as a camera.
    const [userId, taggedPurpose] = stream.id.split("-");

    if (event.track.kind === "audio") {
      this.remoteAudio.attach(userId, taggedPurpose, stream, event.track);
      return;
    }

    if (event.track.kind === "video") {
      this.remoteVideo.attach(userId, taggedPurpose === "screen" ? "screen" : "camera", stream, event.track);
    }
  }
}
