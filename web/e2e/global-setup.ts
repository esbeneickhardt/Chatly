import { OWNER_ENV_NAME, registerOwner } from "./support";

// Runs once, after the server is up and before any test: creates the
// deployment's first account (the global admin) and hands it to the tests
// through the environment, so worker restarts don't try to register it twice.
export default async function globalSetup(): Promise<void> {
  process.env[OWNER_ENV_NAME] = JSON.stringify(await registerOwner());
}
