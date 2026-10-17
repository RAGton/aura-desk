//! Capability registry: single source of truth for tools exposed to both
//! Tauri IPC and the MCP dispatcher. See spec §8.5.
//!
//! Phase 0 ships an empty registry. Capabilities are added in their
//! respective phases (Phase 1+).

use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CapabilityKind {
    /// Callable from the Tauri desktop UI only.
    Tauri,
    /// Callable via MCP (Hermes) only. Used for propose_* tools.
    Mcp,
    /// Callable from either surface.
    Both,
}

pub struct Capability {
    pub name: &'static str,
    pub description: &'static str,
    pub kind: CapabilityKind,
    pub input_schema: Value,
    pub output_schema: Value,
}

pub trait CapabilityHandler: Send + Sync {
    fn invoke(&self, input: Value) -> Result<Value, crate::CoreError>;
}

/// Empty registry in Phase 0. Returns an empty slice.
pub fn capabilities() -> &'static [Capability] {
    &[]
}
