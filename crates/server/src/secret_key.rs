//! The server's at-rest encryption key, used to encrypt TOTP secrets in
//! the database. Read from `SECRET_KEY` (base64, 32 bytes) if set;
//! otherwise generated once and persisted to `$DATA_DIR/secret_key` so
//! restarts don't lock users out of MFA. Setting `SECRET_KEY` explicitly
//! is recommended so the key travels with backups made by copying the
//! database alone (see `docs/admin.md`).

use std::path::Path;

use aes_gcm::aead::{Aead, KeyInit, OsRng};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use rand::RngCore;

const KEY_LEN: usize = 32;
const NONCE_LEN: usize = 12;

#[derive(Clone)]
pub struct SecretKey([u8; KEY_LEN]);

impl SecretKey {
    pub fn load_or_create(data_dir: &Path) -> anyhow::Result<Self> {
        if let Ok(encoded) = std::env::var("SECRET_KEY") {
            let bytes = BASE64.decode(encoded.trim())?;
            let key: [u8; KEY_LEN] = bytes.try_into().map_err(|_| {
                anyhow::anyhow!("SECRET_KEY must decode to exactly {KEY_LEN} bytes")
            })?;
            return Ok(SecretKey(key));
        }

        let path = data_dir.join("secret_key");
        if let Ok(contents) = std::fs::read_to_string(&path) {
            let bytes = BASE64.decode(contents.trim())?;
            let key: [u8; KEY_LEN] = bytes
                .try_into()
                .map_err(|_| anyhow::anyhow!("{} does not contain a valid key", path.display()))?;
            return Ok(SecretKey(key));
        }

        tracing::warn!(
            path = %path.display(),
            "SECRET_KEY not set; generated one and stored it on disk. \
             Set SECRET_KEY explicitly for portable backups (see docs/admin.md)."
        );
        let mut key = [0u8; KEY_LEN];
        rand::rngs::OsRng.fill_bytes(&mut key);
        std::fs::write(&path, BASE64.encode(key))?;
        Ok(SecretKey(key))
    }

    /// Encrypts `plaintext`, returning `nonce || ciphertext`.
    pub fn encrypt(&self, plaintext: &[u8]) -> Vec<u8> {
        let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&self.0));
        let mut nonce_bytes = [0u8; NONCE_LEN];
        OsRng.fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);
        let ciphertext = cipher.encrypt(nonce, plaintext).expect("encryption cannot fail here");

        let mut out = Vec::with_capacity(NONCE_LEN + ciphertext.len());
        out.extend_from_slice(&nonce_bytes);
        out.extend_from_slice(&ciphertext);
        out
    }

    /// Decrypts a blob produced by [`encrypt`](Self::encrypt).
    pub fn decrypt(&self, blob: &[u8]) -> anyhow::Result<Vec<u8>> {
        if blob.len() < NONCE_LEN {
            anyhow::bail!("encrypted blob too short");
        }
        let (nonce_bytes, ciphertext) = blob.split_at(NONCE_LEN);
        let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&self.0));
        cipher
            .decrypt(Nonce::from_slice(nonce_bytes), ciphertext)
            .map_err(|_| anyhow::anyhow!("decryption failed (wrong key or corrupted data)"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encrypts_and_decrypts_round_trip() {
        let mut key = [0u8; KEY_LEN];
        rand::rngs::OsRng.fill_bytes(&mut key);
        let secret_key = SecretKey(key);

        let plaintext = b"totp secret bytes";
        let encrypted = secret_key.encrypt(plaintext);
        assert_ne!(encrypted.as_slice(), plaintext.as_slice());

        let decrypted = secret_key.decrypt(&encrypted).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn decrypt_fails_with_the_wrong_key() {
        let mut key_a = [0u8; KEY_LEN];
        rand::rngs::OsRng.fill_bytes(&mut key_a);
        let mut key_b = [0u8; KEY_LEN];
        rand::rngs::OsRng.fill_bytes(&mut key_b);

        let encrypted = SecretKey(key_a).encrypt(b"secret");
        assert!(SecretKey(key_b).decrypt(&encrypted).is_err());
    }

    #[test]
    fn load_or_create_persists_a_generated_key_across_calls() {
        let dir = tempfile::tempdir().unwrap();
        std::env::remove_var("SECRET_KEY");
        let first = SecretKey::load_or_create(dir.path()).unwrap();
        let second = SecretKey::load_or_create(dir.path()).unwrap();
        assert_eq!(first.0, second.0);
    }
}
