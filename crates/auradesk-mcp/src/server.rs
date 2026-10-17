//! MCP server implementation: wraps the capability registry from
//! auradesk-core and exposes it as JSON-RPC tools.
//!
//! Phase 0 ships an empty registry. The `ServerHandler` impl answers
//! `initialize`, `tools/list` (empty), and maps CoreError to JSON-RPC
//! codes per spec §8.6.

use rmcp::model::{ServerCapabilities, ServerInfo};
use rmcp::server::ServerHandler;
use rmcp::ErrorData as McpError;

use auradesk_core::{capabilities, CoreError};

/// The MCP service. Wraps the capability registry and answers the
/// standard methods.
#[derive(Debug, Clone)]
pub struct AuraDeskService {
    info: ServerInfo,
    capabilities: ServerCapabilities,
}

impl AuraDeskService {
    pub fn new(info: ServerInfo, capabilities: ServerCapabilities) -> Self {
        Self { info, capabilities }
    }
}

impl ServerHandler for AuraDeskService {
    fn get_info(&self) -> ServerInfo {
        self.info.clone()
    }

    fn get_capabilities(&self) -> ServerCapabilities {
        self.capabilities.clone()
    }

    async fn list_tools(
        &self,
        _request: Option<rmcp::model::PaginatedRequestParam>,
        _context: rmcp::service::RequestContext<rmcp::RoleServer>,
    ) -> Result<rmcp::model::ListToolsResult, McpError> {
        // Phase 0: empty tool list. Tools are added in their phases.
        let tools: Vec<rmcp::model::Tool> = capabilities()
            .iter()
            .map(|cap| rmcp::model::Tool {
                name: cap.name.to_string().into(),
                description: Some(cap.description.to_string()),
                input_schema: cap.input_schema.clone(),
                output_schema: Some(cap.output_schema.clone()),
                annotations: None,
            })
            .collect();
        Ok(rmcp::model::ListToolsResult {
            tools,
            next_cursor: None,
            meta: None,
        })
    }
}

/// Map CoreError variants to JSON-RPC error codes per spec §8.6.
///
/// Exposed for use by the `auradesk` (Tauri) binary and future
/// capability handlers; not used directly by this binary in Phase 0.
pub fn map_core_error_to_jsonrpc(err: &CoreError) -> (i32, String) {
    let code = match err {
        CoreError::Validation { .. } => -32602,             // Invalid params
        CoreError::NotFound { .. } => -32004,                // custom: Not found
        CoreError::Conflict { .. } => -32009,                // custom: Conflict
        CoreError::Internal { .. } => -32603,                // Internal error
    };
    (code, err.to_string())
}
