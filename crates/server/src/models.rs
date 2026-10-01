//! Domain types shared between the storage layer and the API handlers.
//! Anything with a `Serialize` impl is part of the public API response
//! shape; secrets (password hashes, encrypted TOTP secrets, token/code
//! hashes) deliberately have no `Serialize` impl at all so they can
//! never accidentally leak into a JSON response.

use protocol::{Id, Permissions};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
pub struct User {
    pub id: Id,
    pub username: String,
    pub display_name: String,
    pub is_owner: bool,
    pub can_invite: bool,
    pub created_at: i64,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub mfa_enabled: bool,
    pub avatar_file_id: Option<Id>,
    pub accepts_friend_requests: bool,
    /// A bot account (see `api::bots`) — authenticated by a long-lived
    /// bearer token instead of a session cookie, otherwise an ordinary
    /// member: same permission checks, same message/reaction
    /// endpoints, same guild-membership model. `#[serde(skip_serializing_if)]`
    /// so the vastly more common human `User` JSON doesn't grow a
    /// `"is_bot": false` on every single response.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub is_bot: bool,
    /// An ephemeral, auto-expiring guest — someone who joined a DM's
    /// voice/video call via a link with no signup at all (see
    /// `api::invites::register_guest`). A real account/session under
    /// the hood (see that function's doc comment on why), just one
    /// that's about to be cleaned up and that `require_human` blocks
    /// from anything beyond that one conversation.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub is_guest: bool,
}

#[derive(Clone)]
pub struct NewUser {
    pub id: Id,
    pub username: String,
    pub display_name: String,
    pub password_hash: String,
    pub is_owner: bool,
    pub is_bot: bool,
}

/// Row fetched only for the login path — carries the password hash,
/// which `User` never does.
pub struct UserWithPasswordHash {
    pub user: User,
    pub password_hash: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Session {
    pub id: Id,
    pub created_at: i64,
    pub expires_at: i64,
    pub last_seen: i64,
    pub user_agent: Option<String>,
    /// Per-viewer, like `Channel.can_manage` — whether this is the
    /// session the request making this list came in on, so the client
    /// can call it out instead of showing an undifferentiated list.
    #[serde(default)]
    pub is_current: bool,
}

pub struct NewSession {
    pub id: Id,
    pub user_id: Id,
    pub token_hash: String,
    pub created_at: i64,
    pub expires_at: i64,
    pub user_agent: Option<String>,
}

pub struct SessionWithUser {
    pub session_id: Id,
    pub last_seen: i64,
    pub user: User,
    /// `Some` only for a guest account — checked by `CurrentUser`'s
    /// session-cookie path to treat an expired guest exactly like an
    /// expired session, and opportunistically clean it up.
    pub guest_expires_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Invite {
    pub id: Id,
    pub code: String,
    pub created_by: Id,
    pub created_at: i64,
    pub expires_at: Option<i64>,
    pub max_uses: Option<i64>,
    pub uses: i64,
    pub revoked: bool,
    /// Where redeeming this invite actually takes you — `None` only
    /// for invites predating the unified invite system (see migration
    /// 0013), which keep their original "join the (one) guild, land on
    /// Home" behavior. Every invite created since always has one: the
    /// destination *is* the whole point of "universal" invites (one
    /// link that both creates an account if needed and takes you
    /// straight to the right channel or DM). That destination channel's
    /// own `guild_id` decides what redeeming grants — a guild channel
    /// adds guild membership, a DM channel (`guild_id` `None`) adds DM
    /// participancy and *no* guild membership at all, matching the
    /// explicit "invited from a DM shouldn't join any server" ask.
    pub channel_id: Option<Id>,
}

pub struct NewInvite {
    pub id: Id,
    pub code: String,
    pub created_by: Id,
    pub created_at: i64,
    pub expires_at: Option<i64>,
    pub max_uses: Option<i64>,
    pub channel_id: Option<Id>,
}

pub enum RegisterOutcome {
    Ok {
        user: User,
        /// The invite's destination, if it had one and it still
        /// exists — the frontend navigates here right after
        /// registration instead of dropping the new user on Home.
        channel_id: Option<Id>,
        /// `Some` alongside `channel_id` exactly when the destination
        /// is a guild channel (so the frontend knows to switch guilds
        /// first) — `None` for a DM destination or no destination at
        /// all. Carried back explicitly rather than making the client
        /// look it up so there's no new "get a channel's guild" lookup
        /// needed just for this.
        guild_id: Option<Id>,
    },
    UsernameTaken,
    InvalidInvite,
}

/// Outcome of an already-logged-in user following an invite link
/// (`POST /api/invites/redeem`) — the equivalent of `RegisterOutcome`
/// for someone who didn't need an account created. Redeeming an invite
/// you're already covered by (already a guild member / DM participant)
/// is a harmless no-op that still reports `Ok` with the destination, so
/// clicking an old invite link you've already used just takes you
/// there again instead of erroring.
pub enum RedeemOutcome {
    /// `guild_id` mirrors `RegisterOutcome::Ok`'s field of the same
    /// name — `Some` exactly when `channel_id` is a guild channel.
    Ok {
        channel_id: Option<Id>,
        guild_id: Option<Id>,
    },
    InvalidInvite,
    /// The invite's destination is a group DM that's already at
    /// `MAX_GROUP_DM_PARTICIPANTS` — same cap `dms::add_participant`
    /// enforces for the "add by username" path, just reached through
    /// an invite link instead.
    DmFull,
}

/// One message in a GDPR data export (`GET /api/me/export`) —
/// deliberately thinner than the regular `Message` (no attachments,
/// reactions, or mentions): those are either someone else's data
/// (a reaction) or already implicit in the content itself, and an
/// export is about *this account's own* data, not a full replay of
/// every conversation it touched.
#[derive(Debug, Clone, Serialize)]
pub struct ExportedMessage {
    pub id: Id,
    pub channel_id: Id,
    pub content: String,
    pub created_at: i64,
    pub edited_at: Option<i64>,
}

/// Everything needed to create a bot account in one call — see
/// `api::bots::create` and `Storage::create_bot`.
pub struct NewBot {
    pub bot_id: Id,
    pub username: String,
    pub display_name: String,
    pub password_hash: String,
    pub guild_id: Id,
    pub token_hash: String,
    pub created_by: Id,
}

/// What a signed-out visitor's client needs to know *before* choosing
/// which form to show them — full registration, or just a display-name
/// "join this call" prompt — without spending the invite's use count
/// or requiring a code that turns out to be invalid. See
/// `api::invites::preview` and `GuestRegisterOutcome`.
#[derive(Serialize)]
pub struct InvitePreview {
    pub valid: bool,
    /// Meaningless when `valid` is false. `true` exactly when
    /// `register_guest` would accept this code.
    pub is_dm: bool,
}

/// Outcome of following a DM invite link with no account at all and
/// choosing to just join as a guest (see `api::invites::register_guest`)
/// — the no-signup counterpart to `RegisterOutcome` for a real account.
pub enum GuestRegisterOutcome {
    Ok {
        user: User,
        channel_id: Id,
    },
    InvalidInvite,
    /// The invite's destination is a guild channel, not a DM — guest
    /// join deliberately only ever works for a DM's own isolation
    /// guarantee (a participant sees nothing beyond that one
    /// conversation); a guild would expose far more than "one quick
    /// call" to someone who never signed up for anything.
    NotADmInvite,
    DmFull,
}

pub enum DeleteAccountOutcome {
    Ok,
    /// Refuses to touch the account while it still owns a guild with
    /// other members in it — no automatic "pick a new owner," they
    /// (or, for an admin-triggered deletion, the instance owner) need
    /// to transfer ownership or delete those guilds first. Names them
    /// so the caller can say exactly which ones.
    OwnsGuildsWithMembers(Vec<Guild>),
}

/// The account holder's own choice when leaving *one* guild — distinct
/// from deleting their whole account, which now always erases
/// everything, everywhere (see `DeleteAccountOutcome` and
/// UX_FEEDBACK.md). Leaving is scoped to this one server: the account
/// itself is untouched either way, still fully themselves in every
/// other server and DM.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GuildLeaveMode {
    /// Every message (and every reaction they left on anyone else's
    /// message) inside this guild is deleted outright.
    Erase,
    /// Messages/reactions stay exactly where they are, but from now on
    /// render under a generic "Former member" identity for this guild
    /// only (see migration `0019_guild_departed_members` and
    /// `queries::messages::SELECT_MESSAGE`) — the real `users` row is
    /// never touched.
    Anonymize,
}

pub struct TotpRecord {
    pub secret_enc: Vec<u8>,
    pub enabled: bool,
    pub last_step: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Guild {
    pub id: Id,
    pub name: String,
    pub owner_id: Id,
    pub created_at: i64,
    pub icon_file_id: Option<Id>,
    /// Whether members other than the owner can currently create
    /// invites — reads the @everyone role's `CREATE_INVITE` bit.
    /// Not filled in by every query that returns a `Guild` (e.g. the
    /// plain guild list doesn't bother); only `api::guilds::get`
    /// computes it today.
    #[serde(default)]
    pub invites_open: bool,
    /// What the *requesting* member can do here (their roles resolved
    /// at guild level, owner/`ADMINISTRATOR` meaning everything) — lets
    /// the client show or hide admin UI without guessing. Empty unless
    /// filled in by `api::guilds::get`, like `invites_open`.
    #[serde(default)]
    pub viewer_permissions: Permissions,
}

/// One row of the global admin's "All servers" list — every guild on the
/// instance, whether or not the admin is a member of it.
#[derive(Debug, Clone, Serialize)]
pub struct AdminGuildSummary {
    pub id: Id,
    pub name: String,
    pub icon_file_id: Option<Id>,
    pub created_at: i64,
    pub owner_id: Id,
    pub owner_username: String,
    pub owner_display_name: String,
    pub member_count: i64,
    pub channel_count: i64,
}

/// A named, guild-scoped bundle of permissions a member can be
/// assigned. Every guild has exactly one implicit `@everyone` role
/// (`id == guild_id`, created alongside the guild itself — see
/// `queries::guilds::create`) that every member has whether or not
/// they hold any other row in `member_roles`; anything beyond that is
/// a real row here. `position` is this role's rank in the hierarchy —
/// see `protocol::permissions::can_manage_role` for what it gates.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Role {
    pub id: Id,
    pub guild_id: Id,
    pub name: String,
    pub color: i64,
    pub position: i64,
    pub permissions: Permissions,
    pub hoist: bool,
    pub mentionable: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ChannelKind {
    Text,
    Voice,
    Category,
}

impl ChannelKind {
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "text" => Some(ChannelKind::Text),
            "voice" => Some(ChannelKind::Voice),
            "category" => Some(ChannelKind::Category),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct Channel {
    pub id: Id,
    /// `None` for a direct-message channel (see `PLAN.md` Phase 3.2 —
    /// DMs are channels with no guild and an explicit member list in
    /// `dm_participants`, not a separate message pipeline).
    pub guild_id: Option<Id>,
    pub name: String,
    pub kind: ChannelKind,
    pub position: i64,
    pub topic: Option<String>,
    /// `None` for channels predating this column (the two channels
    /// guild bootstrap creates) or DM channels.
    pub created_by: Option<Id>,
    /// If true, only guild members explicitly listed in
    /// `channel_members` (or a server admin — the owner, or anyone
    /// holding `ADMINISTRATOR`) can see or access this channel —
    /// everyone else doesn't even know it exists (it's omitted from the
    /// channel list, and direct access attempts get a plain 404, not a
    /// 403).
    pub restricted: bool,
    /// Per-viewer, like `ReactionSummary::reacted_by_me` — whether the
    /// *current* viewer holds the server-level `MANAGE_CHANNELS`
    /// permission (delete this channel, edit who's in it). Always
    /// `false` from row-mapping alone; set by the API layer for calls
    /// that have a viewer in scope (`list_channels`, `create_channel`).
    /// There is deliberately no channel-scoped admin: administration
    /// lives at the server level (roles) and the instance level (the
    /// global admin) — see `api::permissions`.
    #[serde(default)]
    pub can_manage: bool,
    /// Per-viewer — whether the viewer can delete *other people's*
    /// messages here (`MANAGE_MESSAGES`, resolved with this channel's
    /// overwrites). Same fill-in rules as `can_manage`.
    #[serde(default)]
    pub can_moderate: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct DmChannelSummary {
    pub channel: Channel,
    /// Every *other* participant — one for a normal 1:1 DM, several for
    /// a group DM. A self-DM is one exception: since there's no other
    /// participant at all, this holds the viewer themselves (see
    /// `queries::dms::list_for_user`, which tracks that internally via
    /// `channels.is_self_dm` rather than inferring it from this list).
    /// A real 1:1 whose other side has since deleted their account is
    /// the other way this can come back empty *without* being a
    /// self-DM — that account is hard-removed, not left behind as a
    /// participant, so there's genuinely no one else to list.
    pub participants: Vec<User>,
    /// Per-viewer — whether *this* user has pinned this conversation.
    /// Always `false` from row-mapping alone; filled in by the query
    /// that already knows the viewer (`queries::dms::list_for_user`).
    #[serde(default)]
    pub pinned: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct Message {
    pub id: Id,
    pub channel_id: Id,
    pub author_id: Id,
    pub author_display_name: String,
    pub author_avatar_file_id: Option<Id>,
    pub content: String,
    pub created_at: i64,
    pub edited_at: Option<i64>,
    pub attachments: Vec<FileMeta>,
    pub reactions: Vec<ReactionSummary>,
    pub mentions: Vec<Id>,
    pub reply_to: Option<Id>,
    /// A lightweight snapshot of the replied-to message (if any and it
    /// still exists), so the client can render a quote header without
    /// a second fetch. `None` if this message isn't a reply, or if the
    /// original was deleted.
    pub reply_preview: Option<MessageReplyPreview>,
}

#[derive(Debug, Clone, Serialize)]
pub struct MessageReplyPreview {
    pub author_display_name: String,
    pub content: String,
    /// The replied-to message's first attachment, if it has any — lets
    /// the client show an actual thumbnail (images) or a filename chip
    /// (anything else) the way Discord/Slack/Teams all do, instead of
    /// a generic "(attachment)" placeholder with no idea what it was.
    /// `None` if the original had no attachments at all.
    pub first_attachment: Option<FileMeta>,
    /// How many attachments the original message actually had — `1`
    /// means `first_attachment` is the whole story; anything higher
    /// lets the client add a "+N more" alongside it rather than
    /// silently dropping the rest.
    pub attachment_count: i64,
}

pub struct NewMessage {
    pub id: Id,
    pub channel_id: Id,
    pub author_id: Id,
    pub content: String,
    pub attachment_ids: Vec<Id>,
    pub mentions: Vec<Id>,
    pub reply_to: Option<Id>,
}

#[derive(Debug, Clone, Serialize)]
pub struct FileMeta {
    pub id: Id,
    pub filename: String,
    pub mime: String,
    pub size: i64,
}

pub struct NewFile {
    pub id: Id,
    pub uploader_id: Id,
    pub filename: String,
    pub mime: String,
    pub size: i64,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReactionSummary {
    pub emoji: String,
    pub count: i64,
    pub reacted_by_me: bool,
}

/// Unicode emoji only, from a fixed palette — matches `PLAN.md` 3.2
/// ("Unicode emoji only at first; custom emoji later") and keeps the
/// server and client's reaction pickers in sync.
pub const ALLOWED_REACTIONS: &[&str] = &[
    "👍", "👎", "❤️", "😂", "😮", "😢", "😡", "🎉", "🔥", "👀", "🚀", "💯", "😍", "🤔", "👏", "🙌",
    "✅", "❌", "💀", "🎂",
];

/// Including the creator — matches the old Discord group-DM cap, a
/// reasonable ceiling to stop the picker (or an invite link, which can
/// reach the same `dm_participants` insert — see `RedeemOutcome::DmFull`)
/// turning a DM into an unbounded broadcast list. Shared between
/// `api::dms` (the "add by username" path) and the storage layer's
/// invite-redemption code so the two enforcement points can't drift
/// out of sync.
pub const MAX_GROUP_DM_PARTICIPANTS: usize = 10;

/// A pending friend request, from the recipient's or sender's own
/// point of view (`incoming` says which) — `other` is always *the
/// other person*, never the viewer, so a client can render either
/// direction without checking ids itself.
#[derive(Debug, Clone, Serialize)]
pub struct FriendRequest {
    pub id: Id,
    pub other: User,
    pub created_at: i64,
    pub incoming: bool,
}

pub enum SendFriendRequestOutcome {
    /// A fresh pending request was created.
    Requested(FriendRequest),
    /// The other person already had a pending request in to you —
    /// this resolves it as a mutual accept instead of leaving two
    /// redundant pending rows around.
    BecameFriends(User),
    AlreadyFriends,
    AlreadyRequested,
    CannotFriendSelf,
    NotAcceptingRequests,
}

pub enum AcceptFriendRequestOutcome {
    Ok(User),
    NotFound,
}

/// Where a search looks. Narrowing here (in SQL) is the first layer of
/// access control; the API additionally re-checks every channel the hits
/// come from with the permission engine (see `api::search`), because
/// per-channel overwrites can't be expressed in a WHERE clause.
#[derive(Debug, Clone, Copy)]
pub enum SearchScope {
    /// One channel (guild channel or DM).
    Channel(Id),
    /// Every channel of one guild.
    Guild(Id),
    /// Every direct message the user is a participant in — and only those.
    Dms(Id),
}

/// Which slice of a channel's history to load. Messages are always
/// returned oldest-first, ready to append (or, for `Before`, prepend).
#[derive(Debug, Clone, Copy)]
pub enum MessageWindow {
    /// The newest messages.
    Latest,
    /// Messages older than this one — scrolling up.
    Before(Id),
    /// Messages newer than this one — scrolling down after a jump.
    After(Id),
    /// The message itself with context on both sides — jumping to a
    /// search result or a reply target.
    Around(Id),
}

/// One administrative action, as stored and as served. See
/// `migrations/0025_audit_log.sql`.
#[derive(Debug, Clone, Serialize)]
pub struct AuditEntry {
    pub id: Id,
    /// The server it happened in; `None` for a global-admin action.
    pub guild_id: Option<Id>,
    /// `None` once the actor's account is deleted (their name stays).
    pub actor_id: Option<Id>,
    pub actor_name: String,
    /// A stable code such as `member.kick` or `admin.grant`; the client
    /// turns it into a sentence.
    pub action: String,
    pub target_id: Option<Id>,
    pub target_name: Option<String>,
    pub detail: Option<String>,
    pub created_at: i64,
}

pub struct NewAuditEntry {
    pub id: Id,
    pub guild_id: Option<Id>,
    pub actor_id: Option<Id>,
    pub actor_name: String,
    pub action: String,
    pub target_id: Option<Id>,
    pub target_name: Option<String>,
    pub detail: Option<String>,
}
