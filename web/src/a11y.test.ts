import { beforeEach, describe, expect, it } from "vitest";
import { enhanceAccessibility } from "./a11y";

beforeEach(() => document.body.replaceChildren());

function html(markup: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = markup;
  document.body.appendChild(host);
  return host;
}

describe("icon-only buttons", () => {
  it("get their tooltip as an accessible name", () => {
    const host = html('<button title="Search messages"><svg></svg></button>');
    enhanceAccessibility(host);
    expect(host.querySelector("button")?.getAttribute("aria-label")).toBe("Search messages");
  });

  it("keep an explicit label, and buttons with visible text are left alone", () => {
    const host = html(
      '<button title="tip" aria-label="Explicit"></button><button title="Save">Save</button>',
    );
    enhanceAccessibility(host);
    const [explicit, texted] = host.querySelectorAll("button");
    expect(explicit.getAttribute("aria-label")).toBe("Explicit");
    expect(texted.hasAttribute("aria-label")).toBe(false);
  });
});

describe("form fields", () => {
  it("connect a label to the input next to it", () => {
    const host = html('<div class="field"><label>Server name</label><div><input type="text"></div></div>');
    enhanceAccessibility(host);
    const label = host.querySelector("label");
    const input = host.querySelector("input");
    if (!label || !input) throw new Error("fixture missing");
    expect(input.id).not.toBe("");
    expect(label.htmlFor).toBe(input.id);
  });

  it("don't disturb a label that already wraps or targets its control", () => {
    const host = html(
      '<div class="field"><label>Wraps <input id="a"></label></div>' +
        '<div class="field"><label for="b">Targets</label><input id="b"></div>',
    );
    enhanceAccessibility(host);
    const labels = host.querySelectorAll("label");
    expect(labels[0].hasAttribute("for")).toBe(false);
    expect(labels[1].htmlFor).toBe("b");
  });

  it("give two fields two different ids", () => {
    const host = html(
      '<div class="field"><label>One</label><input></div><div class="field"><label>Two</label><input></div>',
    );
    enhanceAccessibility(host);
    const ids = [...host.querySelectorAll("input")].map((i) => i.id);
    expect(new Set(ids).size).toBe(2);
  });
});

describe("clickable rows", () => {
  it("become keyboard-focusable and Enter/Space operate them", () => {
    const host = html(
      '<div class="guild-icon" title="My Server">M</div><div class="channel-item">general</div>',
    );
    let clicks = 0;
    for (const el of host.children) el.addEventListener("click", () => clicks++);
    enhanceAccessibility(host);

    const [icon, row] = [...host.children] as HTMLElement[];
    expect(icon.tabIndex).toBe(0);
    expect(icon.getAttribute("role")).toBe("button");
    expect(icon.getAttribute("aria-label")).toBe("My Server");
    expect(row.tabIndex).toBe(0);
    expect(row.hasAttribute("role")).toBe(false); // it can contain buttons of its own

    for (const key of ["Enter", " "]) {
      row.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    }
    expect(clicks).toBe(2);
  });

  it("leave Enter on a nested button alone", () => {
    const host = html('<div class="channel-item">general<button class="pin">pin</button></div>');
    let rowClicks = 0;
    host.firstElementChild?.addEventListener("click", () => rowClicks++);
    enhanceAccessibility(host);
    host
      .querySelector(".pin")
      ?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(rowClicks).toBe(0);
  });

  it("mark the open row with aria-current, and only that one", () => {
    const host = html('<div class="channel-item active">a</div><div class="channel-item">b</div>');
    enhanceAccessibility(host);
    const [a, b] = [...host.children];
    expect(a.getAttribute("aria-current")).toBe("true");
    expect(b.hasAttribute("aria-current")).toBe(false);
    a.classList.remove("active");
    b.classList.add("active");
    enhanceAccessibility(host);
    expect(a.hasAttribute("aria-current")).toBe(false);
    expect(b.getAttribute("aria-current")).toBe("true");
  });
});
