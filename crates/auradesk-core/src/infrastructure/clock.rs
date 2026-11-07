//! Clock port for deterministic time testing in reminders, routines, and pomodoros.

#![allow(missing_docs)]

use std::sync::Mutex;

use chrono::{DateTime, Duration, Utc};

/// Abstraction over wall-clock UTC time.
pub trait Clock: Send + Sync {
    fn now(&self) -> DateTime<Utc>;
}

/// Production clock backed by `Utc::now()`.
#[derive(Debug, Default, Clone, Copy)]
pub struct SystemClock;

impl Clock for SystemClock {
    fn now(&self) -> DateTime<Utc> {
        Utc::now()
    }
}

/// Deterministic clock for unit and integration tests.
#[derive(Debug)]
pub struct FixedClock {
    current: Mutex<DateTime<Utc>>,
}

impl FixedClock {
    pub fn new(initial: DateTime<Utc>) -> Self {
        Self {
            current: Mutex::new(initial),
        }
    }

    pub fn set(&self, next: DateTime<Utc>) {
        if let Ok(mut guard) = self.current.lock() {
            *guard = next;
        }
    }

    pub fn advance(&self, delta: Duration) -> DateTime<Utc> {
        let mut guard = self.current.lock().expect("FixedClock lock poisoned");
        *guard += delta;
        *guard
    }
}

impl Clock for FixedClock {
    fn now(&self) -> DateTime<Utc> {
        *self.current.lock().expect("FixedClock lock poisoned")
    }
}
