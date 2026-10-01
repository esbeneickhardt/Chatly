export class ApiError extends Error {
  code: string;
  status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { "X-Requested-With": "XMLHttpRequest" };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(path, {
    method,
    headers,
    credentials: "same-origin",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const contentType = response.headers.get("content-type") ?? "";
  const data = contentType.includes("application/json") ? await response.json() : undefined;

  if (!response.ok) {
    const code = data?.error?.code ?? "unknown_error";
    const message = data?.error?.message ?? `request failed with status ${response.status}`;
    throw new ApiError(response.status, code, message);
  }

  return data as T;
}

async function upload<T>(path: string, file: File): Promise<T> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(path, {
    method: "POST",
    headers: { "X-Requested-With": "XMLHttpRequest" },
    credentials: "same-origin",
    body: formData,
  });

  const data = await response.json().catch(() => undefined);
  if (!response.ok) {
    const code = data?.error?.code ?? "unknown_error";
    const message = data?.error?.message ?? `upload failed with status ${response.status}`;
    throw new ApiError(response.status, code, message);
  }
  return data as T;
}

/** Same as `upload`, but reports live progress — `fetch` has no
 * portable progress event for the outgoing/request side at all (only
 * the incoming/response side does, via a `ReadableStream` on the
 * body, which is no help for watching bytes go out), so this uses
 * `XMLHttpRequest` instead, whose `upload.onprogress` has tracked
 * outgoing bytes since forever. Used wherever the UI shows a live
 * upload progress bar instead of just going quiet until the file
 * suddenly appears. */
function uploadWithProgress<T>(path: string, file: File, onProgress: (fraction: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append("file", file);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", path);
    xhr.setRequestHeader("X-Requested-With", "XMLHttpRequest");
    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    });
    xhr.addEventListener("load", () => {
      let data: unknown;
      try {
        data = xhr.responseText ? JSON.parse(xhr.responseText) : undefined;
      } catch {
        data = undefined;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data as T);
      } else {
        const errData = data as { error?: { code?: string; message?: string } } | undefined;
        const code = errData?.error?.code ?? "unknown_error";
        const message = errData?.error?.message ?? `upload failed with status ${xhr.status}`;
        reject(new ApiError(xhr.status, code, message));
      }
    });
    xhr.addEventListener("error", () => {
      reject(new ApiError(0, "network_error", "upload failed — check your connection"));
    });
    xhr.send(formData);
  });
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body ?? {}),
  del: <T>(path: string, body?: unknown) => request<T>("DELETE", path, body),
  upload: <T>(path: string, file: File) => upload<T>(path, file),
  uploadWithProgress: <T>(path: string, file: File, onProgress: (fraction: number) => void) =>
    uploadWithProgress<T>(path, file, onProgress),
};

export interface User {
  id: string;
  username: string;
  display_name: string;
  is_owner: boolean;
  can_invite: boolean;
  created_at: number;
  mfa_enabled?: boolean;
  avatar_file_id: string | null;
  accepts_friend_requests: boolean;
  /** Absent (not `false`) for an ordinary human account — see
   * `api::bots` and `User::is_bot`'s own doc comment on the Rust side. */
  is_bot?: boolean;
  /** Absent (not `false`) for anyone but an ephemeral guest — see
   * `User::is_guest`'s doc comment on the Rust side. */
  is_guest?: boolean;
}

/** Returned once, right when a bot is created — the server only ever
 * stores its hash from then on, the same as a password or session
 * token never round-tripping back out. */
export interface CreateBotResponse {
  user: User;
  token: string;
}

export interface Guild {
  id: string;
  name: string;
  owner_id: string;
  created_at: number;
  icon_file_id: string | null;
  /** Only accurate on the response of `GET /api/guilds/:id` — the
   * plain guild list doesn't bother computing it. */
  invites_open: boolean;
  /** What the viewing member can do in this server, as a `" | "`-joined
   * list of permission names (see `Role.permissions`). The owner and
   * anyone with `ADMINISTRATOR` get every name. Only filled in on
   * `GET /api/guilds/:id`; empty elsewhere. */
  viewer_permissions?: string;
}

/** One server as the *global* admin sees it — see `api::admin`. */
export interface AdminGuildSummary {
  id: string;
  name: string;
  icon_file_id: string | null;
  created_at: number;
  owner_id: string;
  owner_username: string;
  owner_display_name: string;
  member_count: number;
  channel_count: number;
}

/** A guild role — see `api::roles` (Rust). `id === guild_id` for the
 * implicit `@everyone` role every guild has; anything else is a real,
 * assignable custom role. `permissions` is a `" | "`-joined string of
 * flag names (`bitflags`' own human-readable serialization, e.g.
 * `"VIEW_CHANNEL | SEND_MESSAGES"`, or `""` for none) — see
 * `PERMISSION_NAMES` in guild-settings.ts for the full set. */
export interface Role {
  id: string;
  guild_id: string;
  name: string;
  color: number;
  position: number;
  permissions: string;
  hoist: boolean;
  mentionable: boolean;
}

export interface Channel {
  id: string;
  guild_id: string | null;
  name: string;
  kind: "text" | "voice" | "category";
  position: number;
  topic: string | null;
  created_by: string | null;
  restricted: boolean;
  /** Viewer holds the server-level `MANAGE_CHANNELS` permission (delete
   * the channel, edit its members). There are no per-channel admins. */
  can_manage: boolean;
  /** Viewer can delete other people's messages here (`MANAGE_MESSAGES`). */
  can_moderate: boolean;
}

export interface DmSummary {
  channel: Channel;
  /** Every *other* participant — one for a normal 1:1 DM, several for
   * a group DM. A self-DM is the exception: it holds the viewer
   * themselves (there's no one else to list), so `participants.length
   * === 1 && participants[0].username === myUsername` is the check
   * for "this is my note-to-self channel". */
  participants: User[];
  pinned: boolean;
}

export interface FileMeta {
  id: string;
  filename: string;
  mime: string;
  size: number;
}

export interface ReactionSummary {
  emoji: string;
  count: number;
  reacted_by_me: boolean;
}

export interface MessageReplyPreview {
  author_display_name: string;
  content: string;
  /** `null` if the replied-to message had no attachments at all. */
  first_attachment: FileMeta | null;
  /** `0` when `first_attachment` is `null`; `1` means it's the whole
   * story; anything higher means there are more beyond it. */
  attachment_count: number;
}

export interface Message {
  id: string;
  channel_id: string;
  author_id: string;
  author_display_name: string;
  author_avatar_file_id: string | null;
  content: string;
  created_at: number;
  edited_at: number | null;
  attachments: FileMeta[];
  reactions: ReactionSummary[];
  mentions: string[];
  reply_to: string | null;
  reply_preview: MessageReplyPreview | null;
}

export interface Invite {
  id: string;
  code: string;
  created_by: string;
  created_at: number;
  expires_at: number | null;
  max_uses: number | null;
  uses: number;
  revoked: boolean;
  /** Where redeeming this invite takes you — `null` only for an
   * invite predating the unified invite system. See UX_FEEDBACK.md. */
  channel_id: string | null;
  url?: string;
}

export interface FriendRequest {
  id: string;
  other: User;
  created_at: number;
  incoming: boolean;
}

export interface SystemStats {
  net_rx_bytes_per_sec: number;
  net_tx_bytes_per_sec: number;
  sampled_at: number;
}
