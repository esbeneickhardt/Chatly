import { describe, expect, it } from "vitest";
import { describeAudit, type AuditEntry } from "./audit-text";

const entry = (over: Partial<AuditEntry>): AuditEntry => ({
  id: "1",
  guild_id: "g",
  actor_id: "a",
  actor_name: "Ana",
  action: "member.kick",
  target_id: "b",
  target_name: "Ben",
  detail: null,
  created_at: 0,
  ...over,
});

describe("describeAudit", () => {
  it.each([
    [{ action: "member.kick" }, "Ana removed Ben from the server"],
    [{ action: "admin.grant" }, "Ana made Ben a server admin"],
    [{ action: "admin.revoke" }, "Ana removed Ben as a server admin"],
    [{ action: "channel.create", target_name: "plans" }, "Ana created the channel #plans"],
    [{ action: "role.assign", detail: "Mods" }, "Ana gave Ben the role Mods"],
    [{ action: "guild.invite_policy", detail: "open" }, "Ana let every member create invites"],
    [{ action: "guild.invite_policy", detail: "closed" }, "Ana limited creating invites to server admins"],
    [{ action: "global.guild_delete", target_name: "Old Club" }, "Ana deleted the server Old Club"],
  ])("%j", (over, expected) => {
    expect(describeAudit(entry(over))).toBe(expected);
  });

  it("recognizes someone stepping down", () => {
    expect(describeAudit(entry({ action: "admin.revoke", actor_id: "a", target_id: "a" }))).toBe(
      "Ana stepped down as a server admin",
    );
  });

  it("still says something for an action code it doesn't know", () => {
    expect(describeAudit(entry({ action: "future.thing", target_name: "X" }))).toBe("Ana: future.thing (X)");
  });

  it("copes with a missing target name", () => {
    expect(describeAudit(entry({ action: "member.kick", target_name: null }))).toBe(
      "Ana removed someone from the server",
    );
  });
});
