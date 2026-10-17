//! MCP server implementation: wraps the capability registry from
//! auradesk-core and exposes it as JSON-RPC tools.
//!
//! Phase 0 ships an empty registry. The `ServerHandler` impl answers
//! `initialize`, `ping`, `tools/list` (empty), and maps CoreError to
//! JSON-RPC codes per spec §8.6.
//!
//! Adapted to rmcp 0.3.2 API (older draft of this file was written
//! against a different version). The trait in 0.3.2 has no
//! `get_capabilities` method; the InitializeResult IS the ServerInfo.

use rmcp::model::{Implementation, ProtocolVersion, ServerCapabilities, ServerInfo};
use rmcp::ErrorData as McpError;
use rmcp::ServerHandler;

use auradesk_core::{capabilities::capabilities, CoreError};

/// The MCP service. Wraps the capability registry and answers the
/// standard methods. Phase 0 is stateless; the struct carries no fields.
#[derive(Debug, Clone, Default)]
pub struct AuraDeskService;

impl AuraDeskService {
    /// Build a stateless service. Provided for forward compatibility
    /// with future phases (the service will accumulate state in T1+).
    pub fn new() -> Self {
        Self
    }
}

impl ServerHandler for AuraDeskService {
    /// Return the server identity + capabilities. The MCP framework
    /// returns this from `initialize` via the trait default.
    fn get_info(&self) -> ServerInfo {
        ServerInfo {
            protocol_version: ProtocolVersion::default(),
            capabilities: ServerCapabilities::default(),
            server_info: Implementation {
                name: "auradesk-mcp".to_string(),
                version: env!("CARGO_PKG_VERSION").to_string(),
            },
            instructions: None,
        }
    }

    /// Phase 0: empty tool list. Tools are added in their phases.
    /// Override kept explicit so the comment is colocated with the call.
    fn list_tools(
        &self,
        _request: Option<rmcp::model::PaginatedRequestParam>,
        _context: rmcp::service::RequestContext<rmcp::RoleServer>,
    ) -> impl std::future::Future<Output = Result<rmcp::model::ListToolsResult, McpError>> + Send + '_
    {
        // Defensive: the capabilities() registry is empty in Phase 0.
        // The default impl also returns ListToolsResult::default(), but
        // we touch the registry to keep the linkage exercised.
        let _ = capabilities();
        std::future::ready(Ok(rmcp::model::ListToolsResult::default()))
    }
}

/// Map CoreError variants to JSON-RPC error codes per spec §8.6.
///
/// Exposed for use by the `auradesk` (Tauri) binary and future
/// capability handlers; not used directly by this binary in Phase 0.
pub fn map_core_error_to_jsonrpc(err: &CoreError) -> (i32, String) {
    let code = match err {
        CoreError::Validation { .. } => -32602, // Invalid params
        CoreError::NotFound { .. } => -32004,   // custom: Not found
        CoreError::Conflict { .. } => -32009,   // custom: Conflict
        CoreError::Internal { .. } => -32603,   // Internal error
    };
    (code, err.to_string())
}
