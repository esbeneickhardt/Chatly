// A safety net for accessible names. The views build their DOM by hand,
// and two habits recur: an icon-only button that carries a `title` (a
// tooltip) but no `aria-label`, and a `.field` whose `<label>` sits next
// to its input without being connected to it. Screen readers need the
// connection, so this watches the document and repairs both as elements
// appear. New code should still label things explicitly — this exists so
// a forgotten label degrades to "fine" rather than "unnamed".

let nextId = 0;

/** Gives every `button[title]` without its own name the title as its
 * `aria-label`. */
function labelTitledButtons(root: ParentNode): void {
  for (const button of root.querySelectorAll<HTMLElement>("button[title]:not([aria-label])")) {
    if (!button.textContent?.trim()) button.setAttribute("aria-label", button.title);
  }
}

/** Connects a `.field`'s `<label>` to the first control after it. */
function associateFieldLabels(root: ParentNode): void {
  for (const label of root.querySelectorAll<HTMLLabelElement>(".field > label:not([for])")) {
    if (label.querySelector("input, select, textarea")) continue; // already wraps its control
    const control = label.parentElement?.querySelector<HTMLElement>("input, select, textarea");
    if (!control) continue;
    if (!control.id) control.id = `field-control-${++nextId}`;
    label.htmlFor = control.id;
  }
}

/** Clickable `div`s the views build for the server rail and the
 * channel/conversation lists. A `div` with a click handler is invisible
 * to the keyboard, so make each focusable and operable with Enter/Space.
 *
 * Rail icons are single-purpose, so they also get the button role and
 * their tooltip as a name. Channel and conversation rows *contain* real
 * buttons (pin, manage, invite), and a button role on a container of
 * buttons is invalid, so those stay role-less but focusable, with
 * `aria-current` marking the one that's open. */
const RAIL_ICONS = ".guild-icon";
const LIST_ROWS = ".channel-item:not(button)";

function makeRowsKeyboardOperable(root: ParentNode): void {
  for (const el of root.querySelectorAll<HTMLElement>(`${RAIL_ICONS}, ${LIST_ROWS}`)) {
    if (!el.hasAttribute("tabindex")) el.tabIndex = 0;
    if (el.matches(RAIL_ICONS)) {
      if (!el.hasAttribute("role")) el.setAttribute("role", "button");
      if (!el.hasAttribute("aria-label") && el.title) el.setAttribute("aria-label", el.title);
    }
    if (el.classList.contains("active")) el.setAttribute("aria-current", "true");
    else el.removeAttribute("aria-current");
    if (el.dataset.keyboardWired) continue;
    el.dataset.keyboardWired = "1";
    el.addEventListener("keydown", (event) => {
      // Only when the row itself has focus: Enter on its inner buttons is theirs.
      if (event.target === el && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        el.click();
      }
    });
  }
}

/** Runs every repair on `root`. */
export function enhanceAccessibility(root: ParentNode = document): void {
  labelTitledButtons(root);
  associateFieldLabels(root);
  makeRowsKeyboardOperable(root);
}

/** Repairs the page now and whenever the DOM changes. A
 * `MutationObserver` callback already runs once per batch of changes,
 * as soon as the DOM work that caused them finishes — so new rows are
 * focusable before the next input event, with no frame-timing gap for a
 * fast keypress to fall into. */
export function installAccessibilityEnhancements(): void {
  enhanceAccessibility();
  new MutationObserver(() => enhanceAccessibility()).observe(document.body, {
    childList: true,
    subtree: true,
    // `class` too: which row is "active" changes without any node being added.
    attributes: true,
    attributeFilter: ["class"],
  });
}
