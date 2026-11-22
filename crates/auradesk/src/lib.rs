//! Public surface for the auradesk Tauri binary.

use auradesk_core::capabilities::{capabilities, Capability};

pub mod ai;
pub mod alert_lock;
pub mod audio;
pub mod desktop;
pub mod github;
pub mod hermes;
pub mod hindsight;
pub mod hindsight_explore;
pub mod idle;
pub mod ipc;
pub mod logging;
pub mod raglight;
pub mod routines;
pub mod runtime;
pub mod updater;

/// Return the shared capability registry exposed by `auradesk list-capabilities`.
pub fn list_capabilities() -> &'static [Capability] {
    capabilities()
}
