// Shared constants and small helpers for the voice client.

import { api } from "../api";

export interface IceServersResponse {
  ice_servers: RTCIceServer[];
}

/** The server's advertised host/server-reflexive candidates (see
 * `voice::spawn`) only work when the two sides' networks can reach
 * each other directly — plenty of real NAT setups (symmetric NAT,
 * CGNAT, common on mobile networks and some home routers) simply
 * can't complete that handshake no matter how correct the signaling
 * is. `/api/voice/ice-servers` hands back a short-lived TURN
 * credential (see `api::voice`) as a fallback path for exactly that
 * case; an empty list (no `TURN_SECRET` configured server-side) just
 * means only the plain direct path is available, same as before this
 * existed. Fetched fresh on every `join()` rather than cached —
 * `join()` already rebuilds the whole `RTCPeerConnection` on every
 * camera/screen toggle, so this rides along for free and sidesteps
 * ever using a credential past its TTL on a long-lived tab. */
export async function getIceServers(): Promise<RTCIceServer[]> {
  try {
    const res = await api.get<IceServersResponse>("/api/voice/ice-servers");
    return res.ice_servers;
  } catch {
    return [];
  }
}

export type SinkCapable = HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };

/** Key for `remoteVideoEls`, and (for `"screen"`) `remoteAudioEls` and
 * `AudioPrefs.remoteVolumes` too: a user can have a camera *and* a
 * screen share active at once, so a bare user id isn't unique enough.
 * Exported so the UI can build the same key for a screen-share's
 * independent volume control. */
export function videoKey(userId: string, purpose: "camera" | "screen"): string {
  return `${userId}:${purpose}`;
}

export function splitVideoKey(key: string): [string, "camera" | "screen"] {
  const [userId, purpose] = key.split(":");
  return [userId, purpose === "screen" ? "screen" : "camera"];
}

export const SPEAKING_THRESHOLD = 12; // 0-255 average level from the analyser
export const SPEAKING_POLL_MS = 100;

/** Remote-speaking gate: waveform RMS (0..1) and how long the ring
 * lingers after the last loud sample — see `watchRemoteSpeaking`. */
export const REMOTE_SPEAKING_RMS = 0.015;

export const REMOTE_SPEAKING_HOLD_MS = 350;

/** How long a lagged/dropped-out connection gets to recover on its own
 * (an ICE restart, or the network just clearing up) before actually
 * hanging up the call — matches the server's own `ICE_DISCONNECT_GRACE`
 * (crates/server/src/voice/mod.rs) so the client doesn't give up
 * sooner than the server would anyway. Without this, a `connectionState`
 * of "failed" (which ordinary lag/a brief wifi drop can trigger, not
 * just an actually-dead connection) tore the call down immediately. */
export const RECONNECT_GRACE_MS = 15_000;

/** How long a call that has never connected may keep trying before we tell
 * the person and hang up. Without this a call the network will not carry
 * sits there looking connected (the call screen, the buttons) while no
 * voice, video or sound ever flows, until the browser itself gives up half
 * a minute later, with no word to anyone. */
export const CONNECT_TIMEOUT_MS = 20_000;

export const CONNECT_FAILED_MESSAGE =
  "Couldn't connect the call. Your network may be blocking voice. Try switching between Wi-Fi and mobile data, or turn off a VPN, then try again.";

/** Adds a sending transceiver, preferring `init` as given. Sender tweaks
 * (bitrate, priority) are nice to have; a browser that refuses them must
 * still get a working call, so on any error it is retried without them. */
export function addSendTransceiver(
  pc: RTCPeerConnection,
  track: MediaStreamTrack,
  init: RTCRtpTransceiverInit,
): RTCRtpTransceiver {
  try {
    return pc.addTransceiver(track, init);
  } catch (err) {
    if (!init.sendEncodings) throw err;
    console.log("[voice] this browser refused the sender settings, using its defaults", err);
    return pc.addTransceiver(track, { direction: init.direction, streams: init.streams });
  }
}

/** Highest per-person/per-share volume the UI offers, as a multiple of
 * the source level. An `<audio>` element's own `volume` is hard-capped
 * at 1, so anything above 100% is applied through a Web Audio gain node
 * instead — see `applyOutputSettingsTo`. Shared media (a YouTube tab)
 * is routinely far quieter than a mic that went through AGC, so 100%
 * alone often isn't loud enough. */
export const MAX_REMOTE_VOLUME = 3;

/** Screen-share encoder limits. Chrome treats every `getDisplayMedia`
 * track as a slide-style "screencast": on a constrained uplink it holds
 * resolution and drops the frame rate to a few fps, which is exactly
 * what a video played in a shared tab looks like on the far end — a
 * slideshow. `contentHint = "motion"` flips that (hold fps, shed
 * resolution), and an explicit ceiling keeps a 4K monitor from being
 * encoded at full size in software. */
export const SCREEN_MAX_BITRATE = 4_000_000;

export const SCREEN_MAX_FRAMERATE = 30;

export const SCREEN_MAX_LONG_EDGE = 1920;

export const SCREEN_AUDIO_MAX_BITRATE = 128_000;

/** How your voice is sent. Two things the browser's defaults get wrong for a
 * call: the Opus target is 32 kbps (audibly thin), and audio is sent at
 * "low" priority, the same as video, so on a crowded uplink a screen share
 * can squeeze your voice. 64 kbps is comfortably clear speech; "high"
 * priority makes the browser give audio its bandwidth first (and mark its
 * packets for Wi-Fi's voice queue). */
export const VOICE_MAX_BITRATE = 64_000;

export const VOICE_ENCODING: RTCRtpEncodingParameters = {
  maxBitrate: VOICE_MAX_BITRATE,
  priority: "high",
  networkPriority: "high",
};

/** Encoder settings for one screen-share track — see the
 * `SCREEN_*` constants for why. Also stamps the track's `contentHint`
 * (a property of the track, so it has to be set before the offer is
 * created): video is declared "motion" and shared-tab audio "music",
 * which keeps Chrome from tuning the audio encoder for a voice call. */
export function screenSendEncoding(track: MediaStreamTrack): RTCRtpEncodingParameters {
  if (track.kind === "audio") {
    track.contentHint = "music";
    // Shared sound ranks below your own voice.
    return { maxBitrate: SCREEN_AUDIO_MAX_BITRATE, priority: "medium", networkPriority: "medium" };
  }
  track.contentHint = "motion";
  const { width = 0, height = 0 } = track.getSettings();
  const longEdge = Math.max(width, height);
  return {
    maxBitrate: SCREEN_MAX_BITRATE,
    maxFramerate: SCREEN_MAX_FRAMERATE,
    scaleResolutionDownBy: longEdge > SCREEN_MAX_LONG_EDGE ? longEdge / SCREEN_MAX_LONG_EDGE : 1,
  };
}

export function inputConstraints(deviceId: string | null): MediaTrackConstraints {
  const constraints: MediaTrackConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };
  if (deviceId) {
    constraints.deviceId = { exact: deviceId };
  }
  return constraints;
}
