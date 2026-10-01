//! Lightweight network monitor exposed to any signed-in user, so a
//! self-hoster (or anyone curious) can see at a glance whether Chatly
//! itself is pushing meaningful bandwidth. Read per-interface, and the
//! container only has its own virtual interface in view (this isn't
//! run with host networking), so it reflects **Chatly's own**
//! traffic, not the host's total.
//!
//! This used to also report whole-host CPU/memory (read from `/proc`,
//! which Docker doesn't namespace by default) for the same "is hosting
//! this competing with my game" purpose — dropped entirely (not just
//! hidden client-side): that's real information about the *host
//! machine* Chatly happens to run on, which any authenticated user
//! having API access to is a real, needless information disclosure,
//! not something worth the exploitability for a convenience readout.

use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use sysinfo::Networks;

use crate::time::now_ms;

const SAMPLE_INTERVAL: Duration = Duration::from_secs(2);

#[derive(Clone, Copy, Serialize)]
pub struct SystemStats {
    pub net_rx_bytes_per_sec: u64,
    pub net_tx_bytes_per_sec: u64,
    pub sampled_at: i64,
}

pub struct StatsMonitor {
    latest: Mutex<SystemStats>,
}

impl StatsMonitor {
    pub fn snapshot(&self) -> SystemStats {
        *crate::sync::lock(&self.latest)
    }
}

/// Spawns the background sampling loop and returns a handle to read the
/// latest snapshot from. The first snapshot is available immediately
/// (a zeroed reading) — accurate values land after the first tick.
pub fn spawn() -> std::sync::Arc<StatsMonitor> {
    let monitor = std::sync::Arc::new(StatsMonitor {
        latest: Mutex::new(SystemStats {
            net_rx_bytes_per_sec: 0,
            net_tx_bytes_per_sec: 0,
            sampled_at: now_ms(),
        }),
    });

    let handle = monitor.clone();
    tokio::spawn(async move {
        let mut networks = Networks::new_with_refreshed_list();
        loop {
            tokio::time::sleep(SAMPLE_INTERVAL).await;
            networks.refresh(true);

            let (rx, tx) = networks.iter().fold((0u64, 0u64), |(rx, tx), (_, data)| {
                (rx + data.received(), tx + data.transmitted())
            });
            let secs = SAMPLE_INTERVAL.as_secs_f64();

            let mut latest = crate::sync::lock(&handle.latest);
            *latest = SystemStats {
                net_rx_bytes_per_sec: (rx as f64 / secs) as u64,
                net_tx_bytes_per_sec: (tx as f64 / secs) as u64,
                sampled_at: now_ms(),
            };
        }
    });

    monitor
}
