//! Issues short-lived TURN credentials for the browser's
//! `RTCPeerConnection` to use alongside the plain host/server-reflexive
//! candidates the voice SFU already advertises on its own (see
//! `voice::spawn`). Those work when the two sides' networks can reach
//! each other directly, which a real deployment can't assume — many
//! real NAT setups (symmetric NAT, CGNAT, common on mobile networks
//! and plenty of home routers) simply can't complete a direct UDP
//! handshake, no matter how correct the signaling is. A TURN relay is
//! the standard fallback: the browser relays its media through it
//! instead, at the cost of a bit of extra latency.
//!
//! Uses coturn's `--use-auth-secret` REST API convention (an HMAC over
//! a `<expiry-unix-time>:<label>` username, keyed by a secret shared
//! with the TURN server) rather than a fixed username/password, so
//! nothing long-lived needs to be embedded in the client at all — a
//! stolen credential expires with the connection, not never.

use axum::extract::State;
use axum::Json;
use base64::Engine;
use hmac::{Hmac, KeyInit, Mac};
use serde::Serialize;
use sha1::Sha1;

use super::current_user::CurrentUser;
use crate::state::SharedState;

/// How long an issued credential remains valid. Generous relative to
/// how long a single call might run — there's no re-issuance path once
/// `join()` builds its `RTCPeerConnection`, so this needs to outlast
/// the longest realistic call rather than just the handshake.
const CREDENTIAL_TTL_SECS: u64 = 12 * 60 * 60;

#[derive(Serialize)]
pub struct IceServer {
    urls: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    username: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    credential: Option<String>,
}

#[derive(Serialize)]
pub struct IceServersResponse {
    ice_servers: Vec<IceServer>,
}

/// Any signed-in user gets the same short-lived credential — there's
/// no per-user restriction to enforce here (unlike, say, invites),
/// just "are you logged in at all."
pub async fn ice_servers(
    State(state): State<SharedState>,
    _current: CurrentUser,
) -> Json<IceServersResponse> {
    let mut ice_servers = Vec::new();

    if let Some(secret) = &state.config.turn_secret {
        let host = state
            .config
            .turn_host
            .clone()
            .or_else(|| state.config.voice_public_ip.map(|ip| ip.to_string()));

        if let Some(host) = host {
            let port = state.config.turn_port;
            let (username, credential) = generate_credential(secret);
            ice_servers.push(IceServer {
                urls: vec![format!("stun:{host}:{port}")],
                username: None,
                credential: None,
            });
            ice_servers.push(IceServer {
                urls: vec![
                    format!("turn:{host}:{port}?transport=udp"),
                    format!("turn:{host}:{port}?transport=tcp"),
                ],
                username: Some(username),
                credential: Some(credential),
            });
        }
    }

    Json(IceServersResponse { ice_servers })
}

fn sign(secret: &str, username: &str) -> String {
    let mut mac = Hmac::<Sha1>::new_from_slice(secret.as_bytes())
        .expect("HMAC-SHA1 accepts a key of any length");
    mac.update(username.as_bytes());
    base64::engine::general_purpose::STANDARD.encode(mac.finalize().into_bytes())
}

fn generate_credential(secret: &str) -> (String, String) {
    let expires_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        + CREDENTIAL_TTL_SECS;
    let username = expires_at.to_string();
    let credential = sign(secret, &username);
    (username, credential)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signing_is_deterministic_for_the_same_input() {
        assert_eq!(sign("shared-secret", "1234567890"), sign("shared-secret", "1234567890"));
    }

    #[test]
    fn different_secrets_sign_the_same_username_differently() {
        assert_ne!(sign("secret-a", "1234567890"), sign("secret-b", "1234567890"));
    }

    #[test]
    fn different_usernames_sign_differently_under_the_same_secret() {
        assert_ne!(sign("shared-secret", "1111111111"), sign("shared-secret", "2222222222"));
    }
}
