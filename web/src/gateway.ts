import type { Channel, DmSummary, FriendRequest, Guild, Message, User } from "./api";

interface Frame {
  op: number;
  d: unknown;
  s: number | null;
  t: string | null;
}

interface ReadyData {
  user: User;
  guilds: (Guild & { channels: Channel[] })[];
  /** Everyone with a live gateway connection right now, instance-wide
   * — a point-in-time snapshot to seed the UI with; `presence_update`
   * carries every change from here on. */
  online_user_ids: string[];
}

export interface PresenceUpdate {
  user_id: string;
  online: boolean;
}

export interface VoiceServerUpdate {
  channel_id: string;
  sdp: RTCSessionDescriptionInit;
}

export interface MessageDeleteEvent {
  channel_id: string;
  message_id: string;
}

export interface VoiceStateUpdate {
  channel_id: string;
  user_id: string;
  connected: boolean;
}

/** Someone in a call you can see can't be heard because of their mic. */
export interface VoiceMicProblem {
  channel_id: string;
  user_id: string;
  problem: boolean;
}

/** Someone turned down an incoming call in a DM you're in. */
export interface DmCallDeclinedEvent {
  channel_id: string;
  user_id: string;
}

/** A call in a 1:1 moved into a new group chat because someone was added:
 * everyone on it follows together. */
export interface DmCallMovedEvent {
  from_channel_id: string;
  to_channel_id: string;
  /** Who added the person. */
  by: string;
}

export interface DmParticipantLeaveEvent {
  channel_id: string;
  user_id: string;
}

type Listener = {
  /** Fires on the first connect *and* every reconnect (there's no
   * Resume yet, so each one is a fresh Identify/Ready round trip) —
   * a good signal for the UI to refresh anything that could have
   * missed events while disconnected. */
  ready: (data: ReadyData) => void;
  message_create: (message: Message) => void;
  message_update: (message: Message) => void;
  message_delete: (data: MessageDeleteEvent) => void;
  voice_server_update: (data: VoiceServerUpdate) => void;
  voice_state_update: (data: VoiceStateUpdate) => void;
  voice_mic_problem: (data: VoiceMicProblem) => void;
  /** Someone sent you a friend request. */
  friend_request_create: (request: FriendRequest) => void;
  /** A new DM channel now includes you — a request you sent/received
   * just got accepted, or someone added you to an existing
   * conversation. Either way, this is also the server telling this
   * connection it's now subscribed to that channel's own room, so
   * future messages there arrive live too. */
  dm_channel_create: (dm: DmSummary) => void;
  /** Someone left a group DM you're still in — drop them from that
   * conversation's participant list locally; not fired for the person
   * who left themselves (they already know from their own request). */
  dm_participant_leave: (data: DmParticipantLeaveEvent) => void;
  /** Someone declined the call you're ringing (or one you're on) in a
   * DM — lets the caller see "Declined" instead of ringing into the void. */
  dm_call_declined: (data: DmCallDeclinedEvent) => void;
  /** The call you are on moved into a new group chat (see `DmCallMovedEvent`). */
  dm_call_moved: (data: DmCallMovedEvent) => void;
  /** Someone with a DM or guild in common with you came online (their
   * first live connection) or went offline (their last one closed). */
  presence_update: (data: PresenceUpdate) => void;
  disconnected: () => void;
};

/** How long without input before a visible page stops counting as in use. */
export const IDLE_AFTER_MS = 3 * 60_000;

/** Someone is using the page: it's in front, focused, and was touched lately. */
export function isActive(visible: boolean, focused: boolean, sinceInputMs: number): boolean {
  return visible && focused && sinceInputMs < IDLE_AFTER_MS;
}

/** Connects to /gateway, Identifies, keeps a heartbeat, and reconnects
 * with exponential backoff on drop. Resume (op 3) isn't implemented by
 * the server yet, so a drop always re-Identifies from scratch. */
export class GatewayClient {
  private socket: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closedByUser = false;
  private listeners: Partial<Listener> = {};
  /** What the server was last told by op 12 (see `reportActivity`). */
  private active = false;
  private lastInputAt = Date.now();

  constructor() {
    // Whether someone is using this page decides whether they get pushed
    // notifications on their other devices (the server skips anyone active).
    const onInput = (): void => {
      this.lastInputAt = Date.now();
      this.reportActivity();
    };
    for (const type of ["pointerdown", "keydown", "touchstart", "wheel"]) {
      window.addEventListener(type, onInput, { passive: true, capture: true });
    }
    window.addEventListener("pointermove", () => {
      if (Date.now() - this.lastInputAt > 10_000) onInput();
    });
    window.addEventListener("focus", () => this.reportActivity());
    window.addEventListener("blur", () => this.reportActivity());
    document.addEventListener("visibilitychange", () => this.reportActivity());
    window.addEventListener("pagehide", () => this.reportActivity());
    setInterval(() => this.reportActivity(), 15_000);

    // Mobile browsers throttle (or fully suspend) a hidden tab's own
    // timers hard enough that this class's heartbeat routinely stops
    // firing altogether once a phone's screen turns off — after
    // `heartbeat_timeout` (gateway/mod.rs, 2x the interval) the server
    // gives up and closes the socket, or the OS's own radio going to
    // sleep just drops it outright. Either way, a `scheduleReconnect`
    // queued *while hidden* is itself subject to the same throttling,
    // so waiting for it to fire on its own could take far longer than
    // its own requested delay — the tab just sits there looking
    // "stuck" until whatever backed-off delay eventually gets through.
    // Reconnecting immediately, unbacked-off, the moment the tab is
    // actually looked at again is the standard fix for this.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible" || this.closedByUser) return;
      if (this.socket?.readyState === WebSocket.OPEN || this.socket?.readyState === WebSocket.CONNECTING) {
        return;
      }
      if (this.reconnectTimer !== null) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      this.reconnectAttempt = 0;
      this.connect();
    });
  }

  on<K extends keyof Listener>(event: K, fn: Listener[K]): void {
    this.listeners[event] = fn;
  }

  connect(): void {
    this.closedByUser = false;
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    this.socket = new WebSocket(`${proto}//${location.host}/gateway`);

    this.socket.addEventListener("open", () => {
      this.reconnectAttempt = 0;
    });

    this.socket.addEventListener("message", (event) => {
      const frame: Frame = JSON.parse(event.data);
      this.handleFrame(frame);
    });

    this.socket.addEventListener("close", () => {
      this.stopHeartbeat();
      this.listeners.disconnected?.();
      if (!this.closedByUser) {
        this.scheduleReconnect();
      }
    });
  }

  close(): void {
    this.closedByUser = true;
    this.stopHeartbeat();
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.close();
  }

  /** Sends op 4 (VoiceStateUpdate): join/renegotiate a voice channel
   * with an SDP offer or answer, or pass `channelId: null` to leave.
   * `videoPurposes` (offers only) is `{ mid: "camera" | "screen" }` for
   * this offer's own video m-lines — the server has no other way to
   * tell a camera and screen share apart. `renegotiate` marks an offer
   * that changes a connection that stays up (camera or screen share on
   * or off) rather than a fresh join. */
  sendVoiceState(
    channelId: string | null,
    sdp?: RTCSessionDescriptionInit,
    videoPurposes?: Record<string, string>,
    renegotiate = false,
  ): void {
    this.send({
      op: 4,
      d: {
        channel_id: channelId,
        sdp: sdp ?? null,
        video_purposes: videoPurposes ?? {},
        renegotiate,
      },
    });
  }

  /** Sends op 13 (MicProblem): whether the people in your call can't
   * hear you because of your microphone. The server passes it on to
   * the call's room as `VOICE_MIC_PROBLEM`. */
  sendMicProblem(problem: boolean): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.send({ op: 13, d: { problem } });
  }

  /** Sends op 12 (Activity) when whether this page is in use has changed,
   * or always when `force` (a fresh connection starts out inactive). */
  private reportActivity(force = false): void {
    const active = isActive(
      document.visibilityState === "visible",
      document.hasFocus(),
      Date.now() - this.lastInputAt,
    );
    if (active === this.active && !force) return;
    this.active = active;
    if (this.socket?.readyState === WebSocket.OPEN) this.send({ op: 12, d: { active } });
  }

  private scheduleReconnect(): void {
    const delayMs = Math.min(30_000, 1000 * 2 ** this.reconnectAttempt);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delayMs);
  }

  private handleFrame(frame: Frame): void {
    switch (frame.op) {
      case 10: {
        const { heartbeat_interval_ms } = frame.d as { heartbeat_interval_ms: number };
        this.send({ op: 2, d: {} });
        this.startHeartbeat(heartbeat_interval_ms);
        this.reportActivity(true);
        break;
      }
      case 0:
        if (frame.t === "READY") {
          this.listeners.ready?.(frame.d as ReadyData);
        } else if (frame.t === "MESSAGE_CREATE") {
          this.listeners.message_create?.(frame.d as Message);
        } else if (frame.t === "MESSAGE_UPDATE") {
          this.listeners.message_update?.(frame.d as Message);
        } else if (frame.t === "VOICE_SERVER_UPDATE") {
          this.listeners.voice_server_update?.(frame.d as VoiceServerUpdate);
        } else if (frame.t === "MESSAGE_DELETE") {
          this.listeners.message_delete?.(frame.d as MessageDeleteEvent);
        } else if (frame.t === "VOICE_STATE_UPDATE") {
          this.listeners.voice_state_update?.(frame.d as VoiceStateUpdate);
        } else if (frame.t === "VOICE_MIC_PROBLEM") {
          this.listeners.voice_mic_problem?.(frame.d as VoiceMicProblem);
        } else if (frame.t === "FRIEND_REQUEST_CREATE") {
          this.listeners.friend_request_create?.(frame.d as FriendRequest);
        } else if (frame.t === "DM_CHANNEL_CREATE") {
          this.listeners.dm_channel_create?.(frame.d as DmSummary);
        } else if (frame.t === "DM_PARTICIPANT_LEAVE") {
          this.listeners.dm_participant_leave?.(frame.d as DmParticipantLeaveEvent);
        } else if (frame.t === "DM_CALL_DECLINED") {
          this.listeners.dm_call_declined?.(frame.d as DmCallDeclinedEvent);
        } else if (frame.t === "DM_CALL_MOVED") {
          this.listeners.dm_call_moved?.(frame.d as DmCallMovedEvent);
        } else if (frame.t === "PRESENCE_UPDATE") {
          this.listeners.presence_update?.(frame.d as PresenceUpdate);
        }
        break;
      case 9:
        // InvalidSession: the server doesn't support Resume. We never
        // send op 3, so we shouldn't see this, but handle it by letting
        // the close handler's reconnect path re-Identify anyway.
        this.socket?.close();
        break;
      default:
        break;
    }
  }

  private startHeartbeat(intervalMs: number): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => this.send({ op: 1, d: null }), intervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private send(frame: Partial<Frame>): void {
    this.socket?.send(JSON.stringify(frame));
  }
}
