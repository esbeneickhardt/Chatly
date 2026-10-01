// Small UI building blocks shared by more than one view. Each of these
// used to be copy-pasted into every view that needed it (five copies of
// `renderAvatarEl`, three of `confirmDialog`); one implementation means
// one place to fix or improve — the dialog's keyboard and screen-reader
// behaviour below is an example.

/** A round avatar: the user's image if they have one, else their first
 * initial. */
export function renderAvatarEl(name: string, avatarFileId: string | null): HTMLElement {
  if (avatarFileId) {
    const img = document.createElement("img");
    img.className = "avatar avatar-image";
    img.src = `/api/files/${avatarFileId}`;
    img.alt = name;
    return img;
  }
  const div = document.createElement("div");
  div.className = "avatar";
  div.textContent = name.slice(0, 1).toUpperCase();
  return div;
}

let dialogSeq = 0;

/** A real in-app confirmation dialog, styled like the rest of the app.
 * Resolves `true` on confirm, `false` on cancel, Escape, or a click on
 * the backdrop. Announced as an alert dialog to screen readers, focus
 * starts on the confirm button (the cancel button for a destructive
 * action, so a stray Enter can't destroy anything), Tab stays inside it,
 * and focus returns to whatever had it before. */
export function confirmDialog(opts: {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
}): Promise<boolean> {
  return new Promise((resolve) => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const id = `confirm-dialog-${++dialogSeq}`;

    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop confirm-dialog-backdrop";

    const modal = document.createElement("div");
    modal.className = "modal confirm-dialog";
    modal.setAttribute("role", "alertdialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", `${id}-title`);
    modal.setAttribute("aria-describedby", `${id}-message`);

    const title = document.createElement("h3");
    title.id = `${id}-title`;
    title.textContent = opts.title;

    const message = document.createElement("p");
    message.id = `${id}-message`;
    message.className = "muted-text";
    message.textContent = opts.message;

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "secondary";
    cancelBtn.textContent = "Cancel";

    const confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    confirmBtn.className = opts.danger ? "danger" : "";
    confirmBtn.textContent = opts.confirmLabel;

    const actions = document.createElement("div");
    actions.className = "modal-actions";
    actions.append(cancelBtn, confirmBtn);

    function close(result: boolean): void {
      document.removeEventListener("keydown", onKeyDown, true);
      backdrop.remove();
      previouslyFocused?.focus?.();
      resolve(result);
    }
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close(false);
      } else if (e.key === "Tab") {
        // Two focusable controls: keep Tab cycling between them.
        const order = [cancelBtn, confirmBtn];
        const index = order.indexOf(document.activeElement as HTMLButtonElement);
        const next = e.shiftKey ? index - 1 : index + 1;
        e.preventDefault();
        order[(next + order.length) % order.length].focus();
      }
    }
    cancelBtn.addEventListener("click", () => close(false));
    confirmBtn.addEventListener("click", () => close(true));
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) close(false);
    });
    document.addEventListener("keydown", onKeyDown, true);

    modal.append(title, message, actions);
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
    (opts.danger ? cancelBtn : confirmBtn).focus();
  });
}

/** A short message that fades on its own, for feedback that doesn't
 * deserve a dialog ("your browser blocked the pop-out"). Announced to
 * screen readers as a status update. */
export function showNotice(text: string): void {
  let host = document.querySelector<HTMLElement>(".notice-host");
  if (!host) {
    host = document.createElement("div");
    host.className = "notice-host";
    host.setAttribute("role", "status");
    host.setAttribute("aria-live", "polite");
    document.body.appendChild(host);
  }
  const notice = document.createElement("div");
  notice.className = "notice";
  notice.textContent = text;
  host.appendChild(notice);
  window.setTimeout(() => notice.remove(), 6000);
}
