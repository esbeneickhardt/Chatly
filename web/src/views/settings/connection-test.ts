// Settings → Devices → "Can this device make a call?": runs the check and
// shows what it found.

import { explain, testConnection } from "../../voice/connection-test";
import { section } from "./widgets";

export function renderConnectionTest(): HTMLElement {
  const hint = document.createElement("p");
  hint.className = "muted-text";
  hint.textContent =
    "If calls will not connect (say, on your phone), run this while on the same network and see what it says.";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "secondary";
  button.textContent = "Test my connection";

  const result = document.createElement("div");
  result.setAttribute("aria-live", "polite");

  button.addEventListener("click", async () => {
    button.disabled = true;
    button.textContent = "Testing…";
    result.replaceChildren();
    try {
      const { findings, verdict } = explain(await testConnection());
      const list = document.createElement("ul");
      list.className = "connection-findings";
      for (const finding of findings) {
        const item = document.createElement("li");
        item.className = finding.ok ? "ok" : "bad";
        item.textContent = `${finding.ok ? "✓" : "✗"} ${finding.text}`;
        list.appendChild(item);
      }
      const summary = document.createElement("p");
      summary.className = "connection-verdict";
      summary.textContent = verdict;
      result.append(list, summary);
    } catch {
      result.textContent = "The test could not run in this browser.";
    } finally {
      button.disabled = false;
      button.textContent = "Test my connection";
    }
  });

  return section("Connection", hint, button, result);
}
