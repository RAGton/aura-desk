//! Capability registry: single source of truth for tools exposed to both
//! Tauri IPC and the MCP dispatcher. See spec §8.5.
//!
//! Phase 0 ships an empty registry. Capabilities are added in their
//! respective phases (Phase 1+).

use serde_json::Value;

/// Where a capability is callable from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CapabilityKind {
    /// Callable from the Tauri desktop UI only.
    Tauri,
    /// Callable via MCP (Hermes) only. Used for propose_* tools.
    Mcp,
    /// Callable from either surface.
    Both,
}

/// One tool exposed by the application. Listed by `capabilities()` and
/// consumed by both the Tauri IPC dispatcher and the MCP server.
#[derive(Debug, Clone)]
pub struct Capability {
    /// Stable identifier used as the tool name in IPC and MCP calls.
    pub name: &'static str,
    /// Short human-readable summary shown to clients.
    pub description: &'static str,
    /// Whether this capability is reachable from the Tauri UI, MCP, or both.
    pub kind: CapabilityKind,
    /// JSON Schema (Draft 2020-12) describing the accepted input object.
    pub input_schema: Value,
    /// JSON Schema (Draft 2020-12) describing the returned output object.
    pub output_schema: Value,
}

/// Implemented by every capability. The dispatcher looks up the trait
/// object via the registry and calls `invoke` with the parsed input.
pub trait CapabilityHandler: Send + Sync {
    /// Execute the capability with the given input and return the output.
    /// Errors are mapped to JSON-RPC codes by the caller.
    fn invoke(&self, input: Value) -> Result<Value, crate::CoreError>;
}

/// Empty registry in Phase 0. Returns an empty slice.
pub fn capabilities() -> &'static [Capability] {
    &[]
}
