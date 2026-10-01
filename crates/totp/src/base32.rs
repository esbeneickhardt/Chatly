//! Minimal RFC 4648 base32 (no padding) — just enough to encode/decode
//! TOTP secrets for QR codes and manual entry.

const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

pub fn encode(data: &[u8]) -> String {
    let mut output = String::new();
    let mut bits = 0u32;
    let mut value = 0u32;

    for &b in data {
        value = (value << 8) | b as u32;
        bits += 8;
        while bits >= 5 {
            bits -= 5;
            output.push(ALPHABET[((value >> bits) & 0x1f) as usize] as char);
        }
    }
    if bits > 0 {
        output.push(ALPHABET[((value << (5 - bits)) & 0x1f) as usize] as char);
    }

    output
}

#[derive(Debug, thiserror::Error)]
#[error("invalid base32 character {0:?}")]
pub struct DecodeError(char);

pub fn decode(s: &str) -> Result<Vec<u8>, DecodeError> {
    let mut output = Vec::new();
    let mut bits = 0u32;
    let mut value = 0u32;

    for c in s.chars() {
        let upper = c.to_ascii_uppercase();
        let idx = ALPHABET.iter().position(|&x| x as char == upper).ok_or(DecodeError(c))?;
        value = (value << 5) | idx as u32;
        bits += 5;
        if bits >= 8 {
            bits -= 8;
            output.push(((value >> bits) & 0xff) as u8);
        }
    }

    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_arbitrary_bytes() {
        for input in [b"".as_slice(), b"f", b"fo", b"foo", b"foob", b"fooba", b"foobar"] {
            let encoded = encode(input);
            let decoded = decode(&encoded).unwrap();
            assert_eq!(decoded, input, "round trip failed for {input:?}");
        }
    }

    #[test]
    fn matches_known_rfc4648_vectors() {
        // RFC 4648 §10 test vectors (padding stripped, since we don't emit it).
        assert_eq!(encode(b"f"), "MY");
        assert_eq!(encode(b"fo"), "MZXQ");
        assert_eq!(encode(b"foo"), "MZXW6");
        assert_eq!(encode(b"foob"), "MZXW6YQ");
        assert_eq!(encode(b"fooba"), "MZXW6YTB");
        assert_eq!(encode(b"foobar"), "MZXW6YTBOI");
    }

    #[test]
    fn decode_is_case_insensitive() {
        assert_eq!(decode("mzxw6ytboi").unwrap(), b"foobar");
    }

    #[test]
    fn rejects_invalid_characters() {
        assert!(decode("not1valid8base32").is_err());
    }
}
