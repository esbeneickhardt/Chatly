// A small always-visible network readout. Deliberately network-only —
// whole-machine CPU/memory used to be shown here too, but that's real
// information about the host this app happens to be running on
// (total RAM size, load patterns) that a regular signed-in user has
// no real need to see and a curious/malicious one could use — dropped
// from both this widget and the API response entirely, not just
// hidden client-side. Network is just Chatly's own traffic (its own
// virtual interface, not the host's), which is what's actually useful
// to know here: is the app itself pushing meaningful bandwidth.
// Polls `GET /api/system/stats` continuously (cheap: one small JSON
// response) and updates a compact pill; clicking it opens a popover
// with both directions.

import { api } from "./api";
import type { SystemStats } from "./api";
import { icon } from "./icons";

const POLL_INTERVAL_MS = 3000;

function formatBytes(bytesPerSec: number): string {
  if (bytesPerSec < 1024) return `${bytesPerSec} B/s`;
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
  return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
}

export function renderSystemStatusButton(): HTMLElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "icon-button icon-button-labeled system-status-btn";
  button.title = "Network usage";

  const label = document.createElement("span");
  label.textContent = "…";

  button.append(icon("activity", 16), label);

  let latest: SystemStats | null = null;
  let downValueEl: HTMLElement | null = null;
  let upValueEl: HTMLElement | null = null;
  let closePopover: (() => void) | null = null;

  // `net_rx_bytes_per_sec`/`net_tx_bytes_per_sec` are named from the
  // *server's* point of view (see `sysstats.rs`) — rx is what the
  // server received, i.e. bytes a client sent it (a file upload, a
  // message post), and tx is what the server sent out (message
  // history, downloaded files, the app bundle itself). From the
  // user's point of view that's backwards: rx is their "↑" upload
  // traffic and tx is their "↓" download traffic. Mixing these up
  // once made uploading a file visibly move the "↓" number instead of
  // "↑" — see UX_FEEDBACK.md.
  function updatePopoverValues(): void {
    if (!latest || !downValueEl || !upValueEl) return;
    downValueEl.textContent = formatBytes(latest.net_tx_bytes_per_sec);
    upValueEl.textContent = formatBytes(latest.net_rx_bytes_per_sec);
  }

  function openPopover(): void {
    if (!latest) return;

    const popover = document.createElement("div");
    popover.className = "system-status-popover";

    function row(name: string): HTMLElement {
      const el = document.createElement("div");
      el.className = "system-status-row";
      const nameEl = document.createElement("span");
      nameEl.className = "name";
      nameEl.textContent = name;
      const valueEl = document.createElement("span");
      valueEl.className = "value";
      el.append(nameEl, valueEl);
      popover.appendChild(el);
      return valueEl;
    }
    downValueEl = row("Chatly's network ↓");
    upValueEl = row("Chatly's network ↑");
    updatePopoverValues();

    // Centered in the viewport rather than anchored below the button —
    // this button lives in the top-right of the channel header, where
    // anchored positioning pushed the popover off the top of the
    // screen entirely.
    document.body.appendChild(popover);
    popover.style.left = "50%";
    popover.style.top = "50%";
    popover.style.transform = "translate(-50%, -50%)";

    const closeOnOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node;
      // `.contains`, not `!==` — the button has its own child elements
      // (the icon, the label), so a click that visually lands on the
      // button can easily have `event.target` be one of those, not
      // the `<button>` itself, which would otherwise make re-clicking
      // the button to close it also look like an "outside" click.
      if (!popover.contains(target) && !button.contains(target)) {
        closePopover?.();
      }
    };
    document.addEventListener("click", closeOnOutsideClick, true);

    closePopover = () => {
      popover.remove();
      downValueEl = null;
      upValueEl = null;
      document.removeEventListener("click", closeOnOutsideClick, true);
      closePopover = null;
    };
  }

  button.addEventListener("click", () => {
    if (closePopover) {
      closePopover();
    } else {
      openPopover();
    }
  });

  async function poll(): Promise<void> {
    try {
      latest = await api.get<SystemStats>("/api/system/stats");
      // Both directions in the compact pill now, not just rx — a
      // lone "↓" number that only ever moved for other people's
      // downloads (and never for your own uploads) was the whole bug.
      label.textContent = `↓${formatBytes(latest.net_tx_bytes_per_sec)} ↑${formatBytes(latest.net_rx_bytes_per_sec)}`;
      updatePopoverValues();
    } catch {
      // Transient failures (e.g. a reconnect) just leave the last
      // known reading on screen rather than showing an error state
      // for a background convenience widget.
    }
  }

  // The sidebar footer this button lives in is mounted once for the
  // whole session (like the gateway heartbeat/voice speaking-detection
  // timers), so there's no teardown path to clear this on — it simply
  // runs for as long as the page does.
  void poll();
  window.setInterval(() => void poll(), POLL_INTERVAL_MS);

  return button;
}
