//! Background routines runner (stub).
//!
//! Provides the entry point for the routines background loop.
//! In Phase 2+, this loop drives routine alerts (water, break, daily planning)
//! and coordinates with Pomodoro focus sessions.

use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use auradesk_core::infrastructure::db::Db;

/// Run background routine loop (stub until routine runner is implemented).
#[allow(dead_code)]
pub fn run_loop(_db: Arc<Db>, _in_focus: Arc<AtomicBool>) {
    // Stub implementation: routine runner loop will tick periodically when implemented.
}
