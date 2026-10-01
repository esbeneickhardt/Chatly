// A paged list of audit-log entries — shared by a server's own "Audit log"
// tab (Manage server) and the global admin's "Activity" view. The caller
// supplies how to fetch a page; this renders it and offers "Load more".

import { api } from "../api";
import { describeAudit, type AuditEntry } from "../audit-text";

const PAGE_SIZE = 50;

export function renderAuditLog(path: string): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "audit-log";

  const list = document.createElement("ol");
  list.className = "audit-list";
  const status = document.createElement("p");
  status.className = "muted-text";
  status.setAttribute("aria-live", "polite");
  const moreBtn = document.createElement("button");
  moreBtn.type = "button";
  moreBtn.className = "secondary";
  moreBtn.textContent = "Load more";
  moreBtn.hidden = true;
  wrap.append(status, list, moreBtn);

  let oldest: string | null = null;
  let loading = false;

  function item(entry: AuditEntry): HTMLElement {
    const li = document.createElement("li");
    li.className = "audit-item";
    const text = document.createElement("span");
    text.textContent = describeAudit(entry);
    const when = document.createElement("time");
    when.className = "muted-text";
    when.dateTime = new Date(entry.created_at).toISOString();
    when.textContent = new Date(entry.created_at).toLocaleString([], {
      dateStyle: "medium",
      timeStyle: "short",
    });
    li.append(text, when);
    return li;
  }

  async function loadPage(): Promise<void> {
    if (loading) return;
    loading = true;
    status.textContent = list.children.length === 0 ? "Loading…" : "";
    try {
      const query = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (oldest) query.set("before", oldest);
      const page = await api.get<AuditEntry[]>(`${path}?${query.toString()}`);
      list.append(...page.map(item));
      if (page.length > 0) oldest = page[page.length - 1].id;
      moreBtn.hidden = page.length < PAGE_SIZE;
      status.textContent = list.children.length === 0 ? "Nothing has been recorded yet." : "";
    } catch {
      status.textContent = "Couldn't load the log.";
    } finally {
      loading = false;
    }
  }

  moreBtn.addEventListener("click", () => void loadPage());
  void loadPage();
  return wrap;
}
