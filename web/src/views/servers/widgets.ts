// Small building blocks shared by the server and channel modals.

import { icon } from "../../icons";

export function modalShell(title: string): { backdrop: HTMLDivElement; modal: HTMLDivElement } {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) backdrop.remove();
  });

  const modal = document.createElement("div");
  modal.className = "modal";
  backdrop.appendChild(modal);

  const closeBtn = document.createElement("button");
  closeBtn.className = "icon-button modal-close";
  closeBtn.title = "Close";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.appendChild(icon("x", 16));
  closeBtn.addEventListener("click", () => backdrop.remove());
  modal.appendChild(closeBtn);

  const heading = document.createElement("h2");
  heading.textContent = title;
  modal.appendChild(heading);

  document.body.appendChild(backdrop);
  return { backdrop, modal };
}

export function field(labelText: string, input: HTMLInputElement): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.className = "field";
  const label = document.createElement("label");
  label.textContent = labelText;
  wrap.append(label, input);
  return wrap;
}

export function pageTitle(label: string, ...children: Node[]): HTMLElement {
  const wrap = document.createElement("div");
  const title = document.createElement("h2");
  title.className = "settings-page-title";
  title.textContent = label;
  wrap.append(title, ...children);
  return wrap;
}
