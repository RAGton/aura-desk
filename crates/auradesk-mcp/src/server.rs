//! MCP server implementation: wraps the capability registry from
//! `auradesk-core` and exposes all 19 tools as JSON-RPC over stdio.

use std::borrow::Cow;
use std::sync::Arc;

use rmcp::model::{
    CallToolRequestParam, CallToolResult, Content, ErrorCode, Implementation, JsonObject,
    ListToolsResult, PaginatedRequestParam, ProtocolVersion, ServerCapabilities, ServerInfo, Tool,
    ToolsCapability,
};
use rmcp::service::{RequestContext, RoleServer};
use rmcp::ErrorData as McpError;
use rmcp::ServerHandler;
use serde_json::{json, Value};

use auradesk_core::capabilities::{
    capabilities, dispatch_capability, find_capability, CapabilityKind,
};
use auradesk_core::infrastructure::db::Db;
use auradesk_core::CoreError;

/// The MCP service wrapping `Db` and the 19-tool capability registry.
#[derive(Clone)]
pub struct AuraDeskService {
    db: Arc<Db>,
}

impl std::fmt::Debug for AuraDeskService {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AuraDeskService").finish()
    }
}

impl Default for AuraDeskService {
    fn default() -> Self {
        Self::new()
    }
}

impl AuraDeskService {
    /// Build a service backed by an initialized SQLite database.
    pub fn new() -> Self {
        let db = Db::open_in_memory().expect("initialize AuraDeskService database");
        Self { db: Arc::new(db) }
    }

    /// Build a service sharing an existing `Arc<Db>`.
    pub fn with_db(db: Arc<Db>) -> Self {
        Self { db }
    }

    /// Borrow the underlying database handle.
    pub fn db(&self) -> &Db {
        &self.db
    }

    /// Build the MCP `Tool` descriptors from `auradesk_core::capabilities::capabilities()`.
    pub fn mcp_tools() -> Vec<Tool> {
        capabilities()
            .iter()
            .filter(|c| matches!(c.kind, CapabilityKind::Mcp | CapabilityKind::Both))
            .map(|c| {
                let schema_map: JsonObject =
                    c.input_schema.as_object().cloned().unwrap_or_default();
                Tool::new(c.name, c.description, Arc::new(schema_map))
            })
            .collect()
    }

    /// Synchronous helper to invoke a tool by name with JSON arguments.
    pub fn call_tool_sync(
        &self,
        name: &str,
        arguments: Option<JsonObject>,
    ) -> Result<CallToolResult, McpError> {
        let Some(cap) = find_capability(name) else {
            return Err(McpError {
                code: ErrorCode::METHOD_NOT_FOUND,
                message: Cow::Owned(format!("unknown tool: {name}")),
                data: Some(json!({
                    "kind": "not_found",
                    "entity": "tool",
                    "id": name,
                })),
            });
        };

        if !matches!(cap.kind, CapabilityKind::Mcp | CapabilityKind::Both) {
            return Err(McpError {
                code: ErrorCode::METHOD_NOT_FOUND,
                message: Cow::Owned(format!("tool not exposed via MCP: {name}")),
                data: None,
            });
        }

        let input_val = match arguments {
            Some(map) => Value::Object(map),
            None => Value::Object(serde_json::Map::new()),
        };

        match dispatch_capability(&self.db, name, input_val) {
            Ok(out_val) => {
                let content = Content::json(out_val)?;
                Ok(CallToolResult::success(vec![content]))
            }
            Err(err) => Err(map_core_error_to_mcp(&err)),
        }
    }
}

impl ServerHandler for AuraDeskService {
    fn get_info(&self) -> ServerInfo {
        ServerInfo {
            protocol_version: ProtocolVersion::default(),
            capabilities: ServerCapabilities {
                tools: Some(ToolsCapability {
                    list_changed: Some(false),
                }),
                ..ServerCapabilities::default()
            },
            server_info: Implementation {
                name: "auradesk-mcp".to_string(),
                version: env!("CARGO_PKG_VERSION").to_string(),
            },
            instructions: None,
        }
    }

    fn list_tools(
        &self,
        _request: Option<PaginatedRequestParam>,
        _context: RequestContext<RoleServer>,
    ) -> impl std::future::Future<Output = Result<ListToolsResult, McpError>> + Send + '_ {
        std::future::ready(Ok(ListToolsResult {
            tools: Self::mcp_tools(),
            next_cursor: None,
        }))
    }

    fn call_tool(
        &self,
        request: CallToolRequestParam,
        _context: RequestContext<RoleServer>,
    ) -> impl std::future::Future<Output = Result<CallToolResult, McpError>> + Send + '_ {
        let res = self.call_tool_sync(&request.name, request.arguments);
        std::future::ready(res)
    }
}

/// Map `CoreError` variants to JSON-RPC error codes per spec §8.6.
pub fn map_core_error_to_jsonrpc(err: &CoreError) -> (i32, String) {
    let code = match err {
        CoreError::Validation { .. } => -32602, // Invalid params
        CoreError::NotFound { entity, .. } if *entity == "tool" => -32601, // Method not found
        CoreError::NotFound { .. } => -32004,   // custom: Not found
        CoreError::Conflict { .. } => -32009,   // custom: Conflict
        CoreError::Internal { .. } => -32603,   // Internal error
    };
    (code, err.to_string())
}

/// Map `CoreError` into an `rmcp::ErrorData` carrying `code`, `message`, and structured `data`.
pub fn map_core_error_to_mcp(err: &CoreError) -> McpError {
    let (code, msg) = map_core_error_to_jsonrpc(err);
    let data = match err {
        CoreError::Validation { field, reason } => json!({
            "kind": "validation",
            "message": msg,
            "details": { "field": field, "reason": reason }
        }),
        CoreError::NotFound { entity, id } => json!({
            "kind": "not_found",
            "message": msg,
            "details": { "entity": entity, "id": id }
        }),
        CoreError::Conflict { entity, reason } => json!({
            "kind": "conflict",
            "message": msg,
            "details": { "entity": entity, "reason": reason }
        }),
        CoreError::Internal { message } => json!({
            "kind": "internal",
            "message": message,
        }),
    };
    McpError {
        code: ErrorCode(code),
        message: Cow::Owned(msg),
        data: Some(data),
    }
}
