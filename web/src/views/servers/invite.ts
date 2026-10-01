// Invite modals: a server invite link, and inviting friends to a voice channel.

import { ApiError, type DmSummary, type Invite, type User, api } from "../../api";
import { icon } from "../../icons";
import { renderAvatarEl } from "../../ui";
import { modalShell } from "./widgets";

/** One invite link for any destination — a guild channel or a DM.
 * Whoever follows it, with or without a Chatly account already, ends
 * up exactly there (see UX_FEEDBACK.md for why this replaced two
 * separate invite systems that each only handled one of those cases). */
export function renderInviteModal(opts: { title: string; channelId: string }): void {
  const { modal } = modalShell(opts.title);

  const hint = document.createElement("p");
  hint.className = "muted-text";
  hint.textContent = "Generating an invite link...";
  modal.appendChild(hint);

  void api
    .post<Invite>(`/api/invites`, { channel_id: opts.channelId })
    .then((invite) => {
      hint.remove();

      const box = document.createElement("div");
      box.className = "secret-code";
      box.textContent = invite.url ?? invite.code;

      const copyBtn = document.createElement("button");
      copyBtn.textContent = "Copy link";
      copyBtn.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(invite.url ?? invite.code);
          copyBtn.textContent = "Copied!";
          setTimeout(() => {
            copyBtn.textContent = "Copy link";
          }, 1500);
        } catch {
          /* clipboard permission denied; the text is still selectable */
        }
      });

      modal.append(box, copyBtn);
    })
    .catch((err) => {
      hint.textContent = err instanceof ApiError ? err.message : "Something went wrong.";
    });
}

/** The Discord-style "Invite to Voice" panel opened from hovering a
 * voice channel: a friend picker (one click sends them the invite
 * link as a DM — no copy-paste needed) plus the same link-only
 * fallback `renderInviteModal` already offers, since not everyone
 * worth inviting is a friend yet.
 *
 * "Friends" here means exactly the 1:1 DMs already in this account's
 * DM list — this app only ever creates one of those once two accounts
 * *become* friends (see `api::friends::accept_request`), so the DM
 * list already *is* the friends list; no separate `/api/friends`
 * lookup needed, and it comes with the DM channel id to send into for
 * free. */
export function renderInviteToVoiceModal(opts: {
  guildName: string;
  channelId: string;
  channelName: string;
  currentUserId: string;
}): void {
  const { modal } = modalShell(`Invite friends to ${opts.guildName}`);

  const subheading = document.createElement("p");
  subheading.className = "muted-text invite-voice-subheading";
  subheading.append(
    document.createTextNode("Recipients will land in "),
    icon("volume-2", 14),
    document.createTextNode(opts.channelName),
  );
  modal.appendChild(subheading);

  const searchWrap = document.createElement("div");
  searchWrap.className = "icon-input-row";
  const searchInput = document.createElement("input");
  searchInput.type = "text";
  searchInput.placeholder = "Search for friends";
  searchWrap.append(icon("search", 15), searchInput);
  modal.appendChild(searchWrap);

  const listHeading = document.createElement("h3");
  listHeading.textContent = "Friends";
  modal.appendChild(listHeading);

  const list = document.createElement("div");
  modal.appendChild(list);

  const linkHeading = document.createElement("h3");
  linkHeading.textContent = "Or, send a server invite link";

  const linkHint = document.createElement("p");
  linkHint.className = "muted-text";
  linkHint.textContent = "Generating an invite link...";

  modal.append(linkHeading, linkHint);

  // One invite link, created once and reused both for every "Invite"
  // click below and the copy-link box at the bottom, rather than
  // minting a fresh one per friend.
  const invitePromise = api
    .post<Invite>("/api/invites", { channel_id: opts.channelId })
    .then((invite) => invite.url ?? invite.code);

  invitePromise
    .then((link) => {
      linkHint.remove();
      const box = document.createElement("div");
      box.className = "secret-code";
      box.textContent = link;
      const copyBtn = document.createElement("button");
      copyBtn.textContent = "Copy link";
      copyBtn.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(link);
          copyBtn.textContent = "Copied!";
          setTimeout(() => {
            copyBtn.textContent = "Copy link";
          }, 1500);
        } catch {
          /* clipboard permission denied; the text is still selectable */
        }
      });
      modal.append(box, copyBtn);
    })
    .catch((err) => {
      linkHint.textContent = err instanceof ApiError ? err.message : "Something went wrong.";
    });

  let friends: { user: User; channelId: string }[] = [];

  function friendRow(friend: User, dmChannelId: string): HTMLElement {
    const row = document.createElement("div");
    row.className = "session-row";

    const identity = document.createElement("div");
    identity.className = "friend-identity";
    identity.appendChild(renderAvatarEl(friend.display_name, friend.avatar_file_id));
    const meta = document.createElement("div");
    meta.className = "meta";
    const name = document.createElement("div");
    name.textContent = friend.display_name;
    const username = document.createElement("div");
    username.className = "muted-text";
    username.textContent = `@${friend.username}`;
    meta.append(name, username);
    identity.appendChild(meta);
    row.appendChild(identity);

    const inviteBtn = document.createElement("button");
    inviteBtn.type = "button";
    inviteBtn.className = "secondary";
    inviteBtn.textContent = "Invite";
    inviteBtn.addEventListener("click", async () => {
      inviteBtn.disabled = true;
      try {
        const link = await invitePromise;
        await api.post(`/api/channels/${dmChannelId}/messages`, {
          content: `Join me in ${opts.channelName}: ${link}`,
        });
        inviteBtn.textContent = "Invited";
      } catch {
        inviteBtn.textContent = "Invite";
        inviteBtn.disabled = false;
      }
    });
    row.appendChild(inviteBtn);

    return row;
  }

  function renderList(filterText: string): void {
    const q = filterText.trim().toLowerCase();
    const matches = friends.filter(
      ({ user }) =>
        !q || user.display_name.toLowerCase().includes(q) || user.username.toLowerCase().includes(q),
    );
    if (matches.length === 0) {
      const empty = document.createElement("p");
      empty.className = "muted-text";
      empty.textContent = friends.length === 0 ? "No friends yet." : "No friends match your search.";
      list.replaceChildren(empty);
      return;
    }
    list.replaceChildren(...matches.map(({ user, channelId }) => friendRow(user, channelId)));
  }
  searchInput.addEventListener("input", () => renderList(searchInput.value));

  async function load(): Promise<void> {
    try {
      const dms = await api.get<DmSummary[]>("/api/dms");
      friends = dms.flatMap((dm) => {
        const [only] = dm.participants;
        return dm.participants.length === 1 && only && only.id !== opts.currentUserId
          ? [{ user: only, channelId: dm.channel.id }]
          : [];
      });
      renderList(searchInput.value);
    } catch {
      const failed = document.createElement("p");
      failed.className = "muted-text";
      failed.textContent = "Couldn't load friends.";
      list.replaceChildren(failed);
    }
  }
  void load();
}
