// Navigation: the conversation options menu, switching server or to Direct Messages, the DM and friends list, and the first view shown after sign-in.

import { ApiError, type Channel, type DmSummary, type Guild, type Message, type User, api } from "../../api";
import { icon } from "../../icons";
import { renderAvatarEl } from "../../ui";
import { isRenderableDm } from "../chat/helpers";
import { renderAddParticipantModal } from "../chat/user-search";
import { renderInviteModal } from "../servers";
import { type ChannelsParts } from "./channels";
import { type ComposerDomParts } from "./composer-dom";
import { type DirectMessagesParts } from "./direct-messages";
import { type GuildRailParts } from "./guild-rail";
import { type HeaderParts } from "./header";
import { type PeopleParts } from "./people";
import { type SidebarParts } from "./sidebar";
import { type VoiceControlsParts } from "./voice-controls";
import type { ChatState } from "./state";

/** What this part of the chat screen needs from the rest of it. */
export interface createNavigationContext {
  guildRail2: GuildRailParts;
  headerParts: HeaderParts;
  sidebarParts: SidebarParts;
  directMessages: DirectMessagesParts;
  composerDom: ComposerDomParts;
  people: PeopleParts;
  channels: ChannelsParts;
  voiceControls: VoiceControlsParts;
  state: ChatState;
  user: User;
}

export function createNavigation(ctx: createNavigationContext) {
  const { state, user } = ctx;
  const { addOrUpdateDm, removeDmLocally, renderGuildRail } = ctx.guildRail2;
  const { channelHeaderLabel, dmOptionsBtn } = ctx.headerParts;
  const { createChannelBtn, friendRequestsBtn, inviteBtn, manageGuildBtn, newDmBtn, sidebarHeaderName } =
    ctx.sidebarParts;
  const {
    dmAvatarEl,
    dmLabel,
    groupMemberCountLabel,
    isGroupDm,
    isSelfDm,
    renderDmCallStage,
    selectDm,
    startOutgoingRing,
  } = ctx.directMessages;
  const { messageList } = ctx.composerDom;
  const { rememberUsers, voiceParticipants } = ctx.people;
  const { renderChannelItems, selectChannel, setChannelListRows } = ctx.channels;
  const { voiceClient } = ctx.voiceControls;

  function renderDmOptionsMenu(anchor: HTMLElement, dm: DmSummary): void {
    const existing = document.querySelector(".message-more-menu");
    if (existing) {
      existing.remove();
      return;
    }

    const menu = document.createElement("div");
    menu.className = "message-more-menu";

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "message-more-option";
    addBtn.append(icon("user-plus", 14), document.createTextNode("Add people"));
    addBtn.addEventListener("click", () => {
      menu.remove();
      renderAddParticipantModal({
        channelId: dm.channel.id,
        currentUsername: user.username,
        onAdded: (updated) => {
          addOrUpdateDm(updated);
          const startedNewGroup = updated.channel.id !== dm.channel.id;
          if (startedNewGroup) {
            // Adding to a 1:1 makes a *new* group and leaves the 1:1
            // exactly where it was: open the group, keep the 1:1 in the
            // list. A call in the 1:1 is carried into the group for
            // everyone on it by the server's `DM_CALL_MOVED` (see
            // `events.ts`), not here, so the other person follows too.
            if (state.onHome) void refreshDmList();
            selectDm(updated);
            return;
          }
          if (state.activeChannel?.id === updated.channel.id) selectDm(updated);
          // Adding someone mid-call rings them (the server tells their
          // client a call is going on); show the same "ringing" state
          // for them that starting a call would.
          if (voiceClient.currentChannelId === updated.channel.id) {
            startOutgoingRing(updated.channel.id);
          }
        },
      });
    });
    menu.appendChild(addBtn);

    // For someone who doesn't have a Chatly account yet (or whose
    // username you don't know) — "Add people" above needs both.
    // Redeeming this link never adds them to any server, only this
    // conversation, per the explicit "invited from a DM shouldn't join
    // a server" ask.
    const inviteLinkBtn = document.createElement("button");
    inviteLinkBtn.type = "button";
    inviteLinkBtn.className = "message-more-option";
    inviteLinkBtn.append(icon("copy", 14), document.createTextNode("Invite by link"));
    inviteLinkBtn.addEventListener("click", () => {
      menu.remove();
      renderInviteModal({ title: "Invite people to this conversation", channelId: dm.channel.id });
    });
    menu.appendChild(inviteLinkBtn);

    if (!isSelfDm(dm) && dm.participants.length === 1) {
      const divider = document.createElement("div");
      divider.className = "message-more-divider";
      menu.appendChild(divider);

      // "Close" just drops it off *your own* list (a real 1:1 can't be
      // "left" the way a group can — removing yourself as a
      // participant would leave a channel with exactly one
      // participant, indistinguishable from a self-DM — see
      // UX_FEEDBACK.md). A new message from them brings it back.
      const closeBtn = document.createElement("button");
      closeBtn.type = "button";
      closeBtn.className = "message-more-option";
      closeBtn.append(icon("x", 14), document.createTextNode("Close conversation"));
      closeBtn.addEventListener("click", async () => {
        menu.remove();
        try {
          await api.post(`/api/dms/${dm.channel.id}/hide`);
          await removeDmLocally(dm.channel.id);
        } catch (err) {
          alert(err instanceof ApiError ? err.message : "Couldn't close that conversation.");
        }
      });
      menu.appendChild(closeBtn);

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "message-more-option danger";
      removeBtn.append(icon("user-minus", 14), document.createTextNode("Remove friend"));
      removeBtn.addEventListener("click", async () => {
        menu.remove();
        if (!confirm(`Remove ${dm.participants[0].display_name} as a friend?`)) return;
        try {
          await api.del(`/api/friends/${dm.participants[0].id}`);
          void refreshDmList();
        } catch (err) {
          alert(err instanceof ApiError ? err.message : "Couldn't remove that friend.");
        }
      });
      menu.appendChild(removeBtn);
    }

    if (!isSelfDm(dm) && dm.participants.length >= 2) {
      const divider = document.createElement("div");
      divider.className = "message-more-divider";
      menu.appendChild(divider);

      const leaveBtn = document.createElement("button");
      leaveBtn.type = "button";
      leaveBtn.className = "message-more-option danger";
      leaveBtn.append(icon("log-out", 14), document.createTextNode("Leave conversation"));
      leaveBtn.addEventListener("click", async () => {
        menu.remove();
        if (!confirm("Leave this group conversation? You'll need a new invite to rejoin.")) return;
        try {
          await api.post(`/api/dms/${dm.channel.id}/leave`);
          await removeDmLocally(dm.channel.id);
        } catch (err) {
          alert(err instanceof ApiError ? err.message : "Couldn't leave that conversation.");
        }
      });
      menu.appendChild(leaveBtn);
    }

    document.body.appendChild(menu);
    const rect = anchor.getBoundingClientRect();
    menu.style.left = `${rect.right - menu.offsetWidth}px`;
    menu.style.top = `${rect.bottom + 4}px`;
  }

  dmOptionsBtn.addEventListener("click", () => {
    if (state.activeDm) renderDmOptionsMenu(dmOptionsBtn, state.activeDm);
  });

  function mentionUsernamesFor(message: Message): Set<string> {
    const set = new Set<string>();
    for (const id of message.mentions) {
      const member = state.mentionCandidates.find((m) => m.id === id);
      if (member) set.add(member.username.toLowerCase());
    }
    return set;
  }

  async function switchGuild(guild: Guild): Promise<void> {
    state.activeGuild = guild;
    state.onHome = false;
    sidebarHeaderName.textContent = guild.name;
    inviteBtn.hidden = false;
    manageGuildBtn.hidden = false;
    createChannelBtn.hidden = guild.owner_id !== user.id;
    newDmBtn.hidden = true;
    friendRequestsBtn.hidden = true;
    renderGuildRail();

    const channels = await api.get<Channel[]>(`/api/guilds/${guild.id}/channels`);
    state.currentChannels = channels;
    state.mentionCandidates = await api.get<User[]>(`/api/guilds/${guild.id}/members`);
    rememberUsers(state.mentionCandidates);

    // Forget who was in the *servers'* voice channels (the snapshot below
    // replaces it), but not who is on a call in a conversation: that has
    // nothing to do with which server is open, and losing it made the next
    // Call ring someone who was already on it.
    const conversationIds = new Set(state.dms.map((d) => d.channel.id));
    for (const channelId of [...voiceParticipants.keys()]) {
      if (!conversationIds.has(channelId)) voiceParticipants.delete(channelId);
    }
    const snapshot = await api.get<{ channel_id: string; user_id: string }[]>(
      `/api/guilds/${guild.id}/voice-state`,
    );
    for (const p of snapshot) {
      const set = voiceParticipants.get(p.channel_id) ?? new Set<string>();
      set.add(p.user_id);
      voiceParticipants.set(p.channel_id, set);
    }

    renderChannelItems();

    const firstText = channels.find((c) => c.kind === "text");
    if (firstText) {
      selectChannel(firstText);
    } else {
      state.activeChannel = null;
      channelHeaderLabel.textContent = "";
      messageList.replaceChildren();
    }
  }

  /** Re-fetches and re-renders just the DM list itself — pinning
   * shouldn't yank the viewer over to whatever sorted first, so this
   * is deliberately separate from `switchToHome`, which additionally
   * selects a conversation (only appropriate right when *entering*
   * the DM view, not every time the list's order changes). */
  /** Every friend, whether or not there's a visible 1:1 chat with them
   * right now — see `friendsWithoutChat`. */
  let friends: User[] = [];

  async function syncDms(): Promise<void> {
    const [dmList, friendList] = await Promise.all([
      api.get<DmSummary[]>("/api/dms"),
      api.get<User[]>("/api/friends"),
    ]);
    state.dms = dmList.filter(isRenderableDm);
    friends = friendList;
    for (const dm of state.dms) rememberUsers(dm.participants);
    rememberUsers(friends);
  }

  /** Friends the DM list has no 1:1 conversation for — one they closed,
   * or (before adding people started a *new* group instead of turning
   * the 1:1 into one) one that got converted. Every friend should always
   * be reachable from Direct Messages, so these still get a row;
   * clicking it (re)opens the chat. */
  function friendsWithoutChat(): User[] {
    const haveChat = new Set(
      state.dms.filter((d) => !isSelfDm(d) && d.participants.length === 1).map((d) => d.participants[0].id),
    );
    return friends.filter((f) => !haveChat.has(f.id));
  }

  async function openFriendChat(friend: User): Promise<void> {
    try {
      const dm = await api.post<DmSummary>("/api/dms", { usernames: [friend.username] });
      addOrUpdateDm(dm);
      await refreshDmList();
      selectDm(dm);
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Couldn't open that conversation.");
    }
  }

  async function refreshDmList(): Promise<void> {
    await syncDms();
    // Already sorted server-side: pinned conversations first (most
    // recently pinned first), then everyone else by most recent
    // message — see queries::dms::list_for_user.
    const items: HTMLElement[] = state.dms.map((dm) => {
      const item = document.createElement("div");
      item.className = "channel-item dm-item";
      item.classList.toggle("pinned", dm.pinned);
      item.dataset.channelId = dm.channel.id;
      if (state.activeChannel?.id === dm.channel.id) item.classList.add("active");
      const label = document.createElement("span");
      label.className = "channel-item-label";
      label.textContent = dmLabel(dm);
      // A group shows who's in it (as many names as fit — the label
      // ellipsizes) with how many people that is underneath, counting
      // yourself the way Discord does.
      let rowText: HTMLElement = label;
      if (isGroupDm(dm)) {
        rowText = document.createElement("div");
        rowText.className = "dm-item-text";
        const sub = document.createElement("span");
        sub.className = "dm-item-sub";
        sub.textContent = groupMemberCountLabel(dm);
        rowText.append(label, sub);
      }
      const pinBtn = document.createElement("button");
      pinBtn.type = "button";
      pinBtn.className = "icon-button dm-pin-btn";
      pinBtn.title = dm.pinned ? "Unpin" : "Pin";
      pinBtn.appendChild(icon("pin", 13));
      pinBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (dm.pinned) {
          await api.del(`/api/dms/${dm.channel.id}/pin`);
        } else {
          await api.post(`/api/dms/${dm.channel.id}/pin`);
        }
        void refreshDmList();
      });
      item.append(dmAvatarEl(dm), rowText, pinBtn);
      item.addEventListener("click", () => selectDm(dm));
      return item;
    });
    const stubs = friendsWithoutChat();
    if (stubs.length > 0) {
      const heading = document.createElement("div");
      heading.className = "dm-section-label";
      heading.textContent = "Friends";
      items.push(heading);
      for (const friend of stubs) {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "channel-item dm-item dm-friend-stub";
        item.dataset.friendId = friend.id;
        const label = document.createElement("span");
        label.className = "channel-item-label";
        label.textContent = friend.display_name;
        item.append(renderAvatarEl(friend.display_name, friend.avatar_file_id), label);
        item.addEventListener("click", () => void openFriendChat(friend));
        items.push(item);
      }
    }
    setChannelListRows(items);
  }

  async function switchToHome(): Promise<void> {
    state.activeGuild = null;
    state.onHome = true;
    sidebarHeaderName.textContent = "Direct Messages";
    inviteBtn.hidden = true;
    manageGuildBtn.hidden = true;
    createChannelBtn.hidden = true;
    newDmBtn.hidden = false;
    friendRequestsBtn.hidden = false;
    state.currentChannels = [];
    renderGuildRail();

    await refreshDmList();
    await syncDmVoiceState();

    if (state.dms.length > 0) {
      selectDm(state.dms[0]);
    } else {
      state.activeChannel = null;
      channelHeaderLabel.textContent = "";
      messageList.replaceChildren();
      const empty = document.createElement("p");
      empty.className = "message-list-empty";
      empty.textContent = "No conversations yet. Use + above to message someone.";
      messageList.appendChild(empty);
    }
  }

  /** Who is on a call in each conversation, from the server. Live join/leave
   * events only tell a client about calls that start while it is listening,
   * so anything that started before it loaded, reconnected or came back from
   * another server has to be asked for. */
  async function syncDmVoiceState(): Promise<void> {
    try {
      const snapshot = await api.get<{ channel_id: string; user_id: string }[]>("/api/dms/voice-state");
      for (const dm of state.dms) voiceParticipants.delete(dm.channel.id);
      for (const { channel_id, user_id } of snapshot) {
        const set = voiceParticipants.get(channel_id) ?? new Set<string>();
        set.add(user_id);
        voiceParticipants.set(channel_id, set);
      }
      renderDmCallStage();
    } catch {
      /* the live events still keep it current; try again next time */
    }
  }

  async function enterDefaultView(): Promise<void> {
    if (state.guilds.length > 0) {
      await switchGuild(state.guilds[0]);
    } else if (state.dms.length > 0) {
      await switchToHome();
    } else {
      renderGuildRail();
    }
  }

  return {
    enterDefaultView,
    mentionUsernamesFor,
    refreshDmList,
    switchGuild,
    switchToHome,
    syncDms,
    syncDmVoiceState,
  };
}

export type NavigationParts = ReturnType<typeof createNavigation>;
