//! Monotonic snowflake ID generation. See `protocol::id` for the ID
//! layout itself; this module only owns the mutable clock/sequence state.

use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use protocol::id::Id;

struct State {
    last_ts_ms: u64,
    sequence: u16,
}

pub struct SnowflakeGenerator {
    node_id: u16,
    state: Mutex<State>,
}

const SEQUENCE_BITS: u32 = 12;
const SEQUENCE_MAX: u16 = (1 << SEQUENCE_BITS) - 1;

impl SnowflakeGenerator {
    pub fn new(node_id: u16) -> Self {
        SnowflakeGenerator { node_id, state: Mutex::new(State { last_ts_ms: 0, sequence: 0 }) }
    }

    /// Generates the next ID. Blocks (briefly) if the system clock has
    /// moved backwards, waiting for real time to catch back up rather
    /// than risking a duplicate or out-of-order ID.
    pub fn next_id(&self) -> Id {
        let mut state = crate::sync::lock(&self.state);
        loop {
            let now = now_ms();

            if now < state.last_ts_ms {
                // Clock went backwards (NTP step, VM pause, ...). Wait it out.
                std::thread::sleep(std::time::Duration::from_millis(state.last_ts_ms - now + 1));
                continue;
            }

            if now == state.last_ts_ms {
                if state.sequence == SEQUENCE_MAX {
                    // Exhausted this millisecond's sequence space; spin to the next one.
                    std::thread::sleep(std::time::Duration::from_micros(100));
                    continue;
                }
                state.sequence += 1;
            } else {
                state.last_ts_ms = now;
                state.sequence = 0;
            }

            return Id::from_parts(state.last_ts_ms, self.node_id, state.sequence);
        }
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock is before the Unix epoch")
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;
    use std::sync::Arc;

    #[test]
    fn generates_strictly_increasing_ids() {
        let gen = SnowflakeGenerator::new(0);
        let mut prev = gen.next_id();
        for _ in 0..10_000 {
            let next = gen.next_id();
            assert!(next > prev, "{next:?} should be greater than {prev:?}");
            prev = next;
        }
    }

    #[test]
    fn generates_unique_ids_under_concurrency() {
        let gen = Arc::new(SnowflakeGenerator::new(0));
        let mut handles = Vec::new();
        for _ in 0..16 {
            let gen = Arc::clone(&gen);
            handles.push(std::thread::spawn(move || {
                (0..2_000).map(|_| gen.next_id()).collect::<Vec<_>>()
            }));
        }

        let mut all = HashSet::new();
        for handle in handles {
            for id in handle.join().unwrap() {
                assert!(all.insert(id.raw()), "duplicate id generated: {id}");
            }
        }
        assert_eq!(all.len(), 16 * 2_000);
    }

    #[test]
    fn embeds_the_configured_node_id() {
        let gen = SnowflakeGenerator::new(7);
        let id = gen.next_id();
        assert_eq!(id.node(), 7);
    }
}
