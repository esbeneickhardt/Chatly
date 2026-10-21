// Server settings → General: icon and name, as a header and rows.

import { ApiError, type Guild, type User, api } from "../../api";
import { icon } from "../../icons";
import { openImageCropper } from "../../image-cropper";
import { errorMessage, formDialog, group, row, textField } from "../settings/widgets";
import type { ServerSettingsContext } from "./context";

export function renderGeneralSection(
  ctx: ServerSettingsContext,
  guild: Guild,
  owner: User | null,
  canEdit: boolean,
): HTMLElement[] {
  const iconCircle = document.createElement("div");
  iconCircle.className = "server-icon-picker";
  if (!canEdit) iconCircle.classList.add("read-only");
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

  const header = document.createElement("div");
  header.className = "settings-profile-header";
  const pickerWrap = document.createElement("div");
  pickerWrap.className = "avatar-picker-wrap";
  pickerWrap.append(iconCircle, iconInput);
  const headerName = document.createElement("div");
  headerName.className = "settings-profile-name";
  headerName.textContent = guild.name;
  header.append(pickerWrap, headerName);

  if (canEdit) {
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
  }

  const nameRow = row({
    label: "Name",
    value: guild.name,
    onClick: canEdit
      ? () => {
          const { el, input } = textField("Server name", guild.name);
          formDialog({
            title: "Rename server",
            content: [el],
            submitLabel: "Save",
            onSubmit: async () => {
              const value = input.value.trim();
              if (!value) return "The name can't be empty.";
              if (value === guild.name) return null;
              try {
                const updated = await api.patch<Guild>(`/api/guilds/${guild.id}`, { name: value });
                guild.name = updated.name;
                nameRow.setValue(updated.name);
                headerName.textContent = updated.name;
                ctx.opts.onUpdated(updated);
                return null;
              } catch (err) {
                return errorMessage(err);
              }
            },
          });
          input.select();
        }
      : undefined,
  });
  const ownerRow = owner ? row({ label: "Owner", value: owner.display_name }) : null;

  return [header, group("Server", nameRow.el, ownerRow?.el ?? null)];
}
