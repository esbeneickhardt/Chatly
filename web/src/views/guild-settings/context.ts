// What every part of the server-settings modal needs from the modal itself.

import type { Guild } from "../../api";

export interface ManageServerOptions {
  guildId: string;
  currentUserId: string;
  onUpdated: (guild: Guild) => void;
  onDeleted: () => void;
  /** Same client-side effect as `onDeleted` (this guild is gone from
   * your own list either way) but a separate prop so a caller can
   * tell "deleted the whole server" apart from "just left it" if it
   * ever needs to — same function reference is fine to pass to both. */
  onLeft: () => void;
}

export interface ServerSettingsContext {
  opts: ManageServerOptions;
  /** Reload everything from the server and redraw (keeps the current tab). */
  reload: () => Promise<void>;
  /** Close the modal. */
  close: () => void;
}
