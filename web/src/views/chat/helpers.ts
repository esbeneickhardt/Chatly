// Small pure helpers and renderers for the chat screen: date labels, file sizes, attachments.

import type { DmSummary, FileMeta } from "../../api";
import { icon } from "../../icons";
import { openImageLightbox } from "../../image-lightbox";

export const GROUP_WINDOW_MS = 5 * 60 * 1000;

export function ordinal(n: number): string {
  const suffixes = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${suffixes[(v - 20) % 10] ?? suffixes[v] ?? suffixes[0]}`;
}

export function formatDayDivider(ms: number): string {
  const d = new Date(ms);
  return `${d.toLocaleDateString([], { month: "long" })} ${ordinal(d.getDate())}, ${d.getFullYear()}`;
}

export function dateKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function renderAttachments(attachments: FileMeta[]): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "attachments";
  for (const file of attachments) {
    const url = `/api/files/${file.id}`;
    if (file.mime.startsWith("image/")) {
      const img = document.createElement("img");
      img.className = "attachment-image";
      img.src = url;
      img.alt = file.filename;
      img.loading = "lazy";
      img.dataset.filename = file.filename;
      // Opens in-app instead of a new browser tab — a plain link had
      // no way back to the conversation short of closing the tab, and
      // no way to see any other image nearby (see `image-lightbox.ts`,
      // which snapshots every currently-rendered attachment image for
      // its arrow-key/button navigation).
      img.addEventListener("click", () => {
        const all = Array.from(
          document.querySelectorAll<HTMLImageElement>(".message-list .attachment-image"),
        );
        const images = all.map((el) => ({ url: el.src, filename: el.dataset.filename ?? "" }));
        const startIndex = all.indexOf(img);
        openImageLightbox(images, Math.max(0, startIndex));
      });
      wrap.appendChild(img);
    } else if (file.mime.startsWith("video/")) {
      const video = document.createElement("video");
      video.className = "attachment-video";
      video.src = url;
      video.controls = true;
      video.preload = "metadata";
      wrap.appendChild(video);
    } else if (file.mime.startsWith("audio/")) {
      const audio = document.createElement("audio");
      audio.className = "attachment-audio";
      audio.src = url;
      audio.controls = true;
      wrap.appendChild(audio);
    } else {
      const link = document.createElement("a");
      link.className = "attachment-file";
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.appendChild(icon("paperclip", 15));
      link.appendChild(document.createTextNode(`${file.filename} (${formatFileSize(file.size)})`));
      wrap.appendChild(link);
    }
  }
  return wrap;
}

export { renderUserSearchModal, renderAddFriendModal, renderAddParticipantModal } from "./user-search";

/** A 1:1 (or a group DM, degraded all the way down) whose other
 * side(s) have all had their account hard-deleted is never left
 * behind as a "Former member" placeholder (see UX_FEEDBACK.md) —
 * the account is fully removed, and so is the conversation itself,
 * not just their name in it. `participants` empty is exactly that
 * state (a self-DM always has itself pushed in server-side, so this
 * can't misfire on one — see `isSelfDm`); `dms`/`refreshDmList`
 * filter every DM through this before it's ever rendered, so a
 * conversation in this state simply never appears at all. */
export function isRenderableDm(dm: DmSummary): boolean {
  return dm.participants.length > 0;
}
