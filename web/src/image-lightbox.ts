// Clicking an image attachment used to just open it in a new browser
// tab — a dead end with no way back to the conversation short of
// closing the tab, and no way to see anything else nearby. This is a
// proper in-app viewer instead: a full-screen overlay, previous/next
// arrows (and Left/Right/Escape keys) to step through every image
// attachment currently rendered in the message list, and a click
// anywhere outside the image closes it — the same "click outside to
// dismiss" convention every other overlay in the app already uses.

export interface LightboxImage {
  url: string;
  filename: string;
}

/** `images` is a snapshot taken when the lightbox opens (every
 * `.attachment-image` currently in the message list, in order) — new
 * messages that arrive while it's open just aren't part of that
 * session's gallery, same as a photo app not reshuffling mid-browse. */
export function openImageLightbox(images: LightboxImage[], startIndex: number): void {
  let index = startIndex;

  const backdrop = document.createElement("div");
  backdrop.className = "lightbox-backdrop";

  const img = document.createElement("img");
  img.className = "lightbox-image";

  const caption = document.createElement("div");
  caption.className = "lightbox-caption";

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "lightbox-close";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.textContent = "×";

  const prevBtn = document.createElement("button");
  prevBtn.type = "button";
  prevBtn.className = "lightbox-nav lightbox-prev";
  prevBtn.setAttribute("aria-label", "Previous image");
  prevBtn.textContent = "‹";

  const nextBtn = document.createElement("button");
  nextBtn.type = "button";
  nextBtn.className = "lightbox-nav lightbox-next";
  nextBtn.setAttribute("aria-label", "Next image");
  nextBtn.textContent = "›";

  function show(i: number): void {
    index = (i + images.length) % images.length;
    const current = images[index];
    img.src = current.url;
    img.alt = current.filename;
    caption.textContent =
      images.length > 1 ? `${current.filename} (${index + 1}/${images.length})` : current.filename;
    const multi = images.length > 1;
    prevBtn.hidden = !multi;
    nextBtn.hidden = !multi;
  }

  function close(): void {
    document.removeEventListener("keydown", onKeydown);
    backdrop.remove();
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === "Escape") close();
    else if (e.key === "ArrowLeft") show(index - 1);
    else if (e.key === "ArrowRight") show(index + 1);
  }

  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });
  closeBtn.addEventListener("click", close);
  prevBtn.addEventListener("click", () => show(index - 1));
  nextBtn.addEventListener("click", () => show(index + 1));
  document.addEventListener("keydown", onKeydown);

  backdrop.append(closeBtn, prevBtn, img, nextBtn, caption);
  document.body.appendChild(backdrop);
  show(startIndex);
}
