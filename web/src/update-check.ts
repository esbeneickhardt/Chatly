// Tells an open tab that a newer version of Chatly has been deployed.
//
// A tab that stays open for days keeps running the code it loaded, so a fix
// never reaches it until the person reloads (and never says so). The page's
// script has a hash of its content in its name; asking the server for the
// page again and comparing that name is all it takes to know.

/** How often to look while the tab is open. It also looks whenever the tab
 * comes back into view, which is when someone is most likely to care. */
const CHECK_EVERY_MS = 10 * 60 * 1000;

const BUNDLE = /\/assets\/index-[\w-]+\.js/;

/** The name of the script this tab is running, or null in development, where
 * scripts are not hashed. */
export function runningBundle(doc: Document = document): string | null {
  for (const script of Array.from(doc.querySelectorAll("script[src]"))) {
    const match = BUNDLE.exec(script.getAttribute("src") ?? "");
    if (match) return match[0];
  }
  return null;
}

/** The script name in a copy of the page's HTML. */
export function bundleIn(html: string): string | null {
  return BUNDLE.exec(html)?.[0] ?? null;
}

let shown = false;

function showUpdateBanner(): void {
  if (shown) return;
  shown = true;
  const banner = document.createElement("div");
  banner.className = "update-banner";
  banner.setAttribute("role", "status");
  const text = document.createElement("span");
  text.textContent = "A new version of Chatly is available.";
  const reload = document.createElement("button");
  reload.type = "button";
  reload.textContent = "Reload";
  reload.addEventListener("click", () => window.location.reload());
  const later = document.createElement("button");
  later.type = "button";
  later.className = "secondary";
  later.textContent = "Later";
  later.addEventListener("click", () => banner.remove());
  banner.append(text, reload, later);
  document.body.appendChild(banner);
}

async function check(current: string): Promise<void> {
  try {
    const response = await fetch("/", { cache: "no-store" });
    if (!response.ok) return;
    const latest = bundleIn(await response.text());
    if (latest && latest !== current) showUpdateBanner();
  } catch {
    /* offline or a blip: try again next time */
  }
}

export function watchForUpdates(): void {
  const current = runningBundle();
  if (!current) return;
  window.setInterval(() => void check(current), CHECK_EVERY_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void check(current);
  });
}
