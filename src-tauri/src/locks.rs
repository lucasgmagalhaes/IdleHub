//! Locking that survives a panic elsewhere.

use std::sync::{Mutex, MutexGuard, PoisonError};

/// Locks `mutex` even if a thread panicked while holding it. The app state is
/// only ever replaced whole (see `storage::commit`), so it stays consistent, and
/// one bad callback must not make every later command panic.
pub fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recovers_a_mutex_poisoned_by_a_panic() {
        let mutex = Mutex::new(1);
        let _ = std::panic::catch_unwind(|| {
            let _guard = mutex.lock().unwrap();
            panic!("callback failed");
        });
        assert!(mutex.is_poisoned());
        *lock(&mutex) += 1;
        assert_eq!(*lock(&mutex), 2);
    }
}
