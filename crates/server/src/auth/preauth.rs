//! Short-lived "pre-auth" tokens issued between password and MFA-code
//! verification. Deliberately in-memory only (never persisted): they
//! live five minutes, a restart invalidating them is harmless, and it
//! keeps the `sessions` table exclusively for real, logged-in sessions.

use std::collections::HashMap;
use std::sync::Mutex;

use protocol::Id;

use super::token;
use crate::time::now_ms;

const TTL_MS: i64 = 5 * 60 * 1000;
const MAX_ATTEMPTS: u32 = 5;

struct Entry {
    user_id: Id,
    expires_at: i64,
    attempts: u32,
}

#[derive(Default)]
pub struct PreAuthStore {
    entries: Mutex<HashMap<String, Entry>>,
}

impl PreAuthStore {
    pub fn new() -> Self {
        Self::default()
    }

    /// Issues a new pre-auth token for `user_id`, valid for 5 minutes.
    pub fn create(&self, user_id: Id) -> String {
        let token = token::generate_session_token();
        let mut entries = crate::sync::lock(&self.entries);
        entries.retain(|_, e| e.expires_at > now_ms());
        entries
            .insert(token.clone(), Entry { user_id, expires_at: now_ms() + TTL_MS, attempts: 0 });
        token
    }

    /// Records an MFA attempt against `token`. Returns the associated
    /// user id if the token is still valid and under the attempt limit;
    /// the caller decides whether the attempt itself succeeded. Once the
    /// attempt limit is hit, the token is invalidated immediately.
    pub fn try_attempt(&self, token: &str) -> Option<Id> {
        let mut entries = crate::sync::lock(&self.entries);
        let entry = entries.get_mut(token)?;
        if entry.expires_at <= now_ms() {
            entries.remove(token);
            return None;
        }
        entry.attempts += 1;
        let user_id = entry.user_id;
        if entry.attempts > MAX_ATTEMPTS {
            entries.remove(token);
            return None;
        }
        Some(user_id)
    }

    /// Consumes (invalidates) a token after a successful MFA check.
    pub fn consume(&self, token: &str) {
        crate::sync::lock(&self.entries).remove(token);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_fresh_token_allows_attempts_up_to_the_limit() {
        let store = PreAuthStore::new();
        let user_id = Id::from_raw(42);
        let token = store.create(user_id);

        for _ in 0..MAX_ATTEMPTS {
            assert_eq!(store.try_attempt(&token), Some(user_id));
        }
        // One more than the limit invalidates it.
        assert_eq!(store.try_attempt(&token), None);
        assert_eq!(store.try_attempt(&token), None);
    }

    #[test]
    fn consume_invalidates_the_token() {
        let store = PreAuthStore::new();
        let token = store.create(Id::from_raw(1));
        store.consume(&token);
        assert_eq!(store.try_attempt(&token), None);
    }

    #[test]
    fn unknown_token_returns_none() {
        let store = PreAuthStore::new();
        assert_eq!(store.try_attempt("does-not-exist"), None);
    }
}
