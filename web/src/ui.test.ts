import { afterEach, describe, expect, it } from "vitest";
import { confirmDialog, renderAvatarEl } from "./ui";

afterEach(() => {
  document.body.replaceChildren();
});

describe("renderAvatarEl", () => {
  it("shows an image when there is one", () => {
    const el = renderAvatarEl("Ada", "file1");
    expect(el.tagName).toBe("IMG");
    expect(el.getAttribute("src")).toBe("/api/files/file1");
  });

  it("falls back to the first initial, uppercased", () => {
    const el = renderAvatarEl("ada", null);
    expect(el.textContent).toBe("A");
  });
});

describe("confirmDialog", () => {
  const open = (danger = false) =>
    confirmDialog({ title: "Delete it?", message: "Gone for good.", confirmLabel: "Delete", danger });

  it("is announced as an alert dialog, labelled and described", () => {
    void open();
    const dialog = document.querySelector('[role="alertdialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    const labelledBy = dialog?.getAttribute("aria-labelledby") ?? "";
    expect(document.getElementById(labelledBy)?.textContent).toBe("Delete it?");
    const describedBy = dialog?.getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(describedBy)?.textContent).toBe("Gone for good.");
  });

  it("resolves true on confirm and removes itself", async () => {
    const result = open();
    (document.querySelector(".confirm-dialog button:last-child") as HTMLButtonElement).click();
    await expect(result).resolves.toBe(true);
    expect(document.querySelector(".confirm-dialog")).toBeNull();
  });

  it("resolves false on Escape", async () => {
    const result = open();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await expect(result).resolves.toBe(false);
  });

  it("puts focus on Cancel for a destructive action, on Confirm otherwise", () => {
    void open(true);
    expect(document.activeElement?.textContent).toBe("Cancel");
    document.body.replaceChildren();
    void open(false);
    expect(document.activeElement?.textContent).toBe("Delete");
  });

  it("keeps Tab inside the dialog", () => {
    void open();
    const buttons = [...document.querySelectorAll<HTMLButtonElement>(".confirm-dialog button")];
    buttons[1].focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(buttons[0]);
  });
});
