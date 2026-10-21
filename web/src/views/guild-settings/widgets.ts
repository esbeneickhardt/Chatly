// Small building blocks shared by the server-settings sections.

export function section(heading: string, ...children: Node[]): HTMLElement {
  const el = document.createElement("section");
  el.className = "settings-section";
  const h = document.createElement("h3");
  h.textContent = heading;
  el.append(h, ...children);
  return el;
}

export function field(labelText: string): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.className = "field";
  const label = document.createElement("label");
  label.textContent = labelText;
  wrap.appendChild(label);
  return wrap;
}
