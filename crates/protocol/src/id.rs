//! Snowflake-style entity IDs.
//!
//! Layout (64 bits, MSB first):
//! - 42 bits: milliseconds since [`EPOCH_MS`]
//! - 10 bits: node ID (always 0 for a single-instance deployment)
//! - 12 bits: per-millisecond sequence
//!
//! IDs sort by creation time and are safe to paginate on. They are
//! serialised as JSON strings because JavaScript cannot represent all
//! 64-bit integers exactly.

use std::fmt;
use std::str::FromStr;

use serde::de::{self, Visitor};
use serde::{Deserialize, Deserializer, Serialize, Serializer};

/// Custom epoch: 2024-01-01T00:00:00Z, in milliseconds since the Unix epoch.
pub const EPOCH_MS: u64 = 1_704_067_200_000;

const NODE_BITS: u32 = 10;
const SEQUENCE_BITS: u32 = 12;
const SEQUENCE_MASK: u64 = (1 << SEQUENCE_BITS) - 1;
const NODE_MASK: u64 = (1 << NODE_BITS) - 1;
const TIMESTAMP_SHIFT: u32 = NODE_BITS + SEQUENCE_BITS;
const NODE_SHIFT: u32 = SEQUENCE_BITS;

/// A 64-bit snowflake ID identifying any entity (user, message, guild, ...).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Id(pub u64);

impl Id {
    pub const fn from_raw(raw: u64) -> Self {
        Id(raw)
    }

    pub const fn raw(self) -> u64 {
        self.0
    }

    /// Builds an ID from its logical parts. Debug-asserts that `node` and
    /// `sequence` fit their bit width — the generator guarantees this
    /// never fails.
    pub fn from_parts(timestamp_ms: u64, node: u16, sequence: u16) -> Self {
        debug_assert!((node as u64) <= NODE_MASK);
        debug_assert!((sequence as u64) <= SEQUENCE_MASK);
        let elapsed = timestamp_ms.saturating_sub(EPOCH_MS);
        let raw = (elapsed << TIMESTAMP_SHIFT) | ((node as u64) << NODE_SHIFT) | (sequence as u64);
        Id(raw)
    }

    /// Milliseconds since the Unix epoch at which this ID was created.
    pub const fn timestamp_ms(self) -> u64 {
        (self.0 >> TIMESTAMP_SHIFT) + EPOCH_MS
    }

    pub const fn node(self) -> u16 {
        ((self.0 >> NODE_SHIFT) & NODE_MASK) as u16
    }

    pub const fn sequence(self) -> u16 {
        (self.0 & SEQUENCE_MASK) as u16
    }
}

impl fmt::Display for Id {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ParseIdError {
    #[error("invalid snowflake id: {0}")]
    InvalidFormat(#[from] std::num::ParseIntError),
}

impl FromStr for Id {
    type Err = ParseIdError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Ok(Id(s.parse()?))
    }
}

impl Serialize for Id {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.0.to_string())
    }
}

impl<'de> Deserialize<'de> for Id {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct IdVisitor;

        impl Visitor<'_> for IdVisitor {
            type Value = Id;

            fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str("a snowflake id as a decimal string")
            }

            fn visit_str<E: de::Error>(self, v: &str) -> Result<Id, E> {
                v.parse::<u64>().map(Id).map_err(de::Error::custom)
            }
        }

        deserializer.deserialize_str(IdVisitor)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_through_json_as_a_string() {
        let id = Id::from_parts(EPOCH_MS + 12345, 3, 7);
        let json = serde_json::to_string(&id).unwrap();
        assert_eq!(json, format!("\"{}\"", id.0));
        let back: Id = serde_json::from_str(&json).unwrap();
        assert_eq!(back, id);
    }

    #[test]
    fn parts_round_trip() {
        let id = Id::from_parts(EPOCH_MS + 999_999, 1023, 4095);
        assert_eq!(id.timestamp_ms(), EPOCH_MS + 999_999);
        assert_eq!(id.node(), 1023);
        assert_eq!(id.sequence(), 4095);
    }

    #[test]
    fn ids_from_later_timestamps_sort_higher() {
        let a = Id::from_parts(EPOCH_MS + 1, 0, 4095);
        let b = Id::from_parts(EPOCH_MS + 2, 0, 0);
        assert!(a < b);
    }

    #[test]
    fn ids_at_same_timestamp_sort_by_sequence() {
        let a = Id::from_parts(EPOCH_MS + 1, 0, 1);
        let b = Id::from_parts(EPOCH_MS + 1, 0, 2);
        assert!(a < b);
    }
}
