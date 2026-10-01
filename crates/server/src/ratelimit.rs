//! In-memory token-bucket rate limiting for the auth endpoints
//! (`/api/register`, `/api/login`, `/api/mfa/verify`). Per-attempt MFA
//! limiting (5 tries per pre-auth token) lives in `auth::preauth`
//! instead — this module guards against high-volume guessing across
//! many usernames or tokens from one source.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

struct Bucket {
    tokens: f64,
    last_refill: Instant,
}

pub struct RateLimiter {
    capacity: f64,
    refill_per_sec: f64,
    buckets: Mutex<HashMap<String, Bucket>>,
}

impl RateLimiter {
    /// `capacity` attempts available immediately, refilling at
    /// `capacity / window` per second.
    pub fn new(capacity: u32, window: Duration) -> Self {
        RateLimiter {
            capacity: capacity as f64,
            refill_per_sec: capacity as f64 / window.as_secs_f64(),
            buckets: Mutex::new(HashMap::new()),
        }
    }

    /// Returns `true` if `key` has an attempt available (and consumes
    /// it), `false` if it's out.
    pub fn check(&self, key: &str) -> bool {
        let now = Instant::now();
        let mut buckets = crate::sync::lock(&self.buckets);

        // Cheap unbounded-growth guard: sweep stale, fully-refilled
        // buckets occasionally rather than tracking them precisely.
        if buckets.len() > 10_000 {
            buckets.retain(|_, b| now.duration_since(b.last_refill) < Duration::from_secs(3600));
        }

        let bucket = buckets
            .entry(key.to_string())
            .or_insert(Bucket { tokens: self.capacity, last_refill: now });

        let elapsed = now.duration_since(bucket.last_refill).as_secs_f64();
        bucket.tokens = (bucket.tokens + elapsed * self.refill_per_sec).min(self.capacity);
        bucket.last_refill = now;

        if bucket.tokens >= 1.0 {
            bucket.tokens -= 1.0;
            true
        } else {
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_up_to_capacity_then_blocks() {
        let limiter = RateLimiter::new(3, Duration::from_secs(60));
        assert!(limiter.check("a"));
        assert!(limiter.check("a"));
        assert!(limiter.check("a"));
        assert!(!limiter.check("a"));
    }

    #[test]
    fn keys_are_independent() {
        let limiter = RateLimiter::new(1, Duration::from_secs(60));
        assert!(limiter.check("a"));
        assert!(limiter.check("b"));
        assert!(!limiter.check("a"));
    }
}
