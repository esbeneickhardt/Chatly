// The server rail and the mobile server list: drawing them, switching server, leaving or deleting one, and the pending-friend-request badge.

import { type DmSummary, type Guild, type User, api } from "../../api";
import { icon } from "../../icons";
import { renderAddFriendModal } from "../chat/user-search";
import { renderFriendRequestsModal } from "../friends";
import { renderManageServerModal } from "../guild-settings";
import { renderAddServerModal, renderCreateChannelModal, renderInviteModal } from "../servers";
import { type ComposerDomParts } from "./composer-dom";
import { type HeaderParts } from "./header";
import { type SidebarParts } from "./sidebar";
import type { ChatState } from "./state";

/** What this part of the chat screen needs from the rest of it. */
export interface createGuildRailContext {
  sidebarParts: SidebarParts;
  headerParts: HeaderParts;
  composerDom: ComposerDomParts;
  state: ChatState;
  user: User;
  refreshDmList: () => Promise<void>;
  switchGuild: (guild: Guild) => Promise<void>;
  switchToHome: () => Promise<void>;
}

export function createGuildRail(ctx: createGuildRailContext) {
  const { state, user, refreshDmList, switchGuild, switchToHome } = ctx;
  const {
    addServerBtn,
    avatarInitial,
    channelList,
    createChannelBtn,
    friendRequestsBadge,
    friendRequestsBtn,
    guildRail,
    homeIcon,
    inviteBtn,
    manageGuildBtn,
    mobileServerList,
    mobileServerListBtn,
    mobileServerListCloseBtn,
    mobileServerListItems,
    newDmBtn,
    sidebarHeaderName,
  } = ctx.sidebarParts;
  const { channelHeaderLabel } = ctx.headerParts;
  const { messageList } = ctx.composerDom;

  function renderGuildRail(): void {
    const icons = state.guilds.map((g) => {
      const iconEl = document.createElement("div");
      iconEl.className = `guild-icon${state.activeGuild?.id === g.id ? " active" : ""}`;
      if (g.icon_file_id) {
        const img = document.createElement("img");
        img.className = "guild-icon-image";
        img.src = `/api/files/${g.icon_file_id}`;
        img.alt = g.name;
        iconEl.appendChild(img);
      } else {
        iconEl.textContent = avatarInitial(g.name);
      }
      iconEl.title = g.name;
      iconEl.addEventListener("click", () => void switchGuild(g));
      return iconEl;
    });

    const divider = document.createElement("div");
    divider.className = "guild-rail-divider";

    homeIcon.classList.toggle("active", state.onHome);
    guildRail.replaceChildren(homeIcon, divider, ...icons, addServerBtn);
    renderMobileServerList();
  }

  homeIcon.addEventListener("click", () => void switchToHome());

  addServerBtn.addEventListener("click", () => {
    renderAddServerModal({
      onJoined: (guild) => {
        state.guilds = [...state.guilds, guild];
        void switchGuild(guild);
      },
    });
  });

  // The mobile stand-in for the guild rail — see `mobileServerListBtn`
  // above for why this exists as a full-width list rather than
  // reusing the rail's own icon-only rows. Built from the exact same
  // `guilds`/`activeGuild`/`onHome` state and the exact same
  // `switchGuild`/`switchToHome`/`renderAddServerModal` actions the
  // rail already uses, just presented as rows a phone screen can
  // actually read at a glance.
  function mobileServerListRow(opts: {
    iconEl: HTMLElement;
    label: string;
    active: boolean;
    onClick: () => void;
  }): HTMLElement {
    const row = document.createElement("button");
    row.type = "button";
    row.className = `mobile-server-list-row${opts.active ? " active" : ""}`;
    const label = document.createElement("span");
    label.textContent = opts.label;
    row.append(opts.iconEl, label);
    row.addEventListener("click", opts.onClick);
    return row;
  }

  function mobileGuildIconEl(g: Guild): HTMLElement {
    const el = document.createElement("div");
    el.className = "guild-icon";
    if (g.icon_file_id) {
      const img = document.createElement("img");
      img.className = "guild-icon-image";
      img.src = `/api/files/${g.icon_file_id}`;
      img.alt = g.name;
      el.appendChild(img);
    } else {
      el.textContent = avatarInitial(g.name);
    }
    return el;
  }

  function closeMobileServerList(): void {
    mobileServerList.hidden = true;
  }

  function renderMobileServerList(): void {
    const homeIconEl = document.createElement("div");
    homeIconEl.className = "guild-icon";
    homeIconEl.appendChild(icon("message-circle", 18));
    const homeRow = mobileServerListRow({
      iconEl: homeIconEl,
      label: "Direct Messages",
      active: state.onHome,
      onClick: () => {
        closeMobileServerList();
        void switchToHome();
      },
    });

    const divider = document.createElement("div");
    divider.className = "mobile-server-list-divider";

    const guildRows = state.guilds.map((g) =>
      mobileServerListRow({
        iconEl: mobileGuildIconEl(g),
        label: g.name,
        active: state.activeGuild?.id === g.id,
        onClick: () => {
          closeMobileServerList();
          void switchGuild(g);
        },
      }),
    );

    const addIconEl = document.createElement("div");
    addIconEl.className = "guild-icon action";
    addIconEl.appendChild(icon("plus", 18));
    const addRow = mobileServerListRow({
      iconEl: addIconEl,
      label: "Add a server",
      active: false,
      onClick: () => {
        closeMobileServerList();
        renderAddServerModal({
          onJoined: (guild) => {
            state.guilds = [...state.guilds, guild];
            void switchGuild(guild);
          },
        });
      },
    });

    mobileServerListItems.replaceChildren(homeRow, divider, ...guildRows, addRow);
  }

  mobileServerListBtn.addEventListener("click", () => {
    mobileServerList.hidden = false;
  });
  mobileServerListCloseBtn.addEventListener("click", closeMobileServerList);

  // A server-wide "Invite" has no specific channel of its own to pick
  // — lands people on the guild's first text channel (bootstrap always
  // creates one), same as just joining the guild used to do before
  // invites could target a channel at all.
  function defaultGuildInviteChannelId(): string | null {
    return state.currentChannels.find((c) => c.kind === "text")?.id ?? state.currentChannels[0]?.id ?? null;
  }

  inviteBtn.addEventListener("click", () => {
    const channelId = state.activeGuild ? defaultGuildInviteChannelId() : null;
    if (state.activeGuild && channelId) {
      renderInviteModal({ title: `Invite people to ${state.activeGuild.name}`, channelId });
    }
  });

  // Same client-side effect either way: this guild is gone from your
  // own list, so move on to whatever's next — shared by both
  // "deleted the whole server" and "just left it" (see
  // `renderManageServerModal`'s `onDeleted`/`onLeft`, which are
  // otherwise two different server calls entirely).
  function removeActiveGuildFromList(): void {
    if (!state.activeGuild) return;
    const removedId = state.activeGuild.id;
    state.guilds = state.guilds.filter((g) => g.id !== removedId);
    if (state.guilds.length > 0) {
      void switchGuild(state.guilds[0]);
    } else if (state.dms.length > 0) {
      void switchToHome();
    } else {
      state.activeGuild = null;
      state.onHome = false;
      sidebarHeaderName.textContent = "";
      state.currentChannels = [];
      channelHeaderLabel.textContent = "";
      messageList.replaceChildren();
      channelList.replaceChildren();
      renderGuildRail();
    }
  }

  manageGuildBtn.addEventListener("click", () => {
    if (!state.activeGuild) return;
    renderManageServerModal({
      guildId: state.activeGuild.id,
      currentUserId: user.id,
      onUpdated: (updated) => {
        state.guilds = state.guilds.map((g) => (g.id === updated.id ? updated : g));
        if (state.activeGuild?.id === updated.id) {
          state.activeGuild = updated;
          sidebarHeaderName.textContent = updated.name;
        }
        renderGuildRail();
      },
      onDeleted: removeActiveGuildFromList,
      onLeft: removeActiveGuildFromList,
    });
  });

  createChannelBtn.addEventListener("click", () => {
    if (!state.activeGuild) return;
    renderCreateChannelModal({
      guildId: state.activeGuild.id,
      onCreated: () => {
        if (state.activeGuild) void switchGuild(state.activeGuild);
      },
    });
  });

  function addOrUpdateDm(dm: DmSummary): void {
    state.dms = [dm, ...state.dms.filter((d) => d.channel.id !== dm.channel.id)];
  }

  /** After closing (hiding) or leaving a conversation — same "refetch
   * the list" pattern pin/unpin already uses (simplest way to stay in
   * sync with the server's own filtering, e.g. `hidden_dms`, rather
   * than re-deriving it client-side) and, if it was the one currently
   * open, falls back to Home's own default selection (always safe:
   * the self-DM is guaranteed to exist, see UX_FEEDBACK.md, so there's
   * always *something* to land on even if this was the only other DM). */
  async function removeDmLocally(channelId: string): Promise<void> {
    if (state.activeDm?.channel.id === channelId) {
      await switchToHome();
    } else {
      await refreshDmList();
    }
  }

  newDmBtn.addEventListener("click", () => {
    renderAddFriendModal({ currentUsername: user.username });
  });

  friendRequestsBtn.addEventListener("click", () => {
    renderFriendRequestsModal({
      onAccepted: () => {
        void refreshFriendRequestsBadge();
        if (state.onHome) void switchToHome();
      },
    });
  });

  async function refreshFriendRequestsBadge(): Promise<void> {
    try {
      const requests = await api.get<{ incoming: boolean }[]>("/api/friends/requests");
      const count = requests.filter((r) => r.incoming).length;
      friendRequestsBadge.textContent = String(count);
      friendRequestsBadge.hidden = count === 0;
    } catch {
      /* leave the last-known badge state showing */
    }
  }

  return {
    addOrUpdateDm,
    defaultGuildInviteChannelId,
    refreshFriendRequestsBadge,
    removeDmLocally,
    renderGuildRail,
  };
}

export type GuildRailParts = ReturnType<typeof createGuildRail>;
