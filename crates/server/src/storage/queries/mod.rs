pub mod audit;
pub mod bot_tokens;
pub mod channels;
pub mod dms;
pub mod files;
pub mod friend_requests;
pub mod friendships;
pub mod guilds;
pub mod hidden_dms;
pub mod invites;
pub mod messages;
pub mod mfa;
pub mod pinned_dms;
pub mod reactions;
pub mod roles;
pub mod sessions;
pub mod users;

/// A JSON array of ids, to bind as one parameter of a constant statement
/// (`WHERE x IN (SELECT value FROM json_each(?1))`). The SQL text never
/// changes with the number of ids, so the prepared statement is cached.
pub(super) fn ids_json(ids: impl IntoIterator<Item = protocol::Id>) -> String {
    let mut out = String::from("[");
    for (i, id) in ids.into_iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        out.push_str(&(id.raw() as i64).to_string());
    }
    out.push(']');
    out
}
