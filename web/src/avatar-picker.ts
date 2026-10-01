import { api, ApiError, type FileMeta, type User } from "./api";
import { openImageCropper } from "./image-cropper";

/** Renders a click-to-change circular avatar picker (crop -> upload ->
 * PATCH /api/me/avatar) plus a "Remove photo" button when one is set.
 * Used in Settings and the post-signup profile step. */
export function renderAvatarPicker(
  container: HTMLElement,
  opts: { user: User; onUpdated: (user: User) => void },
): void {
  const circle = document.createElement("div");
  circle.className = "server-icon-picker avatar-picker";

  const img = document.createElement("img");
  img.hidden = !opts.user.avatar_file_id;
  if (opts.user.avatar_file_id) {
    img.src = `/api/files/${opts.user.avatar_file_id}`;
  }

  const placeholder = document.createElement("div");
  placeholder.className = "server-icon-placeholder";
  placeholder.textContent = opts.user.display_name.slice(0, 1).toUpperCase();
  placeholder.hidden = Boolean(opts.user.avatar_file_id);

  circle.append(img, placeholder);

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "image/*";
  fileInput.hidden = true;

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "secondary";
  removeBtn.textContent = "Remove photo";
  removeBtn.hidden = !opts.user.avatar_file_id;

  circle.addEventListener("click", () => fileInput.click());

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (!file) return;
    const cropped = await openImageCropper(file, {
      shape: "circle",
      outputSize: 256,
      title: "Crop profile picture",
    });
    if (!cropped) return;

    circle.classList.add("uploading");
    try {
      const uploaded = await api.upload<FileMeta>(
        "/api/uploads",
        new File([cropped], "avatar.jpg", { type: "image/jpeg" }),
      );
      const updated = await api.post<User>("/api/me/avatar", { avatar_file_id: uploaded.id });
      img.src = `/api/files/${uploaded.id}`;
      img.hidden = false;
      placeholder.hidden = true;
      removeBtn.hidden = false;
      opts.onUpdated(updated);
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Couldn't update your profile picture.");
    } finally {
      circle.classList.remove("uploading");
    }
  });

  removeBtn.addEventListener("click", async () => {
    removeBtn.disabled = true;
    try {
      const updated = await api.post<User>("/api/me/avatar", { avatar_file_id: null });
      img.hidden = true;
      placeholder.hidden = false;
      removeBtn.hidden = true;
      opts.onUpdated(updated);
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Couldn't remove your profile picture.");
    } finally {
      removeBtn.disabled = false;
    }
  });

  container.append(circle, fileInput, removeBtn);
}
