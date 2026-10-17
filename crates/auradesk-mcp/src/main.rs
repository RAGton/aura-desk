//! MCP stdio server (Phase 0 T6).
//!
//! Wraps the capability registry from auradesk-core and exposes it as
//! JSON-RPC over stdin/stdout. Phase 0 ships an empty registry; tools
//! are added in their respective phases.

use std::io::{self, Write};

use rmcp::model::{ServerCapabilities, ServerInfo};
use rmcp::service::ServiceExt;
use rmcp::transport::io::stdio;

#[tokio::main]
async fn main() -> io::Result<()> {
    // Tracing to stderr only (NEVER stdout; that would corrupt the JSON-RPC stream).
    tracing_subscriber::fmt()
        .with_writer(io::stderr)
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let server_info = ServerInfo {
        name: Some("auradesk-mcp".into()),
        version: Some(env!("CARGO_PKG_VERSION").into()),
        ..Default::default()
    };
    let capabilities = ServerCapabilities::default();

    let service = auradesk_mcp::server::AuraDeskService::new(server_info, capabilities)
        .serve(stdio())
        .await
        .inspect_err(|e| {
            eprintln!("MCP server error: {e}");
        })?;

    service.waiting().await?;

    // Flush stdout on exit so any pending responses reach the client.
    io::stdout().flush()?;
    Ok(())
}
