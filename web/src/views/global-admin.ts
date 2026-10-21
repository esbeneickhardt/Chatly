// The global admin's panel: everything across the *entire deployment*,
// as opposed to one server's own admin tools (Manage server). Views for
// every account, every server (whether or not the admin has joined it),
// the activity log and the app icon. Only ever shown to the instance
// owner (`is_owner`), and the API enforces that independently (see
// `api::admin`). Accounts and servers are rows; tapping one opens what
// can be done to it.
//
// Vocabulary used throughout the UI: a "server" is what "Add Server"
// creates; "global" means across the whole instance.

import { api, ApiError, type AdminGuildSummary, type User } from "../api";
import { confirmDialog, renderAvatarEl, showNotice } from "../ui";
import { renderAuditLog } from "./audit-log";
import { actionSheet, entityRow } from "./settings/lists";
import { errorMessage, field, formDialog, group } from "./settings/widgets";

function note(text: string, className = "muted-text"): HTMLElement {
  const p = document.createElement("p");
  p.className = className;
  p.textContent = text;
  return p;
}

function spinner(): HTMLElement {
  const el = document.createElement("div");
  el.className = "settings-spinner";
  el.setAttribute("aria-label", "Loading");
  return el;
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Accounts / Servers / Activity / App icon, switched by a segmented
 * control; each view loads the first time it's shown. */
export function renderGlobalAdminSection(container: HTMLElement): void {
  const views = [
    { id: "accounts", label: "Accounts", load: renderAccounts },
    { id: "servers", label: "Servers", load: renderServers },
    {
      id: "activity",
      label: "Activity",
      load: (panel: HTMLElement) => void panel.appendChild(renderAuditLog("/api/admin/audit-log")),
    },
    { id: "icon", label: "App icon", load: renderAppIcon },
  ].map((view) => ({ ...view, panel: document.createElement("div") }));
  const loaded = new Set<string>();

  const switcher = document.createElement("div");
  switcher.className = "segmented segmented-fill";
  switcher.setAttribute("role", "tablist");
  const buttons = views.map((view) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute("role", "tab");
    btn.textContent = view.label;
    btn.addEventListener("click", () => show(view.id));
    return btn;
  });
  switcher.append(...buttons);

  let currentIndex = 0;
  function show(id: string, from?: "left" | "right"): void {
    currentIndex = views.findIndex((v) => v.id === id);
    if (currentIndex === 0) root.dataset.firstTab = "";
    else delete root.dataset.firstTab;
    views.forEach((view, i) => {
      const active = view.id === id;
      view.panel.hidden = !active;
      buttons[i].classList.toggle("active", active);
      buttons[i].setAttribute("aria-selected", String(active));
      if (active && from) {
        view.panel.classList.remove("slide-from-left", "slide-from-right");
        void view.panel.offsetWidth; // restart the animation
        view.panel.classList.add(from === "right" ? "slide-from-right" : "slide-from-left");
      }
      if (active && !loaded.has(id)) {
        loaded.add(id);
        void view.load(view.panel);
      }
    });
    buttons[currentIndex].scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  // Swipe sideways to move between the tabs, like a phone app's tab
  // pages. On the first tab a swipe right is left to the settings sheet
  // (back to the menu; see shell.ts).
  const root = document.createElement("div");
  root.dataset.swipeTabs = "";
  let startX = 0;
  let startY = 0;
  let tracking = false;
  root.addEventListener(
    "touchstart",
    (e) => {
      const target = e.target as HTMLElement;
      tracking = e.touches.length === 1 && !target.closest("input, select, textarea, .segmented");
      startX = e.touches[0]?.clientX ?? 0;
      startY = e.touches[0]?.clientY ?? 0;
    },
    { passive: true },
  );
  root.addEventListener(
    "touchmove",
    (e) => {
      if (!tracking) return;
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;
      if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 10) tracking = false;
    },
    { passive: true },
  );
  root.addEventListener("touchend", (e) => {
    if (!tracking) return;
    tracking = false;
    const dx = (e.changedTouches[0]?.clientX ?? startX) - startX;
    if (Math.abs(dx) < 60) return;
    if (dx < 0 && currentIndex < views.length - 1) show(views[currentIndex + 1].id, "right");
    else if (dx > 0 && currentIndex > 0) show(views[currentIndex - 1].id, "left");
  });

  root.append(switcher, ...views.map((v) => v.panel));
  container.appendChild(root);
  show("accounts");
}

// --- App icon -------------------------------------------------------------

const ICON_NAMES: Record<string, string> = {
  classic: "Chatly",
  handheld: "Handheld",
  screen: "Screen",
  keypad: "Keypad",
};

/** Everyone's home-screen, tab and notification icon (see
 * `crates/server/src/app_icon.rs`). Picking one takes effect at once. */
async function renderAppIcon(panel: HTMLElement): Promise<void> {
  const grid = document.createElement("div");
  grid.className = "app-icon-grid";
  grid.setAttribute("role", "radiogroup");
  grid.setAttribute("aria-label", "App icon");
  panel.appendChild(grid);

  let state: { icon: string; choices: string[] };
  try {
    state = await api.get("/api/admin/app-icon");
  } catch {
    panel.replaceChildren(note("Couldn't load the app icons.", "error-text"));
    return;
  }

  const tiles = state.choices.map((id) => {
    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = "app-icon-tile";
    tile.setAttribute("role", "radio");
    tile.dataset.icon = id;
    const img = document.createElement("img");
    img.src = `/app-icons/${id}/icon-192.png`;
    img.alt = "";
    const label = document.createElement("span");
    label.textContent = ICON_NAMES[id] ?? id;
    tile.append(img, label);
    tile.addEventListener("click", () => void pick(id));
    return tile;
  });
  grid.append(...tiles);

  function show(current: string): void {
    for (const tile of tiles) {
      const selected = tile.dataset.icon === current;
      tile.classList.toggle("selected", selected);
      tile.setAttribute("aria-checked", String(selected));
    }
  }
  show(state.icon);

  async function pick(id: string): Promise<void> {
    if (id === state.icon) return;
    const previous = state.icon;
    show(id);
    try {
      state = await api.post("/api/admin/app-icon", { icon: id });
      refreshPageIcons(state.icon);
    } catch (err) {
      show(previous);
      showNotice(err instanceof ApiError ? err.message : "Couldn't change the app icon.");
    }
  }
}

/** This tab's own icons follow the change straight away (the addresses
 * stay the same; the query just makes the browser fetch them again). */
function refreshPageIcons(icon: string): void {
  for (const link of document.querySelectorAll<HTMLLinkElement>(
    "link[rel='icon'], link[rel='apple-touch-icon']",
  )) {
    const url = new URL(link.href);
    url.searchParams.set("icon", icon);
    link.href = url.toString();
  }
}

// --- Accounts -------------------------------------------------------------

function renderAccounts(panel: HTMLElement): void {
  async function load(): Promise<void> {
    panel.replaceChildren(spinner());
    try {
      const users = await api.get<User[]>("/api/admin/users");
      panel.replaceChildren(group(plural(users.length, "account"), ...users.map(userRow)));
    } catch {
      panel.replaceChildren(note("Couldn't load the accounts.", "error-text"));
    }
  }

  function userRow(u: User): HTMLElement {
    const avatar = (): HTMLElement => renderAvatarEl(u.display_name, u.avatar_file_id);
    return entityRow({
      avatar: avatar(),
      name: u.display_name,
      detail: `@${u.username}`,
      badge: u.is_owner ? "Global admin" : u.is_bot ? "Bot" : undefined,
      onClick: u.is_owner
        ? undefined
        : () =>
            actionSheet({
              avatar: avatar(),
              title: u.display_name,
              detail: `@${u.username}`,
              actions: [
                ...(u.is_bot ? [] : [{ label: "Reset password", run: () => void resetPassword(u) }]),
                { label: "Delete account", danger: true, run: () => void deleteAccount(u) },
              ],
            }),
    });
  }

  // The new password is generated by the server and only ever shown
  // here, once; the admin passes it on.
  async function resetPassword(u: User): Promise<void> {
    const ok = await confirmDialog({
      title: `Reset ${u.display_name}'s password?`,
      message: "They're signed out everywhere.",
      confirmLabel: "Reset password",
    });
    if (!ok) return;
    let password: string;
    try {
      ({ password } = await api.post<{ password: string }>(`/api/admin/users/${u.id}/password`));
    } catch (err) {
      showNotice(errorMessage(err));
      return;
    }
    const wrap = field("New password");
    const box = document.createElement("div");
    box.className = "admin-new-password";
    const code = document.createElement("code");
    code.className = "secret-code";
    code.textContent = password;
    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "secondary";
    copyBtn.textContent = "Copy";
    copyBtn.addEventListener("click", async () => {
      await navigator.clipboard.writeText(password);
      copyBtn.textContent = "Copied";
    });
    box.append(code, copyBtn);
    wrap.appendChild(box);
    const dialog = formDialog({
      title: u.display_name,
      content: [wrap],
      submitLabel: "Done",
      onSubmit: async () => null,
    });
    dialog.actions.querySelector("button.secondary")?.remove();
  }

  // No choice to make here — removing someone else's account always
  // wipes everything (messages actually deleted, the account row
  // hard-removed, every server they own taken down too, even ones with
  // other people still in them — see `api::admin::delete_user`).
  async function deleteAccount(u: User): Promise<void> {
    const ok = await confirmDialog({
      title: `Delete ${u.display_name}?`,
      message: "Their account, every message they've sent and every server they own are gone for good.",
      confirmLabel: "Delete account",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.post(`/api/admin/users/${u.id}/delete`);
      await load();
    } catch (err) {
      showNotice(errorMessage(err));
    }
  }

  void load();
}

// --- Servers --------------------------------------------------------------

function renderServers(panel: HTMLElement): void {
  async function load(): Promise<void> {
    panel.replaceChildren(spinner());
    try {
      const guilds = await api.get<AdminGuildSummary[]>("/api/admin/guilds");
      panel.replaceChildren(
        guilds.length
          ? group(plural(guilds.length, "server"), ...guilds.map(serverRow))
          : note("No servers yet."),
      );
    } catch {
      panel.replaceChildren(note("Couldn't load the servers.", "error-text"));
    }
  }

  function serverRow(g: AdminGuildSummary): HTMLElement {
    const avatar = (): HTMLElement => renderAvatarEl(g.name, g.icon_file_id);
    const detail = `${g.owner_display_name} · ${plural(g.member_count, "member")} · ${plural(g.channel_count, "channel")}`;
    return entityRow({
      avatar: avatar(),
      name: g.name,
      detail,
      onClick: () =>
        actionSheet({
          avatar: avatar(),
          title: g.name,
          detail: `Created ${new Date(g.created_at).toLocaleDateString()} · owner @${g.owner_username}`,
          actions: [
            { label: "Change owner", run: () => void changeOwner(g) },
            { label: "Delete server", danger: true, run: () => void deleteServer(g) },
          ],
        }),
    });
  }

  /** Hands the server to one of its members (for an owner who's gone). */
  async function changeOwner(g: AdminGuildSummary): Promise<void> {
    let members: User[];
    try {
      members = await api.get<User[]>(`/api/admin/guilds/${g.id}/members`);
    } catch (err) {
      showNotice(errorMessage(err, "Couldn't load the members."));
      return;
    }
    const candidates = members.filter((m) => m.id !== g.owner_id);
    if (candidates.length === 0) {
      showNotice(`${g.name} has no other members to hand it to.`);
      return;
    }
    const ownerField = field("New owner");
    const select = document.createElement("select");
    for (const m of candidates) {
      const option = document.createElement("option");
      option.value = m.id;
      option.textContent = `${m.display_name} (@${m.username})`;
      select.appendChild(option);
    }
    ownerField.appendChild(select);
    formDialog({
      title: `Change the owner of ${g.name}`,
      content: [ownerField],
      submitLabel: "Make owner",
      danger: true,
      onSubmit: async () => {
        try {
          await api.post(`/api/admin/guilds/${g.id}/owner`, { user_id: select.value });
        } catch (err) {
          return errorMessage(err, "Couldn't change the owner.");
        }
        void load();
        return null;
      },
    });
  }

  async function deleteServer(g: AdminGuildSummary): Promise<void> {
    const ok = await confirmDialog({
      title: `Delete ${g.name}?`,
      message: `Its ${plural(g.channel_count, "channel")} and every message in them are gone for good, for all ${plural(g.member_count, "member")}.`,
      confirmLabel: "Delete server",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/api/admin/guilds/${g.id}`);
      await load();
    } catch (err) {
      showNotice(errorMessage(err, "Couldn't delete that server."));
    }
  }

  void load();
}
