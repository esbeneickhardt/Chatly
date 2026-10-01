import { api, ApiError, type User } from "../api";
import { renderAvatarPicker } from "../avatar-picker";

function field(labelText: string, input: HTMLInputElement): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.className = "field";
  const label = document.createElement("label");
  label.textContent = labelText;
  wrap.append(label, input);
  return wrap;
}

function errorBox(message?: string): HTMLParagraphElement {
  const p = document.createElement("p");
  p.className = "error-text";
  p.textContent = message ?? "";
  p.hidden = !message;
  return p;
}

function logo(): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "auth-logo";
  el.textContent = "C";
  return el;
}

function subtitle(text: string): HTMLParagraphElement {
  const p = document.createElement("p");
  p.className = "auth-subtitle";
  p.textContent = text;
  return p;
}

function footer(...children: Node[]): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "auth-footer";
  el.append(...children);
  return el;
}

interface LoginResult {
  user?: User;
  mfa_required?: boolean;
  preauth_token?: string;
}

export function renderLogin(
  root: HTMLElement,
  opts: {
    onLoggedIn: (user: User) => void;
    onMfaRequired: (preauthToken: string) => void;
    onSwitchToRegister: () => void;
  },
): void {
  root.replaceChildren();
  root.className = "auth-shell";

  const card = document.createElement("div");
  card.className = "auth-card";

  const heading = document.createElement("h1");
  heading.textContent = "Welcome back";

  const error = errorBox();

  const username = document.createElement("input");
  username.type = "text";
  username.autocomplete = "username";
  username.required = true;
  username.placeholder = "yourname";

  const password = document.createElement("input");
  password.type = "password";
  password.autocomplete = "current-password";
  password.required = true;
  password.placeholder = "••••••••";

  const form = document.createElement("form");
  form.append(field("Username", username), field("Password", password));

  const submit = document.createElement("button");
  submit.type = "submit";
  submit.textContent = "Log in";
  form.append(submit);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.hidden = true;
    submit.disabled = true;
    try {
      const result = await api.post<LoginResult>("/api/login", {
        username: username.value,
        password: password.value,
      });
      if (result.mfa_required && result.preauth_token) {
        opts.onMfaRequired(result.preauth_token);
      } else if (result.user) {
        opts.onLoggedIn(result.user);
      }
    } catch (err) {
      error.textContent = err instanceof ApiError ? err.message : "Something went wrong.";
      error.hidden = false;
    } finally {
      submit.disabled = false;
    }
  });

  const switchLink = document.createElement("button");
  switchLink.type = "button";
  switchLink.className = "link-button";
  switchLink.textContent = "Register";
  switchLink.addEventListener("click", opts.onSwitchToRegister);

  card.append(
    logo(),
    heading,
    subtitle("Log in to keep chatting with your community."),
    error,
    form,
    footer(document.createTextNode("Have an invite link? "), switchLink),
  );
  root.append(card);
}

export function renderRegister(
  root: HTMLElement,
  opts: {
    inviteCode: string | null;
    /** `destination` is set when `inviteCode` targeted a specific
     * channel — see `main.ts`, which threads it through to
     * `renderChat` so registering from an invite lands there instead
     * of the usual first-guild/Home default. */
    onLoggedIn: (user: User, destination: { channelId: string | null; guildId: string | null }) => void;
    onSwitchToLogin: () => void;
  },
): void {
  root.replaceChildren();
  root.className = "auth-shell";

  const card = document.createElement("div");
  card.className = "auth-card";

  const heading = document.createElement("h1");
  heading.textContent = "Create an account";

  const error = errorBox();

  const username = document.createElement("input");
  username.type = "text";
  username.autocomplete = "username";
  username.required = true;
  username.pattern = "[a-z0-9_-]{2,32}";
  username.title = "2-32 lowercase letters, digits, '_' or '-'";
  username.placeholder = "yourname";

  const displayName = document.createElement("input");
  displayName.type = "text";
  displayName.placeholder = "Your Name";

  const password = document.createElement("input");
  password.type = "password";
  password.autocomplete = "new-password";
  password.required = true;
  password.minLength = 8;
  password.placeholder = "At least 8 characters";

  const inviteCode = document.createElement("input");
  inviteCode.type = "text";
  inviteCode.value = opts.inviteCode ?? "";
  inviteCode.placeholder = "Leave blank for a brand new instance";

  const form = document.createElement("form");
  form.append(
    field("Username", username),
    field("Display name (optional)", displayName),
    field("Password", password),
    field("Invite code (if you have one)", inviteCode),
  );

  const submit = document.createElement("button");
  submit.type = "submit";
  submit.textContent = "Create account";
  form.append(submit);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.hidden = true;
    submit.disabled = true;
    try {
      const result = await api.post<{
        user: User;
        channel_id?: string;
        guild_id?: string;
      }>("/api/register", {
        username: username.value,
        display_name: displayName.value,
        password: password.value,
        invite_code: inviteCode.value || undefined,
      });
      opts.onLoggedIn(result.user, {
        channelId: result.channel_id ?? null,
        guildId: result.guild_id ?? null,
      });
    } catch (err) {
      error.textContent = err instanceof ApiError ? err.message : "Something went wrong.";
      error.hidden = false;
    } finally {
      submit.disabled = false;
    }
  });

  const switchLink = document.createElement("button");
  switchLink.type = "button";
  switchLink.className = "link-button";
  switchLink.textContent = "Log in";
  switchLink.addEventListener("click", opts.onSwitchToLogin);

  card.append(
    logo(),
    heading,
    subtitle("A few details and you're in."),
    error,
    form,
    footer(document.createTextNode("Already have an account? "), switchLink),
  );
  root.append(card);
}

/** The no-signup half of following a DM invite link — just enough to
 * join the call it points to, no username/password at all. Whether to
 * show this instead of the full `renderRegister` form is decided
 * before this is ever called (see `main.ts`'s boot logic, which asks
 * `GET /api/invites/:code/preview` first) — a guild-destination
 * invite always needs a real account. */
export function renderGuestJoin(
  root: HTMLElement,
  opts: {
    inviteCode: string;
    onJoined: (user: User, channelId: string) => void;
    onSwitchToLogin: () => void;
  },
): void {
  root.replaceChildren();
  root.className = "auth-shell";

  const card = document.createElement("div");
  card.className = "auth-card";

  const heading = document.createElement("h1");
  heading.textContent = "Join the call";

  const error = errorBox();

  const displayName = document.createElement("input");
  displayName.type = "text";
  displayName.placeholder = "Your name";
  displayName.required = true;
  displayName.autofocus = true;

  const form = document.createElement("form");
  form.append(field("Your name", displayName));

  const submit = document.createElement("button");
  submit.type = "submit";
  submit.textContent = "Join";
  form.append(submit);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.hidden = true;
    submit.disabled = true;
    try {
      const result = await api.post<{ user: User; channel_id: string }>("/api/register-guest", {
        invite_code: opts.inviteCode,
        display_name: displayName.value,
      });
      opts.onJoined(result.user, result.channel_id);
    } catch (err) {
      error.textContent = err instanceof ApiError ? err.message : "Something went wrong.";
      error.hidden = false;
    } finally {
      submit.disabled = false;
    }
  });

  const switchLink = document.createElement("button");
  switchLink.type = "button";
  switchLink.className = "link-button";
  switchLink.textContent = "Log in instead";
  switchLink.addEventListener("click", opts.onSwitchToLogin);

  card.append(
    logo(),
    heading,
    subtitle("No account needed — just enter a name and you're in the call."),
    error,
    form,
    footer(document.createTextNode("Already have an account? "), switchLink),
  );
  root.append(card);
}

export function renderMfaPrompt(
  root: HTMLElement,
  opts: { preauthToken: string; onLoggedIn: (user: User) => void; onCancel: () => void },
): void {
  root.replaceChildren();
  root.className = "auth-shell";

  const card = document.createElement("div");
  card.className = "auth-card";

  const heading = document.createElement("h1");
  heading.textContent = "Two-factor authentication";

  const error = errorBox();

  const code = document.createElement("input");
  code.type = "text";
  code.autocomplete = "one-time-code";
  code.required = true;
  code.autofocus = true;
  code.placeholder = "123456";

  const form = document.createElement("form");
  form.append(field("Code", code));

  const submit = document.createElement("button");
  submit.type = "submit";
  submit.textContent = "Verify";
  form.append(submit);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.hidden = true;
    submit.disabled = true;
    try {
      const result = await api.post<{ user: User }>("/api/mfa/verify", {
        preauth_token: opts.preauthToken,
        code: code.value.trim(),
      });
      opts.onLoggedIn(result.user);
    } catch (err) {
      error.textContent = err instanceof ApiError ? err.message : "Something went wrong.";
      error.hidden = false;
    } finally {
      submit.disabled = false;
    }
  });

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "link-button";
  cancel.textContent = "Back to log in";
  cancel.addEventListener("click", opts.onCancel);

  card.append(
    logo(),
    heading,
    subtitle("Enter the 6-digit code from your authenticator app, or a recovery code."),
    error,
    form,
    footer(cancel),
  );
  root.append(card);
}

export function renderWelcomeStep(
  root: HTMLElement,
  opts: { user: User; onDone: (user: User) => void },
): void {
  root.replaceChildren();
  root.className = "auth-shell";

  let user = opts.user;

  const card = document.createElement("div");
  card.className = "auth-card";

  const heading = document.createElement("h1");
  heading.textContent = "Add a profile picture?";

  const pickerWrap = document.createElement("div");
  renderAvatarPicker(pickerWrap, {
    user,
    onUpdated: (updated) => {
      user = updated;
    },
  });

  const continueBtn = document.createElement("button");
  continueBtn.type = "button";
  continueBtn.textContent = "Continue";
  continueBtn.addEventListener("click", () => opts.onDone(user));

  const skipLink = document.createElement("button");
  skipLink.type = "button";
  skipLink.className = "link-button";
  skipLink.textContent = "Skip for now";
  skipLink.addEventListener("click", () => opts.onDone(user));

  card.append(
    logo(),
    heading,
    subtitle("Optional — you can always change this later in Settings."),
    pickerWrap,
    continueBtn,
    footer(skipLink),
  );
  root.append(card);
}
