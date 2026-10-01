use argon2::password_hash::{
    rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString,
};
use argon2::Argon2;

/// Hashes a password with Argon2id using the crate's recommended
/// parameters (~19 MiB, 2 passes — roughly 100ms on modest hardware).
pub fn hash(password: &str) -> anyhow::Result<String> {
    let salt = SaltString::generate(&mut OsRng);
    let hash = Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| anyhow::anyhow!("failed to hash password: {e}"))?;
    Ok(hash.to_string())
}

/// Verifies `password` against a hash produced by [`hash`]. Argon2's
/// own verification is constant-time; a malformed stored hash is
/// treated as "does not match" rather than an error.
pub fn verify(hash: &str, password: &str) -> bool {
    let Ok(parsed) = PasswordHash::new(hash) else { return false };
    Argon2::default().verify_password(password.as_bytes(), &parsed).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hashes_and_verifies_round_trip() {
        let hashed = hash("correct horse battery staple").unwrap();
        assert!(verify(&hashed, "correct horse battery staple"));
        assert!(!verify(&hashed, "wrong password"));
    }

    #[test]
    fn each_hash_uses_a_fresh_salt() {
        let a = hash("same password").unwrap();
        let b = hash("same password").unwrap();
        assert_ne!(a, b);
    }

    #[test]
    fn verify_rejects_garbage_hashes_instead_of_panicking() {
        assert!(!verify("not a real hash", "anything"));
    }
}
