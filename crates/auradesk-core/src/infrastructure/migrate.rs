//! Minimal migration runner for Phase 0.
//!
//! Reads `migrations/V001__init.sql` at compile time via `include_str!`
//! and executes it. Refinery's runner is wired in T5 when the dep is
//! added to Cargo.toml. For now, V001 is a single migration that
//! always runs on first open.

use rusqlite::Connection;

use crate::infrastructure::db::DbError;

const V001: &str = include_str!("../../migrations/V001__init.sql");

/// Run every embedded migration on the given connection. In Phase 0
/// there is only V001; the runner is replaced by refinery's full
/// implementation when the dep is added to Cargo.toml.
pub fn run_all(conn: &Connection) -> Result<(), crate::CoreError> {
    conn.execute_batch(V001).map_err(DbError::from)?;
    Ok(())
}
