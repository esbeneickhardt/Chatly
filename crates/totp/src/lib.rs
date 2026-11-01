//! RFC 6238 TOTP (and its RFC 4226 HOTP base), written from scratch so
//! the algorithm is small enough to review in one sitting. No I/O: the
//! server owns secret storage, persistence, and replay-state.

pub mod base32;

use hmac::{Hmac, KeyInit, Mac};
use rand::RngCore;
use sha1::Sha1;

type HmacSha1 = Hmac<Sha1>;

/// Number of random bytes in a freshly generated TOTP secret.
pub const SECRET_LEN: usize = 20;

/// The step period, in seconds, per RFC 6238's recommended default.
pub const PERIOD_SECS: u64 = 30;

/// Digits in the codes this application asks users to enter. (RFC 6238's
/// own Appendix B test vectors use 8 digits — see `hotp_digits` tests —
/// but 6 is what every authenticator app defaults to.)
pub const DIGITS: u32 = 6;

/// Generates a new random secret suitable for TOTP enrollment.
pub fn generate_secret() -> [u8; SECRET_LEN] {
    let mut secret = [0u8; SECRET_LEN];
    rand::rngs::OsRng.fill_bytes(&mut secret);
    secret
}

/// RFC 4226 HOTP: HMAC-SHA1 over an 8-byte big-endian counter, with
/// dynamic truncation to `digits` decimal digits (zero-padded).
pub fn hotp_digits(secret: &[u8], counter: u64, digits: u32) -> String {
    let mut mac = HmacSha1::new_from_slice(secret).expect("HMAC accepts a key of any length");
    mac.update(&counter.to_be_bytes());
    let hash = mac.finalize().into_bytes();

    let offset = (hash[hash.len() - 1] & 0x0f) as usize;
    let bin_code = ((u32::from(hash[offset]) & 0x7f) << 24)
        | (u32::from(hash[offset + 1]) << 16)
        | (u32::from(hash[offset + 2]) << 8)
        | u32::from(hash[offset + 3]);

    let modulus = 10u32.pow(digits);
    format!("{:0width$}", bin_code % modulus, width = digits as usize)
}

/// The TOTP code for `unix_time`, at the standard 30s period and 6 digits.
pub fn totp_at(secret: &[u8], unix_time: u64) -> String {
    hotp_digits(secret, unix_time / PERIOD_SECS, DIGITS)
}

/// Verifies `code` against `secret` at `unix_time`, tolerating one step
/// of clock drift either side. `last_accepted_step`, if set, rejects any
/// step at or before it — the caller is expected to persist the returned
/// step and pass it back in on the next attempt, so a captured code can
/// never be replayed.
///
/// Returns the accepted step on success, so the caller can persist it.
pub fn verify(
    secret: &[u8],
    code: &str,
    unix_time: u64,
    last_accepted_step: Option<u64>,
) -> Option<u64> {
    let current_step = (unix_time / PERIOD_SECS) as i64;

    for delta in [0i64, -1, 1] {
        let step = current_step + delta;
        if step < 0 {
            continue;
        }
        let step = step as u64;

        if last_accepted_step.is_some_and(|last| step <= last) {
            continue;
        }

        if hotp_digits(secret, step, DIGITS) == code {
            return Some(step);
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    // RFC 6238 Appendix B test vectors (SHA1 mode, 8-digit truncation —
    // that's what the RFC's own reference table uses, even though the
    // application above defaults to 6).
    const RFC_SECRET: &[u8] = b"12345678901234567890";

    #[test]
    fn rfc6238_appendix_b_vectors_sha1() {
        let cases: &[(u64, &str)] = &[
            (59, "94287082"),
            (1_111_111_109, "07081804"),
            (1_111_111_111, "14050471"),
            (1_234_567_890, "89005924"),
            (2_000_000_000, "69279037"),
            (20_000_000_000, "65353130"),
        ];

        for &(time, expected) in cases {
            let counter = time / PERIOD_SECS;
            let actual = hotp_digits(RFC_SECRET, counter, 8);
            assert_eq!(actual, expected, "mismatch at time={time}");
        }
    }

    #[test]
    fn verify_accepts_current_and_adjacent_steps() {
        let secret = generate_secret();
        let now = 1_700_000_000u64;

        let current = totp_at(&secret, now);
        assert_eq!(verify(&secret, &current, now, None), Some(now / PERIOD_SECS));

        let previous = totp_at(&secret, now - PERIOD_SECS);
        assert!(verify(&secret, &previous, now, None).is_some());

        let next = totp_at(&secret, now + PERIOD_SECS);
        assert!(verify(&secret, &next, now, None).is_some());
    }

    #[test]
    fn verify_rejects_codes_outside_the_window() {
        let secret = generate_secret();
        let now = 1_700_000_000u64;
        let too_old = totp_at(&secret, now - 3 * PERIOD_SECS);
        assert_eq!(verify(&secret, &too_old, now, None), None);
    }

    #[test]
    fn verify_rejects_replay_of_an_already_accepted_step() {
        let secret = generate_secret();
        let now = 1_700_000_000u64;
        let code = totp_at(&secret, now);
        let step = verify(&secret, &code, now, None).unwrap();

        // Same code, same moment, but the step was already spent.
        assert_eq!(verify(&secret, &code, now, Some(step)), None);
    }

    #[test]
    fn verify_rejects_wrong_code() {
        let secret = generate_secret();
        let now = 1_700_000_000u64;
        assert_eq!(verify(&secret, "000000", now, None), None);
    }
}
