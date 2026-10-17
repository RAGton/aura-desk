//! Public surface for the auradesk Tauri binary.
//!
//! In Phase 0 the only entry point is `runtime::build()`. IPC commands
//! and richer builders are added in later phases.

pub mod ipc;
pub mod runtime;
