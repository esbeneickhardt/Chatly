// Small building blocks shared by the server-settings sections.

export function section(heading: string, ...children: Node[]): HTMLElement {
  const el = document.createElement("section");
  el.className = "settings-section";
  const h = document.createElement("h3");
  h.textContent = heading;
  el.append(h, ...children);
  return el;
}

export function pageTitle(label: string, ...children: Node[]): HTMLElement {
  const wrap = document.createElement("div");
  const title = document.createElement("h2");
  title.className = "settings-page-title";
  title.textContent = label;
  wrap.append(title, ...children);
  return wrap;
}

export function field(labelText: string): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.className = "field";
  const label = document.createElement("label");
  label.textContent = labelText;
  wrap.appendChild(label);
  return wrap;
}

/** One "field + save button + inline error" row — identical shape to
 * settings.ts's own `editableField`, so a server's name edits the same
 * way a display name or username does. */
export function editableField(opts: {
  label: string;
  initialValue: string;
  save: (value: string) => Promise<{ ok: true; value: string } | { ok: false; message: string }>;
}): HTMLElement {
  const wrap = field(opts.label);
  const row = document.createElement("div");
  row.className = "editable-field-row";
  const input = document.createElement("input");
  input.type = "text";
  input.value = opts.initialValue;
  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.textContent = "Save";
  saveBtn.disabled = true;
  row.append(input, saveBtn);
  const error = document.createElement("p");
  error.className = "error-text";
  error.hidden = true;
  wrap.append(row, error);

  let currentValue = opts.initialValue;
  input.addEventListener("input", () => {
    saveBtn.disabled = input.value.trim() === currentValue || input.value.trim().length === 0;
    error.hidden = true;
  });
  saveBtn.addEventListener("click", async () => {
    saveBtn.disabled = true;
    error.hidden = true;
    const outcome = await opts.save(input.value.trim());
    if (outcome.ok) {
      currentValue = outcome.value;
      input.value = outcome.value;
      const original = saveBtn.textContent;
      saveBtn.textContent = "Saved";
      setTimeout(() => {
        saveBtn.textContent = original;
      }, 1200);
    } else {
      error.textContent = outcome.message;
      error.hidden = false;
      saveBtn.disabled = false;
    }
  });

  return wrap;
}
