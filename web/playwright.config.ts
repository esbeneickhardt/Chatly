import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";

// End-to-end tests run real browsers against a real server on a scratch
// port with a throwaway data directory — never against a deployment.
//
//   cargo build && (cd web && npm run build) && (cd web && npm run e2e)
//
// The server binary defaults to the debug build; set CHATLY_BIN to use
// another. TRUSTED_PROXY lets each test user register from its own
// (forwarded) IP, so the per-IP registration limit doesn't trip.
const port = Number(process.env.E2E_PORT ?? 8171);
const voicePort = Number(process.env.E2E_VOICE_PORT ?? 50040);
const baseURL = `http://127.0.0.1:${port}`;
const dataDir = mkdtempSync(join(tmpdir(), "chatly-e2e-"));

export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  // One shared server and one owner account: tests create their own users,
  // but run one at a time so their calls and admin actions don't interleave.
  workers: 1,
  fullyParallel: false,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["github"]] : [["list"]],
  use: {
    baseURL,
    viewport: { width: 1280, height: 850 },
    trace: "retain-on-failure",
    launchOptions: {
      args: [
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
        "--autoplay-policy=no-user-gesture-required",
      ],
    },
  },
  webServer: {
    command: process.env.CHATLY_BIN ?? "target/debug/chatly",
    // Debug builds serve web/dist from disk, relative to the working directory.
    cwd: "..",
    url: `${baseURL}/healthz`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      LISTEN_ADDR: `127.0.0.1:${port}`,
      DATA_DIR: dataDir,
      PUBLIC_URL: baseURL,
      VOICE_PORT: String(voicePort),
      TRUSTED_PROXY: "127.0.0.1",
      LOG_LEVEL: "warn",
    },
  },
});
