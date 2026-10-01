// Shared helpers for the end-to-end tests: seeding accounts through the
// real API, and opening a browser signed in as one of them.

import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

const BASE = `http://127.0.0.1:${Number(process.env.E2E_PORT ?? 8171)}`;
export const PASSWORD = "correct-horse-battery";

export interface Account {
  username: string;
  id: string;
  cookie: string;
}

let ipCounter = 1;
const OWNER_ENV = "E2E_OWNER";

/** JSON call as `account` (or anonymously). Each call comes from a
 * fresh forwarded IP so the per-IP registration limit never trips. */
export async function call<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
  account?: Account,
): Promise<{ status: number; body: T; setCookie: string | null }> {
  const headers: Record<string, string> = {
    "X-Requested-With": "XMLHttpRequest",
    "X-Forwarded-For": `10.1.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`,
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (account) headers.Cookie = account.cookie;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return {
    status: res.status,
    body: (text ? JSON.parse(text) : null) as T,
    setCookie: res.headers.get("set-cookie"),
  };
}

function sessionCookie(setCookie: string | null): string {
  const match = setCookie?.match(/session=[^;]+/);
  if (!match) throw new Error("no session cookie in response");
  return match[0];
}

/** Registers the deployment's first account — the global admin — and
 * returns it with the server and channel it starts with. Called once, by
 * `global-setup.ts`; tests read it back with `owner()`. */
export async function registerOwner(): Promise<{ account: Account; guildId: string; channelId: string }> {
  const res = await call<{ user: { id: string } }>("POST", "/api/register", {
    username: "root",
    display_name: "Root",
    password: PASSWORD,
  });
  expect(res.status, "registering the first (global admin) account").toBe(200);
  const account: Account = { username: "root", id: res.body.user.id, cookie: sessionCookie(res.setCookie) };
  const guilds = await call<{ id: string }[]>("GET", "/api/guilds", undefined, account);
  const channels = await call<{ id: string }[]>(
    "GET",
    `/api/guilds/${guilds.body[0].id}/channels`,
    undefined,
    account,
  );
  return { account, guildId: guilds.body[0].id, channelId: channels.body[0].id };
}

/** The global admin created by `global-setup.ts`. */
export async function owner(): Promise<{ account: Account; guildId: string; channelId: string }> {
  const raw = process.env[OWNER_ENV];
  if (!raw) throw new Error("global setup did not run");
  return JSON.parse(raw);
}

export const OWNER_ENV_NAME = OWNER_ENV;

/** Registers `username` through an invite from `inviter` (default: the
 * global admin), landing them in the inviter's channel's server. */
export async function newUser(
  username: string,
  inviter?: { account: Account; channelId: string },
): Promise<Account> {
  const admin = await owner();
  const base = inviter ?? { account: admin.account, channelId: admin.channelId };
  const invite = await call<{ code: string }>(
    "POST",
    "/api/invites",
    { channel_id: base.channelId },
    base.account,
  );
  expect(invite.status).toBe(200);
  const res = await call<{ user: { id: string } }>("POST", "/api/register", {
    username,
    display_name: username[0].toUpperCase() + username.slice(1),
    password: PASSWORD,
    invite_code: invite.body.code,
  });
  expect(res.status, `register ${username}`).toBe(200);
  return { username, id: res.body.user.id, cookie: sessionCookie(res.setCookie) };
}

/** Makes `a` and `b` friends (which creates their 1:1 chat). */
export async function befriend(a: Account, b: Account): Promise<void> {
  const request = await call<{ id: string }>("POST", "/api/friends/requests", { username: b.username }, a);
  expect(request.status).toBe(200);
  const accepted = await call("POST", `/api/friends/requests/${request.body.id}`, {}, b);
  expect(accepted.status).toBe(200);
}

/** Contexts opened by the current test. Playwright only closes the ones it
 * creates itself, so without this every earlier test's pages (and their live
 * calls and fake cameras) stay open, and the browser gets slower and flakier
 * the further into the suite it gets. */
const openContexts: BrowserContext[] = [];

/** Register with `test.afterEach(closeOpenContexts)` in every spec that opens
 * browsers. */
export async function closeOpenContexts(): Promise<void> {
  await Promise.all(openContexts.splice(0).map((context) => context.close().catch(() => undefined)));
}

/** A browser context already signed in as `account`. */
export async function contextFor(browser: Browser, account: Account): Promise<BrowserContext> {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 850 },
    permissions: ["microphone", "camera"],
  });
  openContexts.push(context);
  // The token is base64 and may itself contain "=", so split on the first only.
  const at = account.cookie.indexOf("=");
  await context.addCookies([
    { name: account.cookie.slice(0, at), value: account.cookie.slice(at + 1), url: BASE },
  ]);
  return context;
}

/** Opens the app as `account` and waits for it to be usable. */
export async function openAs(browser: Browser, account: Account): Promise<Page> {
  const context = await contextFor(browser, account);
  const page = await context.newPage();
  page.on("pageerror", (error) => {
    throw error;
  });
  await page.goto("/");
  await expect(page.locator(".guild-rail")).toBeVisible();
  return page;
}

/** Switches to the Direct Messages view. */
export async function goHome(page: Page): Promise<void> {
  await page.locator(".guild-rail > :first-child").click();
  await expect(page.locator(".sidebar-header, .sidebar-header-name").first()).toContainText("Direct");
}

/** Replaces `getDisplayMedia` with a synthetic 2560×1440 60 fps canvas plus
 * a quiet tone, and records peer connections and gain nodes on `window`,
 * so a test can inspect what a screen share would send and how received
 * audio is played — no real screen or speakers needed. */
export const FAKE_SCREEN_SHARE = `
(() => {
  window.__pcs = []; window.__gains = []; window.__limiters = [];
  const PC = window.RTCPeerConnection;
  window.RTCPeerConnection = function (...a) { const pc = new PC(...a); window.__pcs.push(pc); return pc; };
  window.RTCPeerConnection.prototype = PC.prototype;
  const AC = window.AudioContext;
  const createGain = AC.prototype.createGain;
  AC.prototype.createGain = function () { const g = createGain.call(this); window.__gains.push(g); return g; };
  const createComp = AC.prototype.createDynamicsCompressor;
  AC.prototype.createDynamicsCompressor = function () { const c = createComp.call(this); window.__limiters.push(c); return c; };
  navigator.mediaDevices.getDisplayMedia = async () => {
    const canvas = document.createElement("canvas"); canvas.width = 2560; canvas.height = 1440;
    const g = canvas.getContext("2d"); let n = 0;
    setInterval(() => { g.fillStyle = "hsl(" + ((n++ * 7) % 360) + ",80%,50%)"; g.fillRect(0, 0, 2560, 1440); }, 16);
    const video = canvas.captureStream(60);
    const ctx = new AudioContext(); const osc = ctx.createOscillator(); osc.frequency.value = 440;
    const gain = ctx.createGain(); gain.gain.value = 0.03; const dest = ctx.createMediaStreamDestination();
    osc.connect(gain).connect(dest); osc.start();
    return new MediaStream([...video.getVideoTracks(), ...dest.stream.getAudioTracks()]);
  };
})();
`;
