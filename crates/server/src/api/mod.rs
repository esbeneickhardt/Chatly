//! `/api/*` routes.

pub mod current_user;
pub mod error;

mod admin;
mod audit;
mod auth;
mod bots;
mod channels;
mod dms;
mod friends;
mod guilds;
mod invites;
mod messages;
mod mfa;
pub(crate) mod permissions;
mod reactions;
mod roles;
mod search;
mod server_admins;
mod system;
mod uploads;
mod voice;

use axum::extract::DefaultBodyLimit;
use axum::routing::{delete, get, patch, post};
use axum::Router;

use crate::state::SharedState;
use error::AppError;

/// `max_upload_bytes` overrides axum's own default request-body limit
/// (2 MB — silent and easy to miss, see `Cargo.toml`/axum's docs on
/// `DefaultBodyLimit`) for the upload route specifically, so it's our
/// own configurable `max_upload_bytes` check in `uploads::upload` that
/// actually decides what's too big — not an unrelated hard-coded cap
/// that rejects most real-world audio/video files regardless of type.
pub fn router(max_upload_bytes: u64) -> Router<SharedState> {
    Router::new()
        .route("/register", post(auth::register))
        .route("/login", post(auth::login))
        .route("/logout", post(auth::logout))
        .route("/logout-all", post(auth::logout_all))
        .route("/me", get(auth::me).patch(auth::update_profile).delete(auth::delete_account))
        .route("/me/avatar", post(auth::update_avatar))
        .route("/me/password", post(auth::change_password))
        .route("/me/export", get(auth::export_data))
        .route("/me/transfer-ownership", post(auth::transfer_ownership))
        .route("/sessions", get(auth::list_sessions))
        .route("/sessions/revoke-others", post(auth::revoke_other_sessions))
        .route("/sessions/:id", delete(auth::revoke_session))
        .route("/mfa/totp/enroll", post(mfa::enroll))
        .route("/mfa/totp/confirm", post(mfa::confirm))
        .route("/mfa/totp/disable", post(mfa::disable))
        .route("/mfa/verify", post(mfa::verify))
        .route("/invites", post(invites::create).get(invites::list))
        .route("/invites/:id", delete(invites::revoke))
        .route("/invites/redeem", post(invites::redeem))
        .route("/invites/:code/preview", get(invites::preview))
        .route("/register-guest", post(invites::register_guest))
        .route("/guilds", get(guilds::list_mine).post(guilds::create))
        .route("/guilds/:id", get(guilds::get).patch(guilds::update).delete(guilds::delete))
        .route("/guilds/:id/invite-policy", patch(guilds::set_invite_policy))
        .route("/guilds/:id/transfer-ownership", post(guilds::transfer_ownership))
        .route("/guilds/:id/channels", get(guilds::list_channels).post(guilds::create_channel))
        .route("/guilds/:id/channels/:channel_id", delete(guilds::delete_channel))
        .route("/guilds/:id/members", get(guilds::list_members))
        .route("/guilds/:id/members/:user_id", delete(guilds::remove_member))
        .route("/guilds/:id/leave", post(guilds::leave))
        .route("/guilds/:id/voice-state", get(guilds::voice_state))
        .route("/guilds/:id/bots", get(bots::list).post(bots::create))
        .route("/guilds/:id/bots/:bot_id/revoke", post(bots::revoke))
        .route("/guilds/:id/roles", get(roles::list).post(roles::create))
        .route("/guilds/:id/roles/:role_id", patch(roles::update).delete(roles::delete))
        .route("/guilds/:id/members/:user_id/roles", get(roles::member_roles))
        .route(
            "/guilds/:id/members/:user_id/roles/:role_id",
            post(roles::assign).delete(roles::unassign),
        )
        .route(
            "/channels/:id/overwrites/roles/:role_id",
            post(roles::set_role_overwrite).delete(roles::clear_role_overwrite),
        )
        .route(
            "/channels/:id/overwrites/members/:user_id",
            post(roles::set_member_overwrite).delete(roles::clear_member_overwrite),
        )
        .route("/channels/:id/messages", get(messages::list).post(messages::create))
        .route("/messages/:id", patch(messages::edit).delete(messages::delete))
        .route("/channels/:id/roster", get(channels::roster))
        .route("/channels/:id/members", post(channels::add_member))
        .route("/channels/:id/members/:user_id", delete(channels::remove_member))
        .route("/messages/:id/reactions/:emoji", post(reactions::add).delete(reactions::remove))
        .route("/dms", get(dms::list).post(dms::open))
        .route("/dms/voice-state", get(dms::voice_state))
        .route("/dms/:id/pin", post(dms::pin).delete(dms::unpin))
        .route("/dms/:id/hide", post(dms::hide))
        .route("/dms/:id/leave", post(dms::leave))
        .route("/dms/:id/participants", post(dms::add_participant))
        .route("/dms/:id/call/decline", post(dms::decline_call))
        .route("/users/search", get(dms::search_users))
        .route("/search", get(search::search))
        .route("/friends", get(friends::list))
        .route("/friends/:id", delete(friends::remove))
        .route("/friends/requests", get(friends::list_requests).post(friends::create_request))
        .route(
            "/friends/requests/:id",
            post(friends::accept_request).delete(friends::remove_request),
        )
        .route("/friends/settings", patch(friends::update_settings))
        .route(
            "/uploads",
            post(uploads::upload).layer(DefaultBodyLimit::max(max_upload_bytes as usize)),
        )
        .route("/files/:id", get(uploads::download))
        .route("/system/stats", get(system::stats))
        .route("/admin/users", get(admin::list_users))
        .route("/admin/users/:id/delete", post(admin::delete_user))
        .route("/admin/audit-log", get(audit::global_log))
        .route("/guilds/:id/audit-log", get(audit::guild_log))
        .route("/admin/guilds", get(admin::list_guilds))
        .route("/admin/guilds/:id", delete(admin::delete_guild))
        .route("/admin/guilds/:id/members", get(admin::list_guild_members))
        .route("/admin/guilds/:id/owner", post(admin::set_guild_owner))
        .route(
            "/guilds/:id/admins/:user_id",
            axum::routing::put(server_admins::add).delete(server_admins::remove),
        )
        .route("/voice/ice-servers", get(voice::ice_servers))
        .fallback(not_found)
}

async fn not_found() -> AppError {
    AppError::not_found("not_found", "no such API route")
}

#[cfg(test)]
mod tests {
    /// Every `.route("<path>", …)` in this file must appear in
    /// `docs/api.md` — the API reference can't silently fall behind the
    /// router.
    #[test]
    fn docs_list_every_route() {
        let source = include_str!("mod.rs");
        let docs = include_str!("../../../../docs/api.md");
        let router = &source[source.find("pub fn router").expect("router fn")..];
        let router = &router[..router.find("#[cfg(test)]").unwrap_or(router.len())];

        let mut missing = Vec::new();
        for chunk in router.split(".route(").skip(1) {
            let Some(rest) = chunk.trim_start().strip_prefix('"') else { continue };
            let Some(path) = rest.split('"').next() else { continue };
            if !docs.contains(&format!("`{path}`")) {
                missing.push(path.to_string());
            }
        }
        assert!(missing.is_empty(), "routes missing from docs/api.md: {missing:?}");
    }

    /// `docs/openapi.json` is generated from `docs/api.md`; every router
    /// path must be in it too (`:id` becomes `{id}`), so the machine-readable
    /// spec can't fall behind either.
    #[test]
    fn openapi_lists_every_route() {
        let source = include_str!("mod.rs");
        let spec: serde_json::Value =
            serde_json::from_str(include_str!("../../../../docs/openapi.json"))
                .expect("docs/openapi.json is valid JSON");
        let paths = spec["paths"].as_object().expect("paths object");
        let router = &source[source.find("pub fn router").expect("router fn")..];
        let router = &router[..router.find("#[cfg(test)]").unwrap_or(router.len())];

        let mut missing = Vec::new();
        for chunk in router.split(".route(").skip(1) {
            let Some(rest) = chunk.trim_start().strip_prefix('"') else { continue };
            let Some(path) = rest.split('"').next() else { continue };
            let openapi_path = path
                .split('/')
                .map(|seg| match seg.strip_prefix(':') {
                    Some(name) => format!("{{{name}}}"),
                    None => seg.to_string(),
                })
                .collect::<Vec<_>>()
                .join("/");
            if !paths.contains_key(&openapi_path) {
                missing.push(path.to_string());
            }
        }
        assert!(missing.is_empty(), "routes missing from docs/openapi.json: {missing:?}");
    }
}
