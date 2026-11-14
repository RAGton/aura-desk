//! MCP stdio server (Phase 0 T6).
//!
//! Wraps the capability registry from auradesk-core and exposes it as
//! JSON-RPC over stdin/stdout. Phase 0 ships an empty registry; tools
//! are added in their respective phases.

use std::io::Write;
use std::path::PathBuf;

use anyhow::Context;
use auradesk_mcp::server::AuraDeskService;
use rmcp::service::ServiceExt;
use rmcp::transport::io::stdio;

fn parse_db_arg() -> Option<PathBuf> {
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        if arg == "--db" {
            return args.next().map(PathBuf::from);
        }
        if let Some(rest) = arg.strip_prefix("--db=") {
            return Some(PathBuf::from(rest));
        }
    }
    None
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Tracing to stderr only (NEVER stdout; that would corrupt the JSON-RPC stream).
    tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let data_dir = AuraDeskService::resolve_data_dir(parse_db_arg().as_deref());
    tracing::info!("auradesk-mcp using database dir: {}", data_dir.display());
    let service = AuraDeskService::open(&data_dir)
        .context("opening persistent AuraDesk SQLite database")?
        .serve(stdio())
        .await
        .context("starting MCP stdio server")?;

    service.waiting().await.context("waiting for MCP service")?;

    // Flush stdout on exit so any pending responses reach the client.
    std::io::stdout().flush().context("flushing stdout")?;
    Ok(())
}
