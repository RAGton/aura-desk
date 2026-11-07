//! Public surface for the auradesk Tauri binary.

use auradesk_core::capabilities::{capabilities, Capability};

pub mod ipc;
pub mod routines;
pub mod runtime;

/// Return the shared capability registry exposed by `auradesk list-capabilities`.
pub fn list_capabilities() -> &'static [Capability] {
    capabilities()
}
