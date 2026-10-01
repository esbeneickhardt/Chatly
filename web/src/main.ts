import "./styles/01-base.css";
import "./styles/02-forms.css";
import "./styles/03-sidebar.css";
import "./styles/04-video.css";
import "./styles/05-messages.css";
import "./styles/06-dialogs.css";
import "./styles/07-settings.css";
import "./styles/08-message-actions.css";
import "./styles/09-calls.css";
import "./styles/10-attachments.css";
import "./styles/11-responsive.css";
import "./styles/12-features.css";
import "katex/dist/katex.min.css";
import { api, ApiError, type User } from "./api";
import {
  renderGuestJoin,
  renderLogin,
  renderMfaPrompt,
  renderRegister,
  renderWelcomeStep,
} from "./views/auth";
import { installAccessibilityEnhancements } from "./a11y";
import { registerServiceWorker } from "./notifications";
import { watchForUpdates } from "./update-check";
import { renderChat } from "./views/chat";

const appRoot = document.getElementById("app");
if (!appRoot) {
  throw new Error("missing #app root element");
}
/** `appRoot`, narrowed once so nested closures don't need `!`. */
const root: HTMLElement = appRoot;

interface Destination {
  channelId: string | null;
  guildId: string | null;
}

installAccessibilityEnhancements();
registerServiceWorker();
watchForUpdates();

const NO_DESTINATION: Destination = { channelId: null, guildId: null };

/** The one invite path — see UX_FEEDBACK.md. Whatever the invite
 * targets (a guild channel or a DM), following it as a signed-out
 * visitor prompts creating an account first (below), and as an
 * already-signed-in one redeems it directly (see `boot`) — either way
 * landing on the same destination afterward, not two different links
 * for two different situations. */
function parseInviteCode(): string | null {
  const match = location.pathname.match(/^\/invite\/([A-Za-z0-9]+)/);
  return match ? match[1] : null;
}

function showLogin(): void {
  renderLogin(root, {
    onLoggedIn: (user) => void loginThenEnter(user),
    onMfaRequired: (token) => showMfaPrompt(token),
    onSwitchToRegister: () => showRegister(null),
  });
}

function showRegister(inviteCode: string | null): void {
  renderRegister(root, {
    inviteCode,
    onLoggedIn: (user, destination) => showWelcome(user, destination),
    onSwitchToLogin: showLogin,
  });
}

/** No account, no password — just enough to join the one call a DM
 * invite points to (see UX_FEEDBACK.md's "quick call, no signup"
 * feature). Skips the welcome/avatar step full registration gets:
 * there's nothing to onboard someone into for an account that expires
 * in a few hours. */
function showGuestJoin(inviteCode: string): void {
  renderGuestJoin(root, {
    inviteCode,
    onJoined: (user, channelId) => void loginThenEnter(user, { channelId, guildId: null }),
    onSwitchToLogin: showLogin,
  });
}

function showWelcome(user: User, destination: Destination): void {
  renderWelcomeStep(root, {
    user,
    onDone: (updated) => void loginThenEnter(updated, destination),
  });
}

function showMfaPrompt(preauthToken: string): void {
  renderMfaPrompt(root, {
    preauthToken,
    onLoggedIn: (user) => void loginThenEnter(user),
    onCancel: showLogin,
  });
}

async function loginThenEnter(user: User, destination: Destination = NO_DESTINATION): Promise<void> {
  await enterChat(user, destination);
}

async function enterChat(user: User, destination: Destination = NO_DESTINATION): Promise<void> {
  history.replaceState(null, "", "/");
  await renderChat(root, user, showLogin, destination);
}

async function boot(): Promise<void> {
  const inviteCode = parseInviteCode();

  try {
    const user = await api.get<User>("/api/me");
    // Already signed in: redeem the invite as this account (if there
    // is one) and land on its destination.
    if (inviteCode) {
      try {
        const result = await api.post<{ channel_id: string | null; guild_id: string | null }>(
          "/api/invites/redeem",
          { code: inviteCode },
        );
        await enterChat(user, { channelId: result.channel_id, guildId: result.guild_id });
        return;
      } catch (err) {
        // Expired/revoked/full, etc. — not worth blocking someone who
        // already has an account from just entering the app over.
        console.warn("invite redemption failed", err);
      }
    }
    await enterChat(user);
    return;
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 401) {
      console.error(err);
    }
  }

  // Not signed in: any invite — no matter what it targets — prompts
  // creating an account first, then lands on the destination
  // afterward (see `showRegister`/`showWelcome` threading it through)
  // — *unless* it's a DM invite, which only ever needs a display name
  // (see `showGuestJoin`). Asking the server which case this is
  // (rather than guessing client-side) means an invalid/expired code
  // still falls through to the normal registration form's own error
  // handling instead of a confusing dead end.
  if (inviteCode) {
    try {
      const preview = await api.get<{ valid: boolean; is_dm: boolean }>(
        `/api/invites/${encodeURIComponent(inviteCode)}/preview`,
      );
      if (preview.valid && preview.is_dm) {
        showGuestJoin(inviteCode);
        return;
      }
    } catch (err) {
      console.warn("invite preview failed", err);
    }
    showRegister(inviteCode);
  } else {
    showLogin();
  }
}

void boot();
