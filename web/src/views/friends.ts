// Friend requests: this used to also house a "your friends" list and
// an invite-link/QR generator, but friends now just live in the DM
// list itself (ordered by last interaction, pinnable — see
// views/chat.ts) and adding one goes through a search-and-request flow
// instead (see chat.ts's "add a friend" modal) — so this modal's only
// job now is the pending requests those flows create: accept/decline
// what's incoming, cancel what you've sent.

import { api, type FriendRequest, type User } from "../api";
import { icon } from "../icons";
import { renderAvatarEl } from "../ui";

function modalShell(title: string): { backdrop: HTMLDivElement; modal: HTMLDivElement } {
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
  modal.appendChild(closeBtn);

  const heading = document.createElement("h2");
  heading.textContent = title;
  modal.appendChild(heading);

  document.body.appendChild(backdrop);
  return { backdrop, modal };
}

function section(heading: string, ...children: Node[]): HTMLElement {
  const el = document.createElement("section");
  el.className = "settings-section";
  const h = document.createElement("h3");
  h.textContent = heading;
  el.append(h, ...children);
  return el;
}

function emptyText(text: string): HTMLElement {
  const p = document.createElement("p");
  p.className = "muted-text";
  p.textContent = text;
  return p;
}

export function renderFriendRequestsModal(opts: { onAccepted: (friend: User) => void }): void {
  const { modal } = modalShell("Friend requests");

  const incomingBody = document.createElement("div");
  const outgoingBody = document.createElement("div");
  void load();

  async function load(): Promise<void> {
    try {
      const requests = await api.get<FriendRequest[]>("/api/friends/requests");
      renderIncoming(requests.filter((r) => r.incoming));
      renderOutgoing(requests.filter((r) => !r.incoming));
    } catch {
      incomingBody.replaceChildren(emptyText("Failed to load requests."));
      outgoingBody.replaceChildren();
    }
  }

  function renderIncoming(requests: FriendRequest[]): void {
    if (requests.length === 0) {
      incomingBody.replaceChildren(emptyText("No incoming requests."));
      return;
    }
    incomingBody.replaceChildren(
      ...requests.map((req) => {
        const row = document.createElement("div");
        row.className = "session-row";
        const identity = document.createElement("div");
        identity.className = "friend-identity";
        identity.append(renderAvatarEl(req.other.display_name, req.other.avatar_file_id));
        const name = document.createElement("span");
        name.textContent = req.other.display_name;
        identity.appendChild(name);

        const actions = document.createElement("div");
        actions.className = "settings-button-row";
        const acceptBtn = document.createElement("button");
        acceptBtn.textContent = "Accept";
        acceptBtn.addEventListener("click", async () => {
          acceptBtn.disabled = true;
          try {
            const friend = await api.post<User>(`/api/friends/requests/${req.id}`);
            row.remove();
            opts.onAccepted(friend);
          } catch {
            acceptBtn.disabled = false;
          }
        });
        const declineBtn = document.createElement("button");
        declineBtn.className = "secondary";
        declineBtn.textContent = "Decline";
        declineBtn.addEventListener("click", async () => {
          declineBtn.disabled = true;
          try {
            await api.del(`/api/friends/requests/${req.id}`);
            row.remove();
          } catch {
            declineBtn.disabled = false;
          }
        });
        actions.append(acceptBtn, declineBtn);

        row.append(identity, actions);
        return row;
      }),
    );
  }

  function renderOutgoing(requests: FriendRequest[]): void {
    if (requests.length === 0) {
      outgoingBody.replaceChildren(emptyText("No pending sent requests."));
      return;
    }
    outgoingBody.replaceChildren(
      ...requests.map((req) => {
        const row = document.createElement("div");
        row.className = "session-row";
        const identity = document.createElement("div");
        identity.className = "friend-identity";
        identity.append(renderAvatarEl(req.other.display_name, req.other.avatar_file_id));
        const name = document.createElement("span");
        name.textContent = req.other.display_name;
        identity.appendChild(name);

        const cancelBtn = document.createElement("button");
        cancelBtn.className = "secondary";
        cancelBtn.textContent = "Cancel";
        cancelBtn.addEventListener("click", async () => {
          cancelBtn.disabled = true;
          try {
            await api.del(`/api/friends/requests/${req.id}`);
            row.remove();
          } catch {
            cancelBtn.disabled = false;
          }
        });

        row.append(identity, cancelBtn);
        return row;
      }),
    );
  }

  modal.append(section("Incoming", incomingBody), section("Sent", outgoingBody));
}
