// Settings → Devices → Connection: runs the "can this device make a
// call?" check and shows what it found.

import { explain, testConnection } from "../../voice/connection-test";
import { group, row } from "./widgets";

export function renderConnectionTest(): HTMLElement {
  const result = document.createElement("div");
  result.className = "settings-row-detail";
  result.hidden = true;
  result.setAttribute("aria-live", "polite");

  const testRow = row({
    label: "Test my connection",
    action: true,
    onClick: async () => {
      const button = testRow.el as HTMLButtonElement;
      button.disabled = true;
      button.classList.add("busy");
      result.replaceChildren();
      result.hidden = true;
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
        result.hidden = false;
        button.disabled = false;
        button.classList.remove("busy");
      }
    },
  });

  return group("Connection", testRow.el, result);
}
