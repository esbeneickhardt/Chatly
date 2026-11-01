//! The two pieces of cryptography Web Push needs: the server's VAPID key,
//! which signs a short token telling the push service who is sending
//! (RFC 8292), and the message encryption a browser expects (RFC 8291,
//! `aes128gcm`), so the push service only ever relays ciphertext.

use std::path::Path;

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes128Gcm, Nonce};
use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64URL;
use base64::Engine;
use hkdf::Hkdf;
use p256::ecdsa::signature::Signer;
use p256::ecdsa::{Signature, SigningKey};
use p256::elliptic_curve::sec1::ToEncodedPoint;
use p256::{PublicKey, SecretKey};
use rand::RngCore;
use sha2_10::Sha256;

/// Record size written into the header; a notification is always one record.
const RECORD_SIZE: u32 = 4096;
/// Largest payload one record carries (record size minus the AES-GCM tag
/// and the padding delimiter), with room left for the header.
pub const MAX_PAYLOAD: usize = 3800;

/// The server's VAPID key pair, generated once and kept in
/// `$DATA_DIR/vapid_key` (base64url private scalar). Replacing it
/// invalidates every browser's subscription, so it travels with backups.
pub struct VapidKey {
    signing: SigningKey,
    /// Uncompressed public point, base64url: what browsers subscribe with.
    public_b64: String,
}

impl VapidKey {
    pub fn load_or_create(data_dir: &Path) -> anyhow::Result<Self> {
        let path = data_dir.join("vapid_key");
        let secret = match std::fs::read_to_string(&path) {
            Ok(contents) => {
                let bytes = B64URL.decode(contents.trim())?;
                SecretKey::from_slice(&bytes).map_err(|_| {
                    anyhow::anyhow!("{} does not contain a valid key", path.display())
                })?
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                let secret = SecretKey::random(&mut rand::rngs::OsRng);
                std::fs::write(&path, B64URL.encode(secret.to_bytes()))?;
                tracing::info!(path = %path.display(), "generated a Web Push (VAPID) key");
                secret
            }
            Err(e) => return Err(e.into()),
        };
        let public_b64 = B64URL.encode(secret.public_key().to_encoded_point(false).as_bytes());
        Ok(VapidKey { signing: SigningKey::from(secret), public_b64 })
    }

    pub fn public_key(&self) -> &str {
        &self.public_b64
    }

    /// The `Authorization` header value for a request to `endpoint`'s push
    /// service: a JWT for its origin, valid for 12 hours.
    pub fn authorization(&self, endpoint: &str, subject: &str, now_secs: u64) -> Option<String> {
        let audience = origin_of(endpoint)?;
        let header = B64URL.encode(br#"{"typ":"JWT","alg":"ES256"}"#);
        let claims = serde_json::json!({
            "aud": audience,
            "exp": now_secs + 12 * 60 * 60,
            "sub": subject,
        });
        let claims = B64URL.encode(claims.to_string());
        let signing_input = format!("{header}.{claims}");
        let signature: Signature = self.signing.sign(signing_input.as_bytes());
        let jwt = format!("{signing_input}.{}", B64URL.encode(signature.to_bytes()));
        Some(format!("vapid t={jwt}, k={}", self.public_b64))
    }
}

/// `https://host[:port]` of a URL, the audience a push service checks.
fn origin_of(url: &str) -> Option<String> {
    let rest = url.strip_prefix("https://")?;
    let host = rest.split('/').next().filter(|h| !h.is_empty())?;
    Some(format!("https://{host}"))
}

/// Why a subscription's keys couldn't be used.
#[derive(Debug, thiserror::Error)]
pub enum KeyError {
    #[error("p256dh is not a P-256 public key")]
    BadPublicKey,
    #[error("auth must be 16 bytes")]
    BadAuth,
}

/// Decodes and checks a browser's subscription keys.
pub fn parse_keys(p256dh: &str, auth: &str) -> Result<(PublicKey, [u8; 16]), KeyError> {
    let point = B64URL.decode(p256dh.trim_end_matches('=')).map_err(|_| KeyError::BadPublicKey)?;
    let public = PublicKey::from_sec1_bytes(&point).map_err(|_| KeyError::BadPublicKey)?;
    let auth = B64URL.decode(auth.trim_end_matches('=')).map_err(|_| KeyError::BadAuth)?;
    let auth: [u8; 16] = auth.try_into().map_err(|_| KeyError::BadAuth)?;
    Ok((public, auth))
}

/// Encrypts `payload` for one browser (RFC 8291), returning the request body.
pub fn encrypt(ua_public: &PublicKey, auth: &[u8; 16], payload: &[u8]) -> Vec<u8> {
    let mut salt = [0u8; 16];
    rand::rngs::OsRng.fill_bytes(&mut salt);
    let ephemeral = SecretKey::random(&mut rand::rngs::OsRng);
    encrypt_with(ua_public, auth, payload, &ephemeral, salt)
}

fn encrypt_with(
    ua_public: &PublicKey,
    auth: &[u8; 16],
    payload: &[u8],
    ephemeral: &SecretKey,
    salt: [u8; 16],
) -> Vec<u8> {
    let ua_point = ua_public.to_encoded_point(false);
    let as_point = ephemeral.public_key().to_encoded_point(false);
    let shared = p256::ecdh::diffie_hellman(ephemeral.to_nonzero_scalar(), ua_public.as_affine());

    // IKM = HKDF(auth, ecdh, "WebPush: info\0" || ua_public || as_public)
    let mut key_info = Vec::with_capacity(14 + 65 + 65);
    key_info.extend_from_slice(b"WebPush: info\0");
    key_info.extend_from_slice(ua_point.as_bytes());
    key_info.extend_from_slice(as_point.as_bytes());
    let mut ikm = [0u8; 32];
    Hkdf::<Sha256>::new(Some(auth), shared.raw_secret_bytes())
        .expand(&key_info, &mut ikm)
        .expect("32 bytes is a valid HKDF length");

    let prk = Hkdf::<Sha256>::new(Some(&salt), &ikm);
    let mut cek = [0u8; 16];
    prk.expand(b"Content-Encoding: aes128gcm\0", &mut cek).expect("valid length");
    let mut nonce = [0u8; 12];
    prk.expand(b"Content-Encoding: nonce\0", &mut nonce).expect("valid length");

    // One record, so it ends with the "last record" delimiter.
    let mut plaintext = Vec::with_capacity(payload.len() + 1);
    plaintext.extend_from_slice(payload);
    plaintext.push(0x02);
    let ciphertext = Aes128Gcm::new_from_slice(&cek)
        .expect("16-byte key")
        .encrypt(&Nonce::from(nonce), plaintext.as_slice())
        .expect("encryption cannot fail here");

    let mut body = Vec::with_capacity(16 + 4 + 1 + 65 + ciphertext.len());
    body.extend_from_slice(&salt);
    body.extend_from_slice(&RECORD_SIZE.to_be_bytes());
    body.push(as_point.as_bytes().len() as u8);
    body.extend_from_slice(as_point.as_bytes());
    body.extend_from_slice(&ciphertext);
    body
}

#[cfg(test)]
mod tests {
    use super::*;
    use p256::ecdsa::signature::Verifier;
    use p256::ecdsa::VerifyingKey;

    fn b64(s: &str) -> Vec<u8> {
        B64URL.decode(s).unwrap()
    }

    /// The worked example in RFC 8291, section 5: same keys and salt must
    /// give byte-for-byte the same message.
    #[test]
    fn matches_the_rfc_8291_example() {
        let ua_public = PublicKey::from_sec1_bytes(&b64(
            "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
        ))
        .unwrap();
        let auth: [u8; 16] = b64("BTBZMqHH6r4Tts7J_aSIgg").try_into().unwrap();
        let ephemeral =
            SecretKey::from_slice(&b64("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw")).unwrap();
        let salt: [u8; 16] = b64("DGv6ra1nlYgDCS1FRnbzlw").try_into().unwrap();

        let body = encrypt_with(
            &ua_public,
            &auth,
            b"When I grow up, I want to be a watermelon",
            &ephemeral,
            salt,
        );
        assert_eq!(
            B64URL.encode(body),
            "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN"
        );
    }

    #[test]
    fn vapid_token_is_signed_for_the_push_service_origin() {
        let dir = tempfile::tempdir().unwrap();
        let key = VapidKey::load_or_create(dir.path()).unwrap();
        let again = VapidKey::load_or_create(dir.path()).unwrap();
        assert_eq!(key.public_key(), again.public_key(), "the key is kept");

        let header = key
            .authorization("https://fcm.googleapis.com/fcm/send/abc", "https://chat.example", 1000)
            .unwrap();
        let (jwt, k) = header.strip_prefix("vapid t=").unwrap().split_once(", k=").unwrap();
        assert_eq!(k, key.public_key());

        let parts: Vec<&str> = jwt.split('.').collect();
        let claims: serde_json::Value = serde_json::from_slice(&b64(parts[1])).unwrap();
        assert_eq!(claims["aud"], "https://fcm.googleapis.com");
        assert_eq!(claims["sub"], "https://chat.example");
        assert_eq!(claims["exp"], 1000 + 12 * 60 * 60);

        let verifying = VerifyingKey::from_sec1_bytes(&b64(k)).unwrap();
        let signature = Signature::from_slice(&b64(parts[2])).unwrap();
        verifying.verify(format!("{}.{}", parts[0], parts[1]).as_bytes(), &signature).unwrap();
    }

    #[test]
    fn rejects_malformed_keys() {
        assert!(parse_keys("AAAA", "BTBZMqHH6r4Tts7J_aSIgg").is_err());
        let p256dh = "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4";
        assert!(parse_keys(p256dh, "c2hvcnQ").is_err());
        assert!(parse_keys(p256dh, "BTBZMqHH6r4Tts7J_aSIgg").is_ok());
    }
}
