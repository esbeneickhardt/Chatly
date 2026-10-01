// Creating a channel, and managing one (members, deleting).

import { ApiError, type Channel, type User, api } from "../../api";
import { icon } from "../../icons";
import { confirmDialog, renderAvatarEl } from "../../ui";
import { field, modalShell, pageTitle } from "./widgets";

export function renderCreateChannelModal(opts: {
  guildId: string;
  onCreated: (channel: Channel) => void;
}): void {
  const { modal } = modalShell("Create a channel");

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.placeholder = "new-channel";

  const kindRow = document.createElement("div");
  kindRow.className = "channel-kind-row";

  let kind: "text" | "voice" = "text";
  const textOption = document.createElement("button");
  textOption.type = "button";
  textOption.className = "channel-kind-option active";
  textOption.append(icon("hash", 16), document.createTextNode("Text"));
  const voiceOption = document.createElement("button");
  voiceOption.type = "button";
  voiceOption.className = "channel-kind-option";
  voiceOption.append(icon("volume-2", 16), document.createTextNode("Voice"));

  textOption.addEventListener("click", () => {
    kind = "text";
    textOption.classList.add("active");
    voiceOption.classList.remove("active");
  });
  voiceOption.addEventListener("click", () => {
    kind = "voice";
    voiceOption.classList.add("active");
    textOption.classList.remove("active");
  });
  kindRow.append(textOption, voiceOption);

  const error = document.createElement("p");
  error.className = "error-text";
  error.hidden = true;

  const createBtn = document.createElement("button");
  createBtn.textContent = "Create channel";
  createBtn.addEventListener("click", async () => {
    error.hidden = true;
    const name = nameInput.value.trim();
    if (!name) return;
    createBtn.disabled = true;
    try {
      const channel = await api.post<Channel>(`/api/guilds/${opts.guildId}/channels`, {
        name,
        kind,
      });
      modal.closest(".modal-backdrop")?.remove();
      opts.onCreated(channel);
    } catch (err) {
      error.textContent = err instanceof ApiError ? err.message : "Something went wrong.";
      error.hidden = false;
    } finally {
      createBtn.disabled = false;
    }
  });

  modal.append(field("Channel name", nameInput), kindRow, error, createBtn);
}

interface ChannelRoster {
  members: User[];
}

type ManageChannelTab = "members" | "danger";

/** Categorized the same way "Manage server" is (see UX_FEEDBACK.md) —
 * this used to dump Admins/Members/Danger-zone as one flat scroll,
 * which read as a messy wall for what's usually just a couple of
 * rows. Same "build every panel once, toggle which is hidden" shell
 * as guild-settings.ts's tabs, for the same reason: a member add or
 * remove needs to update that panel in place without losing whichever
 * tab is currently showing.
 *
 * There is no "Admins" tab any more: who can manage a channel is a
 * *server*-level permission (Manage server → Roles / Members), not a
 * per-channel list. This dialog only edits who can see the channel and
 * deletes it. */
export function renderManageChannelModal(opts: { channel: Channel; onDeleted: () => void }): void {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) backdrop.remove();
  });

  const modal = document.createElement("div");
  modal.className = "modal settings-modal";
  backdrop.appendChild(modal);

  const closeBtn = document.createElement("button");
  closeBtn.className = "icon-button settings-close";
  closeBtn.title = "Close";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.appendChild(icon("x", 16));
  closeBtn.addEventListener("click", () => backdrop.remove());
  modal.appendChild(closeBtn);

  const loadingText = document.createElement("p");
  loadingText.className = "muted-text settings-loading";
  loadingText.textContent = "Loading…";
  modal.appendChild(loadingText);

  document.body.appendChild(backdrop);
  void load();

  function renderRow(user: User, onRemove: () => Promise<void>): HTMLElement {
    const row = document.createElement("div");
    row.className = "session-row";
    const identity = document.createElement("div");
    identity.className = "friend-identity";
    identity.append(renderAvatarEl(user.display_name, user.avatar_file_id));
    const name = document.createElement("span");
    name.textContent = `${user.display_name} (@${user.username})`;
    identity.appendChild(name);
    row.appendChild(identity);
    const removeBtn = document.createElement("button");
    removeBtn.className = "secondary";
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", async () => {
      const ok = await confirmDialog({
        title: "Remove this person?",
        message: `${user.display_name} will be removed from #${opts.channel.name}.`,
        confirmLabel: "Remove",
        danger: true,
      });
      if (!ok) return;
      removeBtn.disabled = true;
      await onRemove();
    });
    row.append(removeBtn);
    return row;
  }

  async function load(): Promise<void> {
    const roster = await api.get<ChannelRoster>(`/api/channels/${opts.channel.id}/roster`);
    loadingText.remove();
    modal.querySelector(".settings-body")?.remove();

    const body = document.createElement("div");
    body.className = "settings-body";
    const nav = document.createElement("nav");
    nav.className = "settings-nav";
    const content = document.createElement("div");
    content.className = "settings-content";
    body.append(nav, content);
    modal.appendChild(body);

    const navIdentity = document.createElement("div");
    navIdentity.className = "settings-nav-identity";
    navIdentity.append(
      renderAvatarEl(opts.channel.name, null),
      (() => {
        const names = document.createElement("div");
        const nameEl = document.createElement("div");
        nameEl.className = "settings-nav-identity-name";
        nameEl.textContent = `#${opts.channel.name}`;
        const countEl = document.createElement("div");
        countEl.className = "settings-nav-identity-username";
        countEl.textContent = `${roster.members.length} member${roster.members.length === 1 ? "" : "s"}`;
        names.append(nameEl, countEl);
        return names;
      })(),
    );
    nav.appendChild(navIdentity);

    const tabs: {
      id: ManageChannelTab;
      label: string;
      iconName: Parameters<typeof icon>[0];
      panel: HTMLElement;
      caution?: boolean;
    }[] = [];

    if (opts.channel.restricted) {
      const membersList = document.createElement("div");
      for (const member of roster.members) {
        membersList.appendChild(
          renderRow(member, async () => {
            await api.del(`/api/channels/${opts.channel.id}/members/${member.id}`);
            void load();
          }),
        );
      }
      const addMemberBtn = document.createElement("button");
      addMemberBtn.className = "secondary";
      addMemberBtn.textContent = "Add a member";
      addMemberBtn.addEventListener("click", () => {
        renderUserPicker(async (user) => {
          await api.post(`/api/channels/${opts.channel.id}/members`, { user_id: user.id });
          void load();
        });
      });
      tabs.push({
        id: "members",
        label: "Members",
        iconName: "users",
        panel: pageTitle("Members", membersList, addMemberBtn),
      });
    }

    const deleteStartBtn = document.createElement("button");
    deleteStartBtn.type = "button";
    deleteStartBtn.className = "danger";
    deleteStartBtn.textContent = "Delete Channel";

    function buildDeletePanel(): HTMLElement {
      const panel = document.createElement("div");
      panel.className = "reveal-panel";

      const hint = document.createElement("p");
      hint.className = "muted-text";
      hint.textContent = `Deletes #${opts.channel.name} and every message in it. This can't be undone.`;

      const error = document.createElement("p");
      error.className = "error-text";
      error.hidden = true;

      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "secondary";
      cancelBtn.textContent = "Cancel";
      cancelBtn.addEventListener("click", () => panel.replaceWith(deleteStartBtn));

      const confirmBtn = document.createElement("button");
      confirmBtn.type = "button";
      confirmBtn.className = "danger";
      confirmBtn.textContent = "Delete Channel";
      confirmBtn.addEventListener("click", async () => {
        const ok = await confirmDialog({
          title: "Delete this channel?",
          message: `#${opts.channel.name} and every message in it will be gone for good.`,
          confirmLabel: "Delete Channel",
          danger: true,
        });
        if (!ok) return;
        error.hidden = true;
        confirmBtn.disabled = true;
        const guildId = opts.channel.guild_id;
        if (!guildId) return;
        try {
          await api.del(`/api/guilds/${guildId}/channels/${opts.channel.id}`);
          backdrop.remove();
          opts.onDeleted();
        } catch (err) {
          error.textContent = err instanceof ApiError ? err.message : "Couldn't delete the channel.";
          error.hidden = false;
          confirmBtn.disabled = false;
        }
      });

      const actions = document.createElement("div");
      actions.className = "reveal-panel-actions";
      actions.append(cancelBtn, confirmBtn);
      panel.append(hint, actions, error);
      return panel;
    }
    deleteStartBtn.addEventListener("click", () => deleteStartBtn.replaceWith(buildDeletePanel()));

    // Red-tinted and set apart from the rest, same treatment (and same
    // reason) as Logout/Danger in the user's own Settings menu — see
    // settings.ts — this is the one tab here that deletes the channel
    // outright, not "just another settings pane."
    tabs.push({
      id: "danger",
      label: "Danger Zone",
      iconName: "trash",
      panel: pageTitle("Danger Zone", deleteStartBtn),
      caution: true,
    });

    function selectTab(tab: ManageChannelTab): void {
      for (const btn of Array.from(nav.children)) {
        (btn as HTMLElement).classList.toggle("active", (btn as HTMLElement).dataset.tab === tab);
      }
      for (const t of tabs) {
        t.panel.hidden = t.id !== tab;
      }
    }

    const firstCautionId = tabs.find((t) => t.caution)?.id;
    const navButtons = tabs.map((tab) => {
      const btn = document.createElement("button");
      btn.type = "button";
      let className = tab.caution ? "settings-nav-item caution" : "settings-nav-item";
      if (tab.id === firstCautionId) className += " caution-first";
      btn.className = className;
      btn.dataset.tab = tab.id;
      btn.append(icon(tab.iconName, 15), document.createTextNode(tab.label));
      btn.addEventListener("click", () => selectTab(tab.id));
      return btn;
    });
    nav.append(...navButtons);
    content.replaceChildren(...tabs.map((t) => t.panel));
    selectTab(tabs[0].id);
  }

  function renderUserPicker(onPick: (user: User) => void): void {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) backdrop.remove();
    });
    const picker = document.createElement("div");
    picker.className = "modal";
    backdrop.appendChild(picker);
    const closeBtn = document.createElement("button");
    closeBtn.className = "icon-button modal-close";
    closeBtn.title = "Close";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.appendChild(icon("x", 16));
    closeBtn.addEventListener("click", () => backdrop.remove());
    const heading = document.createElement("h2");
    heading.textContent = "Search for someone";
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Search by username or name…";
    const results = document.createElement("div");
    results.className = "user-search-results";

    let debounce: ReturnType<typeof setTimeout> | null = null;
    input.addEventListener("input", () => {
      if (debounce !== null) clearTimeout(debounce);
      const query = input.value.trim();
      if (!query) {
        results.replaceChildren();
        return;
      }
      debounce = setTimeout(() => {
        void api.get<User[]>(`/api/users/search?q=${encodeURIComponent(query)}`).then((users) => {
          results.replaceChildren(
            ...users.map((u) => {
              const row = document.createElement("button");
              row.type = "button";
              row.className = "user-search-row";
              const identity = document.createElement("div");
              identity.className = "identity";
              const name = document.createElement("div");
              name.className = "name";
              name.textContent = u.display_name;
              const uname = document.createElement("div");
              uname.className = "username";
              uname.textContent = `@${u.username}`;
              identity.append(name, uname);
              row.appendChild(identity);
              row.addEventListener("click", async () => {
                await onPick(u);
                backdrop.remove();
              });
              return row;
            }),
          );
        });
      }, 200);
    });

    picker.append(closeBtn, heading, input, results);
    document.body.appendChild(backdrop);
    input.focus();
  }
}
