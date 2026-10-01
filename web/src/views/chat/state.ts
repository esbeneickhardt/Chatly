// The chat screen's shared, changing state: which server/conversation is open,
// what's loaded, what's being composed. One object, so any part of the screen
// can read and update it without threading a dozen variables around.

import type { Channel, DmSummary, FileMeta, Guild, Message, User } from "../../api";

export interface ChatState {
  guilds: Guild[];
  dms: DmSummary[];
  activeGuild: Guild | null;
  activeChannel: Channel | null;
  activeDm: DmSummary | null;
  onHome: boolean;
  lastRenderedAuthor: string | null;
  lastRenderedTime: number;
  lastRenderedDateKey: string | null;
  pendingAttachments: FileMeta[];
  replyingTo: Message | null;
  currentChannels: Channel[];
  mentionCandidates: User[];
  onlineUserIds: Set<string>;
  dmsSync: Promise<void>;
}

export function createChatState(guilds: Guild[], dms: DmSummary[]): ChatState {
  return {
    guilds,
    dms,
    activeGuild: null,
    activeChannel: null,
    activeDm: null,
    onHome: false,
    lastRenderedAuthor: null,
    lastRenderedTime: 0,
    lastRenderedDateKey: null,
    pendingAttachments: [],
    replyingTo: null,
    currentChannels: [],
    mentionCandidates: [],
    onlineUserIds: new Set<string>(),
    dmsSync: Promise.resolve(),
  };
}
