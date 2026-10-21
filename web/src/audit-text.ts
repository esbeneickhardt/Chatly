// How an audit-log entry reads to a person. The server stores a stable
// action code plus names captured at the time (see migration 0025);
// turning that into a sentence is a presentation choice, so it lives
// here, where it can be tested and reworded without touching the server.

export interface AuditEntry {
  id: string;
  guild_id: string | null;
  actor_id: string | null;
  actor_name: string;
  action: string;
  target_id: string | null;
  target_name: string | null;
  detail: string | null;
  created_at: number;
}

/** One-sentence description of `entry`, e.g. "Ana made Ben a server
 * admin". Unknown action codes (from a newer server) degrade to the raw
 * code rather than disappearing. */
export function describeAudit(entry: AuditEntry): string {
  const who = entry.actor_name;
  const target = entry.target_name ?? "someone";
  const detail = entry.detail ?? "";
  switch (entry.action) {
    case "member.kick":
      return `${who} removed ${target} from the server`;
    case "admin.grant":
      return `${who} made ${target} a server admin`;
    case "admin.revoke":
      return entry.actor_id !== null && entry.actor_id === entry.target_id
        ? `${who} stepped down as a server admin`
        : `${who} removed ${target} as a server admin`;
    case "role.create":
      return `${who} created the role ${target}`;
    case "role.update":
      return `${who} changed the role ${target}`;
    case "role.delete":
      return `${who} deleted the role ${target}`;
    case "role.assign":
      return `${who} gave ${target} the role ${detail}`;
    case "role.unassign":
      return `${who} took the role ${detail} from ${target}`;
    case "channel.create":
      return `${who} created the channel #${target}`;
    case "channel.delete":
      return `${who} deleted the channel #${target}`;
    case "guild.update":
      return `${who} changed the server's ${detail || "settings"}`;
    case "guild.invite_policy":
      return detail === "open"
        ? `${who} let every member create invites`
        : `${who} limited creating invites to server admins`;
    case "guild.transfer":
      return `${who} handed the server to ${target}`;
    case "bot.create":
      return `${who} added the bot ${target}`;
    case "bot.revoke":
      return `${who} revoked the bot ${target}'s token`;
    case "global.app_icon":
      return `${who} changed the app icon`;
    case "global.user_delete":
      return `${who} deleted the account ${target}`;
    case "global.user_password":
      return `${who} reset ${target}'s password`;
    case "global.guild_delete":
      return `${who} deleted the server ${target}`;
    case "global.guild_owner":
      return `${who} made ${target} the owner of ${detail}`;
    default:
      return `${who}: ${entry.action}${entry.target_name ? ` (${entry.target_name})` : ""}`;
  }
}
