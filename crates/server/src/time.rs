use std::time::{SystemTime, UNIX_EPOCH};

/// Milliseconds since the Unix epoch, as `i64` (what SQLite columns and
/// JSON responses use throughout this crate).
pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock is before the Unix epoch")
        .as_millis() as i64
}
