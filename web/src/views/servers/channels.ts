// Creating a channel, and managing one (members, deleting).

import { ApiError, type Channel, type User, api } from "../../api";
import { icon } from "../../icons";
import { confirmDialog, renderAvatarEl, showNotice } from "../../ui";
import { actionSheet, entityRow, type SheetAction } from "../settings/lists";
import { openSettingsShell, type ShellTab } from "../settings/shell";
import { group, row } from "../settings/widgets";
import { field, modalShell } from "./widgets";

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
  const shell = openSettingsShell<ManageChannelTab>({});
  shell.setIdentity(renderAvatarEl(opts.channel.name, null), `#${opts.channel.name}`, "");
  void load();

  function memberRow(user: User): HTMLElement {
    const remove: SheetAction = {
      label: "Remove from channel",
      danger: true,
      run: async () => {
        const ok = await confirmDialog({
          title: "Remove this person?",
          message: `${user.display_name} will be removed from #${opts.channel.name}.`,
          confirmLabel: "Remove",
          danger: true,
        });
        if (!ok) return;
        try {
          await api.del(`/api/channels/${opts.channel.id}/members/${user.id}`);
          void load();
        } catch (err) {
          showNotice(err instanceof ApiError ? err.message : "Couldn't remove them.");
        }
      },
    };
    return entityRow({
      avatar: renderAvatarEl(user.display_name, user.avatar_file_id),
      name: user.display_name,
      detail: `@${user.username}`,
      onClick: () =>
        actionSheet({
          avatar: renderAvatarEl(user.display_name, user.avatar_file_id),
          title: user.display_name,
          detail: `@${user.username}`,
          actions: [remove],
        }),
    });
  }

  async function load(): Promise<void> {
    let roster: ChannelRoster;
    try {
      roster = await api.get<ChannelRoster>(`/api/channels/${opts.channel.id}/roster`);
    } catch {
      showNotice("Couldn't load the channel settings.");
      shell.close();
      return;
    }
    shell.setIdentity(
      renderAvatarEl(opts.channel.name, null),
      `#${opts.channel.name}`,
      `${roster.members.length} member${roster.members.length === 1 ? "" : "s"}`,
    );

    const page = (nodes: HTMLElement[]) => (c: HTMLElement) => void c.append(...nodes);
    const tabs: ShellTab<ManageChannelTab>[] = [];

    if (opts.channel.restricted) {
      const add = row({
        label: "Add a member",
        action: true,
        onClick: () =>
          renderUserPicker(async (user) => {
            await api.post(`/api/channels/${opts.channel.id}/members`, { user_id: user.id });
            void load();
          }),
      });
      tabs.push({
        id: "members",
        label: "Members",
        iconName: "users",
        render: page([group(null, add.el), group(null, ...roster.members.map(memberRow))]),
      });
    }

    // Red and set apart, like Log out/Danger in your own Settings: the
    // one page here that deletes the channel outright.
    const deleteRow = row({
      label: "Delete channel",
      danger: true,
      onClick: async () => {
        const ok = await confirmDialog({
          title: "Delete this channel?",
          message: `#${opts.channel.name} and every message in it will be gone for good.`,
          confirmLabel: "Delete channel",
          danger: true,
        });
        const guildId = opts.channel.guild_id;
        if (!ok || !guildId) return;
        try {
          await api.del(`/api/guilds/${guildId}/channels/${opts.channel.id}`);
          shell.close();
          opts.onDeleted();
        } catch (err) {
          showNotice(err instanceof ApiError ? err.message : "Couldn't delete the channel.");
        }
      },
    });
    tabs.push({
      id: "danger",
      label: "Danger Zone",
      iconName: "trash",
      caution: true,
      render: page([group(null, deleteRow.el)]),
    });
    shell.setTabs(tabs);
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
