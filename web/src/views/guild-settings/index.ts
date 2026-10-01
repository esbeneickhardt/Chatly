// The server-settings modal: the tab shell and data loading; each tab lives in its own module.

import { type Guild, type Role, type User, api } from "../../api";
import { icon } from "../../icons";
import { renderAvatarEl } from "../../ui";
import { renderAuditLog } from "../audit-log";
import { pageTitle } from "./widgets";
import { renderGeneralSection } from "./general";
import { renderMembersSection } from "./members";
import { renderRolesSection } from "./roles";
import { renderDangerZone, renderLeaveServerSection } from "./danger";
import { type Abilities } from "./members";
import { parsePermissions } from "./roles";
import type { ManageServerOptions, ServerSettingsContext } from "./context";

type Tab = "general" | "members" | "roles" | "audit" | "danger" | "leave";

export function renderManageServerModal(opts: ManageServerOptions): void {
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
  const ctx: ServerSettingsContext = { opts, reload: () => load(), close: () => backdrop.remove() };
  /** The tab showing, so a reload after an admin change lands back on
   * it instead of jumping to the first. */
  let lastTabId: Tab | null = null;
  void load();

  async function load(): Promise<void> {
    try {
      const [guild, members, roles] = await Promise.all([
        api.get<Guild>(`/api/guilds/${opts.guildId}`),
        api.get<User[]>(`/api/guilds/${opts.guildId}/members`),
        api.get<Role[]>(`/api/guilds/${opts.guildId}/roles`),
      ]);
      // One request per member, in parallel — fine at the member counts
      // this app targets (see docs/admin.md); there's no bulk
      // "every assignment in the guild" endpoint (see `Storage::
      // member_roles`, which is per-member by design).
      const memberRoleLists = await Promise.all(
        members.map((m) => api.get<Role[]>(`/api/guilds/${guild.id}/members/${m.id}/roles`)),
      );
      const memberRoleIds = new Map<string, Set<string>>(
        members.map((m, i) => [m.id, new Set(memberRoleLists[i].map((r) => r.id))]),
      );
      loadingText.remove();
      modal.querySelector(".settings-body")?.remove();
      renderBody(guild, members, roles, memberRoleIds);
    } catch {
      loadingText.textContent = "Failed to load server settings.";
    }
  }

  // Categorized like Settings' own Profile/Devices/Security tabs, to
  // avoid dumping General/Members/Danger-zone on the user all at once
  // — see UX_FEEDBACK.md. Every panel is built once up front and just
  // hidden/shown on tab switch (not torn down and recreated), so each
  // section's own live DOM patching after a save (renaming, removing a
  // member, etc.) survives navigating away to another tab and back —
  // there's no `guild`/`members` object to go stale in the meantime.
  function renderBody(
    guild: Guild,
    members: User[],
    roles: Role[],
    memberRoleIds: Map<string, Set<string>>,
  ): void {
    const isOwner = guild.owner_id === opts.currentUserId;
    const owner = members.find((m) => m.id === guild.owner_id) ?? null;
    // What *this viewer* can do here, from the server's own resolution
    // (owner and `ADMINISTRATOR` holders get everything) — the UI only
    // offers what the API will accept. "Server admin" means exactly:
    // the owner, or anyone with `ADMINISTRATOR`.
    const perms = parsePermissions(guild.viewer_permissions ?? "");
    const viewerIsAdmin = isOwner || perms.has("ADMINISTRATOR");
    const abilities: Abilities = {
      isOwner,
      isAdmin: viewerIsAdmin,
      canManageGuild: viewerIsAdmin || perms.has("MANAGE_GUILD"),
      canKick: viewerIsAdmin || perms.has("KICK_MEMBERS"),
    };
    const adminRoleIds = new Set(
      roles
        .filter((r) => parsePermissions(r.permissions).has("ADMINISTRATOR") && r.id !== guild.id)
        .map((r) => r.id),
    );
    const adminIds = new Set(
      members
        .filter((m) => [...(memberRoleIds.get(m.id) ?? [])].some((id) => adminRoleIds.has(id)))
        .map((m) => m.id),
    );

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
      renderAvatarEl(guild.name, guild.icon_file_id),
      (() => {
        const names = document.createElement("div");
        const nameEl = document.createElement("div");
        nameEl.className = "settings-nav-identity-name";
        nameEl.textContent = guild.name;
        const countEl = document.createElement("div");
        countEl.className = "settings-nav-identity-username";
        countEl.textContent = `${members.length} member${members.length === 1 ? "" : "s"}`;
        names.append(nameEl, countEl);
        return names;
      })(),
    );
    nav.appendChild(navIdentity);

    const tabs: {
      id: Tab;
      label: string;
      iconName: Parameters<typeof icon>[0];
      panel: HTMLElement;
      caution?: boolean;
    }[] = [
      {
        id: "general",
        label: "General",
        iconName: "hash",
        panel: pageTitle("General", renderGeneralSection(ctx, guild, owner, abilities.canManageGuild)),
      },
      {
        id: "members",
        label: "Members",
        iconName: "users",
        panel: pageTitle("Members", ...renderMembersSection(ctx, guild, members, abilities, adminIds)),
      },
      {
        id: "roles",
        label: "Roles",
        iconName: "shield",
        panel: pageTitle("Roles", ...renderRolesSection(guild, members, roles, memberRoleIds)),
      },
    ];
    if (abilities.canManageGuild) {
      // Who did what here — server admins only (the API requires
      // MANAGE_GUILD). Loaded when the tab is first built.
      tabs.push({
        id: "audit",
        label: "Audit log",
        iconName: "activity",
        panel: pageTitle(
          "Audit log",
          Object.assign(document.createElement("p"), {
            className: "muted-text",
            textContent: "Changes made by server admins, newest first.",
          }),
          renderAuditLog(`/api/guilds/${guild.id}/audit-log`),
        ),
      });
    }
    if (isOwner) {
      // Red-tinted and set apart from the rest, same treatment (and
      // same reason) as Logout/Danger in the user's own Settings menu
      // (see settings.ts) — this is the one tab in here that transfers
      // ownership or deletes the server outright, not "just another
      // settings pane."
      tabs.push({
        id: "danger",
        label: "Danger Zone",
        iconName: "trash",
        panel: pageTitle("Danger Zone", ...renderDangerZone(ctx, guild, members)),
        caution: true,
      });
    } else {
      // The owner's counterpart to Danger Zone: the one caution-
      // worthy thing a plain member can do here is leave outright
      // (the owner can't — they'd need to transfer ownership first,
      // which is what Danger Zone is for instead).
      tabs.push({
        id: "leave",
        label: "Leave Server",
        iconName: "log-out",
        panel: pageTitle("Leave Server", ...renderLeaveServerSection(ctx, guild)),
        caution: true,
      });
    }

    let currentTabId: Tab = tabs[0].id;
    function selectTab(tab: Tab): void {
      currentTabId = tab;
      lastTabId = tab;
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
    selectTab(tabs.some((t) => t.id === lastTabId) && lastTabId ? lastTabId : tabs[0].id);

    // Swipe left/right to move between adjacent tabs — the mobile tab
    // strip (see the `max-width: 768px` block in style.css) is a
    // horizontal scroller you can still tap any tab in directly, but
    // "swipe the actual screen" is the more natural mobile-app gesture
    // for moving to the next/previous one, the same idiom chat.ts's
    // own mobile nav-drawer swipe-to-close already uses. Only ever
    // moves one step and never wraps around.
    let tabSwipeStartX = 0;
    let tabSwipeStartY = 0;
    let tabSwiping = false;
    content.addEventListener(
      "touchstart",
      (e) => {
        if (e.touches.length !== 1) return;
        tabSwipeStartX = e.touches[0].clientX;
        tabSwipeStartY = e.touches[0].clientY;
        tabSwiping = true;
      },
      { passive: true },
    );
    content.addEventListener(
      "touchmove",
      (e) => {
        if (!tabSwiping) return;
        const dx = e.touches[0].clientX - tabSwipeStartX;
        const dy = e.touches[0].clientY - tabSwipeStartY;
        if (Math.abs(dy) > Math.abs(dx)) {
          // Reads as this panel's own vertical scroll, not a tab
          // swipe — bail out for the rest of this touch rather than
          // fighting it.
          tabSwiping = false;
        }
      },
      { passive: true },
    );
    content.addEventListener("touchend", (e) => {
      if (!tabSwiping) return;
      tabSwiping = false;
      const dx = (e.changedTouches[0]?.clientX ?? tabSwipeStartX) - tabSwipeStartX;
      const SWIPE_THRESHOLD_PX = 60;
      if (Math.abs(dx) < SWIPE_THRESHOLD_PX) return;
      const index = tabs.findIndex((t) => t.id === currentTabId);
      if (dx < 0 && index < tabs.length - 1) selectTab(tabs[index + 1].id);
      else if (dx > 0 && index > 0) selectTab(tabs[index - 1].id);
    });
  }
}
