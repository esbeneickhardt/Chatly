//! Locking helper. A `std::sync::Mutex` becomes "poisoned" if a thread
//! panics while holding it, and `lock().unwrap()` then makes *every later
//! caller* panic too — one bad request would take the whole server down
//! for good (the SQLite connection, the presence map, the rate limiter
//! all sit behind one). None of the data guarded in this crate is left
//! in a state that breaks anything when a holder unwinds — the SQLite
//! transactions roll back on drop, the maps are only ever mutated by
//! whole-entry insert/remove — so the right response to poison is to
//! carry on with the data as it is.

use std::sync::{Mutex, MutexGuard, PoisonError};

/// Locks `mutex`, recovering the guard if a previous holder panicked.
pub fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[test]
    fn a_panic_while_locked_does_not_break_later_callers() {
        let shared = Arc::new(Mutex::new(1));
        let clone = shared.clone();
        let _ = std::thread::spawn(move || {
            let _guard = clone.lock().unwrap();
            panic!("poison it");
        })
        .join();

        assert!(shared.lock().is_err(), "the mutex really is poisoned");
        *lock(&shared) += 1;
        assert_eq!(*lock(&shared), 2);
    }
}
