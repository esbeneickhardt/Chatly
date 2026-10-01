// The Add Server modal: create a server or join one with an invite.

import { ApiError, type FileMeta, type Guild, api } from "../../api";
import { icon } from "../../icons";
import { openImageCropper } from "../../image-cropper";
import { field, modalShell } from "./widgets";

export function renderAddServerModal(opts: { onJoined: (guild: Guild) => void }): void {
  const { modal } = modalShell("Add a server");
  const heading = modal.querySelector("h2") as HTMLElement;
  const body = document.createElement("div");
  modal.appendChild(body);

  const createChoiceBtn = document.createElement("button");
  createChoiceBtn.className = "server-choice";
  createChoiceBtn.textContent = "Create a server";

  const joinChoiceBtn = document.createElement("button");
  joinChoiceBtn.className = "server-choice secondary";
  joinChoiceBtn.textContent = "Join a server";

  createChoiceBtn.addEventListener("click", () => renderCreateStep(heading, body, opts, renderChoiceStep));
  joinChoiceBtn.addEventListener("click", () => renderJoinStep(heading, body, opts, renderChoiceStep));

  function renderChoiceStep(): void {
    heading.textContent = "Add a server";
    body.replaceChildren(createChoiceBtn, joinChoiceBtn);
  }

  renderChoiceStep();
}

function renderCreateStep(
  heading: HTMLElement,
  body: HTMLElement,
  opts: { onJoined: (guild: Guild) => void },
  onBack: () => void,
): void {
  heading.textContent = "Customize your server";

  const subheading = document.createElement("p");
  subheading.className = "muted-text";
  subheading.textContent =
    "Give your new server a name and, if you like, an icon. You can always change it later.";

  let iconFileId: string | null = null;

  const iconCircle = document.createElement("div");
  iconCircle.className = "server-icon-picker";
  const iconPreview = document.createElement("img");
  iconPreview.hidden = true;
  const iconPlaceholder = document.createElement("div");
  iconPlaceholder.className = "server-icon-placeholder";
  iconPlaceholder.appendChild(icon("plus", 22));
  iconCircle.append(iconPreview, iconPlaceholder);

  const iconInput = document.createElement("input");
  iconInput.type = "file";
  iconInput.accept = "image/*";
  iconInput.hidden = true;

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
      const uploaded = await api.upload<FileMeta>(
        "/api/uploads",
        new File([cropped], "icon.jpg", { type: "image/jpeg" }),
      );
      iconFileId = uploaded.id;
      iconPreview.src = `/api/files/${uploaded.id}`;
      iconPreview.hidden = false;
      iconPlaceholder.hidden = true;
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Couldn't upload that image.");
    } finally {
      iconCircle.classList.remove("uploading");
    }
  });

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.placeholder = "My cool server";

  const error = document.createElement("p");
  error.className = "error-text";
  error.hidden = true;

  const backBtn = document.createElement("button");
  backBtn.className = "secondary";
  backBtn.textContent = "Back";
  backBtn.addEventListener("click", onBack);

  const createBtn = document.createElement("button");
  createBtn.textContent = "Create";
  createBtn.addEventListener("click", async () => {
    error.hidden = true;
    if (!nameInput.value.trim()) return;
    createBtn.disabled = true;
    try {
      const guild = await api.post<Guild>("/api/guilds", {
        name: nameInput.value.trim(),
        icon_file_id: iconFileId,
      });
      body.closest(".modal-backdrop")?.remove();
      opts.onJoined(guild);
    } catch (err) {
      error.textContent = err instanceof ApiError ? err.message : "Something went wrong.";
      error.hidden = false;
    } finally {
      createBtn.disabled = false;
    }
  });

  const actions = document.createElement("div");
  actions.className = "modal-actions";
  actions.append(backBtn, createBtn);

  body.replaceChildren(subheading, iconCircle, iconInput, field("Server name", nameInput), error, actions);
}

function renderJoinStep(
  heading: HTMLElement,
  body: HTMLElement,
  opts: { onJoined: (guild: Guild) => void },
  onBack: () => void,
): void {
  heading.textContent = "Join a server";

  const subheading = document.createElement("p");
  subheading.className = "muted-text";
  subheading.textContent = "Enter an invite link or code below to join an existing server.";

  const codeInput = document.createElement("input");
  codeInput.type = "text";
  codeInput.placeholder = "Invite link or code";

  const error = document.createElement("p");
  error.className = "error-text";
  error.hidden = true;

  const backBtn = document.createElement("button");
  backBtn.className = "secondary";
  backBtn.textContent = "Back";
  backBtn.addEventListener("click", onBack);

  const joinBtn = document.createElement("button");
  joinBtn.textContent = "Join";
  joinBtn.addEventListener("click", async () => {
    error.hidden = true;
    const raw = codeInput.value.trim();
    if (!raw) return;
    const code = raw.split("/").filter(Boolean).pop() ?? raw;
    joinBtn.disabled = true;
    try {
      const guild = await api.post<Guild>("/api/guilds/join", { code });
      body.closest(".modal-backdrop")?.remove();
      opts.onJoined(guild);
    } catch (err) {
      error.textContent = err instanceof ApiError ? err.message : "Something went wrong.";
      error.hidden = false;
    } finally {
      joinBtn.disabled = false;
    }
  });

  const actions = document.createElement("div");
  actions.className = "modal-actions";
  actions.append(backBtn, joinBtn);

  body.replaceChildren(subheading, field("Invite", codeInput), error, actions);
}
