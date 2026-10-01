// Server settings → General: icon and name.

import { ApiError, type Guild, type User, api } from "../../api";
import { icon } from "../../icons";
import { openImageCropper } from "../../image-cropper";
import { editableField, field, section } from "./widgets";
import type { ServerSettingsContext } from "./context";

export function renderGeneralSection(
  ctx: ServerSettingsContext,
  guild: Guild,
  owner: User | null,
  canEdit: boolean,
): HTMLElement {
  const iconCircle = document.createElement("div");
  iconCircle.className = "server-icon-picker";
  const iconPreview = document.createElement("img");
  if (guild.icon_file_id) {
    iconPreview.src = `/api/files/${guild.icon_file_id}`;
  } else {
    iconPreview.hidden = true;
  }
  const iconPlaceholder = document.createElement("div");
  iconPlaceholder.className = "server-icon-placeholder";
  iconPlaceholder.appendChild(icon("hash", 22));
  iconPlaceholder.hidden = Boolean(guild.icon_file_id);
  iconCircle.append(iconPreview, iconPlaceholder);

  const iconInput = document.createElement("input");
  iconInput.type = "file";
  iconInput.accept = "image/*";
  iconInput.hidden = true;

  const pickerWrap = document.createElement("div");
  pickerWrap.className = "avatar-picker-wrap";
  pickerWrap.append(iconCircle, iconInput);

  if (!canEdit) {
    const nameField = field("Server name");
    const nameStatic = document.createElement("p");
    nameStatic.textContent = guild.name;
    nameField.appendChild(nameStatic);
    const ownerLine = document.createElement("p");
    ownerLine.className = "muted-text";
    ownerLine.textContent = owner ? `Owned by ${owner.display_name}.` : "";
    return section("Identity", pickerWrap, nameField, ownerLine);
  }

  iconCircle.addEventListener("click", () => iconInput.click());
  iconInput.addEventListener("change", async () => {
    const file = iconInput.files?.[0];
    iconInput.value = "";
    if (!file) return;
    const cropped = await openImageCropper(file, {
      shape: "circle",
      outputSize: 256,
      title: "Crop server icon",
    });
    if (!cropped) return;
    iconCircle.classList.add("uploading");
    try {
      const uploaded = await api.upload<{ id: string }>(
        "/api/uploads",
        new File([cropped], "icon.jpg", { type: "image/jpeg" }),
      );
      const updated = await api.patch<Guild>(`/api/guilds/${guild.id}`, {
        icon_file_id: uploaded.id,
      });
      iconPreview.src = `/api/files/${uploaded.id}`;
      iconPreview.hidden = false;
      iconPlaceholder.hidden = true;
      ctx.opts.onUpdated(updated);
    } catch (err) {
      const error = document.createElement("p");
      error.className = "error-text";
      error.textContent = err instanceof ApiError ? err.message : "Couldn't update the server icon.";
      pickerWrap.appendChild(error);
    } finally {
      iconCircle.classList.remove("uploading");
    }
  });

  const nameField = editableField({
    label: "Server name",
    initialValue: guild.name,
    save: async (value) => {
      try {
        const updated = await api.patch<Guild>(`/api/guilds/${guild.id}`, { name: value });
        ctx.opts.onUpdated(updated);
        return { ok: true, value: updated.name };
      } catch (err) {
        return { ok: false, message: err instanceof ApiError ? err.message : "Something went wrong." };
      }
    },
  });

  return section("Identity", pickerWrap, nameField);
}
