// Modals that search people by username: add a friend, add someone to a conversation.

import { ApiError, type DmSummary, type User, api } from "../../api";
import { icon } from "../../icons";
import { renderAvatarEl } from "../../ui";

/** Search-by-username user picker shared by "add a friend" and "add
 * people to this conversation" — they differ only in what a click on
 * a result actually does (`onPick`) and whether yourself should be
 * excluded from results (friending yourself makes no sense; adding
 * yourself to a conversation you're already in doesn't either, so
 * both callers exclude self — this just always does). */
export function renderUserSearchModal(opts: {
  title: string;
  /** Omit when the search field's own label/placeholder already says
   * everything this would (e.g. "Add a friend" — see UX_FEEDBACK.md). */
  subheading?: string;
  currentUsername: string;
  onPick: (user: User) => Promise<{ ok: true; message: string } | { ok: false; message: string }>;
  footer?: Node;
}): { backdrop: HTMLElement } {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) backdrop.remove();
  });

  const modal = document.createElement("div");
  modal.className = "modal";
  backdrop.appendChild(modal);

  const closeBtn = document.createElement("button");
  closeBtn.className = "icon-button modal-close";
  closeBtn.title = "Close";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.appendChild(icon("x", 16));
  closeBtn.addEventListener("click", () => backdrop.remove());

  const heading = document.createElement("h2");
  heading.textContent = opts.title;

  const subheading = document.createElement("p");
  subheading.className = "muted-text";
  subheading.textContent = opts.subheading ?? "";
  subheading.hidden = !opts.subheading;

  const searchWrap = document.createElement("div");
  searchWrap.className = "field";
  const label = document.createElement("label");
  label.textContent = "Search for someone";
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Search by username or name…";
  searchWrap.append(label, input);

  const results = document.createElement("div");
  results.className = "user-search-results";

  function renderResults(users: User[]): void {
    const visible = users.filter((u) => u.username !== opts.currentUsername);
    if (visible.length === 0) {
      const empty = document.createElement("p");
      empty.className = "muted-text";
      empty.textContent = "No matching users.";
      results.replaceChildren(empty);
      return;
    }
    const rows = visible.map((u) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "user-search-row";
      const avatar = renderAvatarEl(u.display_name, u.avatar_file_id);
      const identity = document.createElement("div");
      identity.className = "identity";
      const name = document.createElement("div");
      name.className = "name";
      name.textContent = u.display_name;
      const uname = document.createElement("div");
      uname.className = "username";
      uname.textContent = `@${u.username}`;
      identity.append(name, uname);
      row.append(avatar, identity);
      row.addEventListener("click", async () => {
        row.disabled = true;
        const outcome = await opts.onPick(u);
        uname.textContent = outcome.message;
        if (!outcome.ok) row.disabled = false;
      });
      return row;
    });
    results.replaceChildren(...rows);
  }

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  input.addEventListener("input", () => {
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    const query = input.value.trim();
    if (!query) {
      renderResults([]);
      return;
    }
    debounceTimer = setTimeout(() => {
      void api
        .get<User[]>(`/api/users/search?q=${encodeURIComponent(query)}`)
        .then(renderResults)
        .catch(() => {
          /* a transient search failure just leaves the previous results showing */
        });
    }, 200);
  });

  modal.append(closeBtn, heading, subheading, searchWrap, results);
  if (opts.footer) modal.appendChild(opts.footer);
  document.body.appendChild(backdrop);
  input.focus();
  return { backdrop };
}

/** The "+" button's modal: search someone by username and send them a
 * friend request — nothing happens until they accept it (see
 * UX_FEEDBACK). No "Message yourself" shortcut here anymore — the
 * self-DM is now always present at the top of the DM list on its own
 * (see `refreshDmList`/the server always ensuring it exists), so there
 * was nothing left for a dedicated button to do. */
export function renderAddFriendModal(opts: { currentUsername: string }): void {
  renderUserSearchModal({
    title: "Add a friend",
    currentUsername: opts.currentUsername,
    onPick: async (user) => {
      try {
        await api.post(`/api/friends/requests`, { username: user.username });
        return { ok: true, message: "Request sent" };
      } catch (err) {
        return { ok: false, message: err instanceof ApiError ? err.message : "Something went wrong" };
      }
    },
  });
}

/** Turns the current 1:1 (or grows an existing group) by adding
 * another user directly — no friend-request gate, same as the old
 * group-DM picker never had one. */
export function renderAddParticipantModal(opts: {
  channelId: string;
  currentUsername: string;
  onAdded: (dm: DmSummary) => void;
}): void {
  renderUserSearchModal({
    title: "Add people",
    subheading: "Add someone to this conversation.",
    currentUsername: opts.currentUsername,
    onPick: async (user) => {
      try {
        const dm = await api.post<DmSummary>(`/api/dms/${opts.channelId}/participants`, {
          username: user.username,
        });
        opts.onAdded(dm);
        return { ok: true, message: "Added" };
      } catch (err) {
        return { ok: false, message: err instanceof ApiError ? err.message : "Something went wrong" };
      }
    },
  });
}
