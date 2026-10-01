// A minimal pan/zoom image cropper used for guild icons and user
// avatars. Deliberately produces a plain square crop (no baked-in
// circular mask) — the app already clips avatars/icons to a circle or
// rounded square via CSS wherever they're displayed, so there's no
// need to duplicate that in the exported image.

const VIEWPORT_SIZE = 280;
const MIN_ZOOM = 1;
const MAX_ZOOM = 3;

export interface CropperOptions {
  /** Visual hint only (rounds the preview viewport) — doesn't affect
   * the exported crop, which is always a plain square. */
  shape: "circle" | "square";
  outputSize: number;
  title?: string;
}

/** Opens a modal cropper over `file`; resolves with the cropped image
 * as a JPEG blob, or `null` if the user cancels. */
export function openImageCropper(file: File, opts: CropperOptions): Promise<Blob | null> {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    let settled = false;
    const finish = (result: Blob | null) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(objectUrl);
      backdrop.remove();
      resolve(result);
    };

    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";

    const modal = document.createElement("div");
    modal.className = "modal cropper-modal";
    backdrop.appendChild(modal);

    const heading = document.createElement("h2");
    heading.textContent = opts.title ?? "Crop image";
    modal.appendChild(heading);

    const viewport = document.createElement("div");
    viewport.className = `cropper-viewport cropper-viewport-${opts.shape}`;
    modal.appendChild(viewport);

    const img = document.createElement("img");
    img.className = "cropper-image";
    img.draggable = false;
    viewport.appendChild(img);

    const zoomRow = document.createElement("div");
    zoomRow.className = "cropper-zoom-row";
    const zoomSlider = document.createElement("input");
    zoomSlider.type = "range";
    zoomSlider.min = String(MIN_ZOOM);
    zoomSlider.max = String(MAX_ZOOM);
    zoomSlider.step = "0.01";
    zoomSlider.value = String(MIN_ZOOM);
    zoomRow.append(zoomLabel("−"), zoomSlider, zoomLabel("+"));
    modal.appendChild(zoomRow);

    const actions = document.createElement("div");
    actions.className = "modal-actions";
    const cancelBtn = document.createElement("button");
    cancelBtn.className = "secondary";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", () => finish(null));
    const useBtn = document.createElement("button");
    useBtn.textContent = "Use this image";
    actions.append(cancelBtn, useBtn);
    modal.appendChild(actions);

    document.body.appendChild(backdrop);

    let naturalWidth = 0;
    let naturalHeight = 0;
    let baseScale = 1;
    let zoom = MIN_ZOOM;
    let offsetX = 0;
    let offsetY = 0;

    function totalScale(): number {
      return baseScale * zoom;
    }

    function clampOffsets(): void {
      const w = naturalWidth * totalScale();
      const h = naturalHeight * totalScale();
      offsetX = Math.min(0, Math.max(VIEWPORT_SIZE - w, offsetX));
      offsetY = Math.min(0, Math.max(VIEWPORT_SIZE - h, offsetY));
    }

    function render(): void {
      const scale = totalScale();
      img.style.width = `${naturalWidth * scale}px`;
      img.style.height = `${naturalHeight * scale}px`;
      img.style.transform = `translate(${offsetX}px, ${offsetY}px)`;
    }

    img.addEventListener("load", () => {
      // `load` only guarantees the image's dimensions are known, not
      // that a frame is actually ready to paint yet — on some engines
      // that gap shows up as a blank/background-colored viewport for a
      // beat. `decode()` waits for a paintable frame before we compute
      // geometry and render, so the live preview never has a moment
      // with nothing (or the viewport's own background) showing.
      img
        .decode()
        .catch(() => {
          // Some browsers reject decode() for formats they can still
          // rasterize (e.g. still-animating or exotic ICC profiles) —
          // ignore and fall through to rendering with what we have
          // rather than leaving the picker looking broken.
        })
        .finally(() => {
          naturalWidth = img.naturalWidth;
          naturalHeight = img.naturalHeight;
          if (naturalWidth === 0 || naturalHeight === 0) {
            finish(null);
            alert("That image couldn't be read — please try a different file.");
            return;
          }
          baseScale = Math.max(VIEWPORT_SIZE / naturalWidth, VIEWPORT_SIZE / naturalHeight);
          zoom = MIN_ZOOM;
          offsetX = (VIEWPORT_SIZE - naturalWidth * totalScale()) / 2;
          offsetY = (VIEWPORT_SIZE - naturalHeight * totalScale()) / 2;
          render();
        });
    });
    img.addEventListener("error", () => {
      finish(null);
      alert("That image couldn't be read — please try a different file.");
    });
    img.src = objectUrl;

    zoomSlider.addEventListener("input", () => {
      zoom = Number(zoomSlider.value);
      clampOffsets();
      render();
    });

    let dragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let dragOffsetStartX = 0;
    let dragOffsetStartY = 0;

    viewport.addEventListener("pointerdown", (e) => {
      dragging = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      dragOffsetStartX = offsetX;
      dragOffsetStartY = offsetY;
      viewport.setPointerCapture(e.pointerId);
    });
    viewport.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      offsetX = dragOffsetStartX + (e.clientX - dragStartX);
      offsetY = dragOffsetStartY + (e.clientY - dragStartY);
      clampOffsets();
      render();
    });
    const stopDragging = () => {
      dragging = false;
    };
    viewport.addEventListener("pointerup", stopDragging);
    viewport.addEventListener("pointercancel", stopDragging);

    useBtn.addEventListener("click", () => {
      const canvas = document.createElement("canvas");
      canvas.width = opts.outputSize;
      canvas.height = opts.outputSize;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        finish(null);
        return;
      }
      const scale = totalScale();
      const sourceX = -offsetX / scale;
      const sourceY = -offsetY / scale;
      const sourceSize = VIEWPORT_SIZE / scale;
      ctx.drawImage(img, sourceX, sourceY, sourceSize, sourceSize, 0, 0, opts.outputSize, opts.outputSize);
      canvas.toBlob((blob) => finish(blob), "image/jpeg", 0.9);
    });
  });
}

function zoomLabel(text: string): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = "cropper-zoom-label";
  span.textContent = text;
  return span;
}
