//! The permission bitflags and resolution algorithm. Designed once,
//! here, so channels/roles/overwrites never need a breaking change to
//! add a new permission — just another bit.

use bitflags::bitflags;
use serde::{Deserialize, Serialize};

bitflags! {
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
    pub struct Permissions: u64 {
        const VIEW_CHANNEL     = 1 << 0;
        const SEND_MESSAGES    = 1 << 1;
        const MANAGE_MESSAGES  = 1 << 2;
        const MANAGE_CHANNELS  = 1 << 3;
        const MANAGE_ROLES     = 1 << 4;
        const MANAGE_GUILD     = 1 << 5;
        const KICK_MEMBERS     = 1 << 6;
        const BAN_MEMBERS      = 1 << 7;
        const CREATE_INVITE    = 1 << 8;
        const CONNECT          = 1 << 9;
        const SPEAK            = 1 << 10;
        const MUTE_MEMBERS     = 1 << 11;
        const ADMINISTRATOR    = 1 << 12;
        // Bits 13-63 reserved for future permissions.
    }
}

impl Default for Permissions {
    fn default() -> Self {
        Permissions::empty()
    }
}

/// An allow/deny pair, e.g. a channel overwrite for a role or member.
#[derive(Debug, Clone, Copy, Default)]
pub struct Overwrite {
    pub allow: Permissions,
    pub deny: Permissions,
}

/// Resolves a member's effective permissions in a channel.
///
/// Order (each step can only narrow or widen what the previous step
/// left, never skip ahead): guild owner / `ADMINISTRATOR` short-circuits
/// to everything; otherwise start from the union of the member's role
/// permissions (which must already include `@everyone`'s), then apply
/// the `@everyone` overwrite, then the union of the member's other role
/// overwrites, then the member-specific overwrite.
pub fn resolve(
    is_owner: bool,
    base_permissions: Permissions,
    everyone_overwrite: Option<Overwrite>,
    role_overwrites: &[Overwrite],
    member_overwrite: Option<Overwrite>,
) -> Permissions {
    if is_owner || base_permissions.contains(Permissions::ADMINISTRATOR) {
        return Permissions::all();
    }

    let mut perms = base_permissions;

    if let Some(ow) = everyone_overwrite {
        perms = (perms & !ow.deny) | ow.allow;
    }

    let mut role_allow = Permissions::empty();
    let mut role_deny = Permissions::empty();
    for ow in role_overwrites {
        role_allow |= ow.allow;
        role_deny |= ow.deny;
    }
    perms = (perms & !role_deny) | role_allow;

    if let Some(ow) = member_overwrite {
        perms = (perms & !ow.deny) | ow.allow;
    }

    perms
}

/// Role hierarchy check: can a member whose highest role sits at
/// `actor_highest_position` manage (assign/edit/delete) a role at
/// `target_position`? Strictly-greater, matching "cannot touch a role
/// at or above your own highest role."
pub fn can_manage_role(actor_highest_position: i64, target_position: i64) -> bool {
    actor_highest_position > target_position
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn owner_gets_everything_regardless_of_roles_or_overwrites() {
        let perms = resolve(
            true,
            Permissions::empty(),
            Some(Overwrite { allow: Permissions::empty(), deny: Permissions::all() }),
            &[],
            None,
        );
        assert_eq!(perms, Permissions::all());
    }

    #[test]
    fn administrator_bypasses_denying_overwrites() {
        let perms = resolve(
            false,
            Permissions::ADMINISTRATOR,
            Some(Overwrite { allow: Permissions::empty(), deny: Permissions::VIEW_CHANNEL }),
            &[],
            None,
        );
        assert_eq!(perms, Permissions::all());
    }

    #[test]
    fn everyone_overwrite_can_deny_a_base_permission() {
        let perms = resolve(
            false,
            Permissions::VIEW_CHANNEL | Permissions::SEND_MESSAGES,
            Some(Overwrite { allow: Permissions::empty(), deny: Permissions::SEND_MESSAGES }),
            &[],
            None,
        );
        assert_eq!(perms, Permissions::VIEW_CHANNEL);
    }

    #[test]
    fn role_overwrite_outranks_everyone_overwrite() {
        // @everyone denies SEND_MESSAGES, but a role the member has allows it back.
        let perms = resolve(
            false,
            Permissions::VIEW_CHANNEL,
            Some(Overwrite { allow: Permissions::empty(), deny: Permissions::SEND_MESSAGES }),
            &[Overwrite { allow: Permissions::SEND_MESSAGES, deny: Permissions::empty() }],
            None,
        );
        assert!(perms.contains(Permissions::SEND_MESSAGES));
    }

    #[test]
    fn member_overwrite_outranks_role_overwrite() {
        // A role allows SEND_MESSAGES, but a member-specific overwrite denies it.
        let perms = resolve(
            false,
            Permissions::empty(),
            None,
            &[Overwrite { allow: Permissions::SEND_MESSAGES, deny: Permissions::empty() }],
            Some(Overwrite { allow: Permissions::empty(), deny: Permissions::SEND_MESSAGES }),
        );
        assert!(!perms.contains(Permissions::SEND_MESSAGES));
    }

    #[test]
    fn deny_then_allow_at_the_same_level_favours_allow() {
        // Two role overwrites disagree: one denies, one allows. Allow wins
        // because we OR all role-allows and OR all role-denies separately,
        // then apply deny-then-allow — matching Discord's own semantics.
        let perms = resolve(
            false,
            Permissions::empty(),
            None,
            &[
                Overwrite { allow: Permissions::empty(), deny: Permissions::SEND_MESSAGES },
                Overwrite { allow: Permissions::SEND_MESSAGES, deny: Permissions::empty() },
            ],
            None,
        );
        assert!(perms.contains(Permissions::SEND_MESSAGES));
    }

    #[test]
    fn role_hierarchy_forbids_managing_a_role_at_or_above_your_own() {
        assert!(can_manage_role(5, 3));
        assert!(!can_manage_role(5, 5));
        assert!(!can_manage_role(5, 7));
    }
}
