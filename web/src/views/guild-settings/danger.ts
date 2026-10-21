// Server settings → Danger Zone and Leave Server: rows that open a dialog.

import { type Guild, type User, api } from "../../api";
import { confirmDialog } from "../../ui";
import { errorMessage, field, formDialog, group, row, textField } from "../settings/widgets";
import type { ServerSettingsContext } from "./context";

export function renderDangerZone(ctx: ServerSettingsContext, guild: Guild, members: User[]): HTMLElement[] {
  const others = members.filter((m) => m.id !== guild.owner_id);

  const transferRow = row({
    label: "Transfer ownership",
    onClick:
      others.length === 0
        ? undefined
        : () => {
            const memberField = field("New owner");
            const select = document.createElement("select");
            for (const m of others) {
              const option = document.createElement("option");
              option.value = m.id;
              option.textContent = m.display_name;
              select.appendChild(option);
            }
            memberField.appendChild(select);
            formDialog({
              title: "Transfer ownership",
              content: [memberField],
              submitLabel: "Transfer",
              danger: true,
              onSubmit: async () => {
                const target = others.find((m) => m.id === select.value);
                if (!target) return "Pick the new owner.";
                const ok = await confirmDialog({
                  title: "Transfer ownership?",
                  message: `${target.display_name} becomes the owner of "${guild.name}" and you lose control over it. You can't undo this yourself.`,
                  confirmLabel: "Transfer",
                  danger: true,
                });
                if (!ok) return undefined;
                try {
                  const updated = await api.post<Guild>(`/api/guilds/${guild.id}/transfer-ownership`, {
                    user_id: target.id,
                  });
                  ctx.opts.onUpdated(updated);
                  ctx.close();
                  return null;
                } catch (err) {
                  return errorMessage(err, "Couldn't transfer ownership.");
                }
              },
            });
          },
  });

  const deleteRow = row({
    label: "Delete server",
    danger: true,
    onClick: () => {
      const confirm = textField(`Type "${guild.name}" to confirm`);
      confirm.input.autocapitalize = "none";
      formDialog({
        title: "Delete server",
        content: [confirm.el],
        submitLabel: "Delete server",
        danger: true,
        onSubmit: async () => {
          if (confirm.input.value !== guild.name) return `Type "${guild.name}" exactly.`;
          try {
            await api.del(`/api/guilds/${guild.id}`);
          } catch (err) {
            return errorMessage(err, "Couldn't delete the server.");
          }
          ctx.close();
          ctx.opts.onDeleted();
          return null;
        },
      });
    },
  });

  return [group("Server", transferRow.el, deleteRow.el)];
}

/** A plain member's own choice for what happens to their message
 * history here — distinct from deleting their whole account. Leaving is
 * scoped to just this one server: the account itself is untouched. */
export function renderLeaveServerSection(ctx: ServerSettingsContext, guild: Guild): HTMLElement[] {
  const leaveRow = row({
    label: "Leave server",
    danger: true,
    onClick: () => {
      let mode: "erase" | "anonymize" = "erase";
      const choices = document.createElement("div");
      choices.className = "radio-group";
      const radioRow = (value: "erase" | "anonymize", label: string): HTMLLabelElement => {
        const el = document.createElement("label");
        el.className = "radio-row";
        const input = document.createElement("input");
        input.type = "radio";
        input.name = "leave-server-mode";
        input.checked = value === mode;
        input.addEventListener("change", () => {
          if (input.checked) mode = value;
        });
        el.append(input, document.createTextNode(label));
        return el;
      };
      choices.append(
        radioRow("erase", "Delete my messages and reactions here"),
        radioRow("anonymize", 'Keep my messages as "Former member"'),
      );
      formDialog({
        title: `Leave ${guild.name}`,
        content: [choices],
        submitLabel: "Leave",
        danger: true,
        onSubmit: async () => {
          try {
            await api.post(`/api/guilds/${guild.id}/leave`, { mode });
          } catch (err) {
            return errorMessage(err, "Couldn't leave the server.");
          }
          ctx.close();
          ctx.opts.onLeft();
          return null;
        },
      });
    },
  });

  return [group(null, leaveRow.el)];
}
