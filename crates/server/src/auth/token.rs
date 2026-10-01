//! Random tokens and codes, and the one-way hash used to store session
//! tokens and recovery codes (never the value itself — see `docs/admin.md`
//! threat model notes).

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use rand::Rng;
use sha2::{Digest, Sha256};

/// A 32-byte random session token, base64url-encoded (no padding).
pub fn generate_session_token() -> String {
    let mut bytes = [0u8; 32];
    rand::rngs::OsRng.fill(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

/// SHA-256 of a token/code, base64url-encoded. Session tokens and
/// recovery codes are already high-entropy random values, so a fast
/// hash (rather than Argon2) is appropriate — unlike passwords, there's
/// no low-entropy human input to slow an attacker down against.
pub fn hash(value: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(value.as_bytes()))
}

const INVITE_ALPHABET: &[u8] = b"ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/// An 8-character invite code from an unambiguous alphabet (no `0`/`O`,
/// `1`/`I`/`L`).
pub fn generate_invite_code() -> String {
    random_string(8, INVITE_ALPHABET)
}

/// A 10-character single-use MFA recovery code, same alphabet as invites.
pub fn generate_recovery_code() -> String {
    random_string(10, INVITE_ALPHABET)
}

fn random_string(len: usize, alphabet: &[u8]) -> String {
    let mut rng = rand::rngs::OsRng;
    (0..len).map(|_| alphabet[rng.gen_range(0..alphabet.len())] as char).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_tokens_are_unique_and_url_safe() {
        let a = generate_session_token();
        let b = generate_session_token();
        assert_ne!(a, b);
        assert!(a.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
    }

    #[test]
    fn hash_is_deterministic_and_not_the_input() {
        let token = "some-token-value";
        assert_eq!(hash(token), hash(token));
        assert_ne!(hash(token), token);
    }

    #[test]
    fn invite_codes_avoid_ambiguous_characters() {
        for _ in 0..100 {
            let code = generate_invite_code();
            assert_eq!(code.len(), 8);
            assert!(!code.contains(['0', 'O', '1', 'I', 'L']));
        }
    }
}
